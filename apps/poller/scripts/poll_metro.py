#!/usr/bin/env python3
"""
Poll TMB iMetro API and estimate Metro train positions.

This poller fetches real-time arrival predictions from the iMetro API,
estimates train positions by interpolating along line geometry based on
time-to-arrival, and writes results to PostgreSQL.

Data flow:
  iMetro API (arrivals) -> Position estimation -> PostgreSQL
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import os
import signal
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psycopg2
import requests
from dotenv import load_dotenv
from psycopg2.extras import execute_batch

LOGGER = logging.getLogger(__name__)

# API Configuration
IMETRO_API_URL = "https://api.tmb.cat/v1/imetro/estacions"
HTTP_TIMEOUT = 15.0

# Database tables
METRO_CURRENT_TABLE = "rt_metro_vehicle_current"
METRO_HISTORY_TABLE = "rt_metro_vehicle_history"
METRO_ARRIVALS_TABLE = "rt_metro_arrivals_current"
SNAPSHOTS_TABLE = "rt_snapshots"

# Line code mapping (API uses numeric codes)
LINE_CODE_MAP = {
    1: "L1",
    2: "L2",
    3: "L3",
    4: "L4",
    5: "L5",
    9: "L9",  # Could be L9N or L9S based on route
    10: "L10",  # Could be L10N or L10S based on route
    11: "L11",
}

# Average segment travel times in seconds (estimated)
# Used when we can't calculate from schedule
DEFAULT_SEGMENT_TIME_SECONDS = 120


@dataclass
class Station:
    """Metro station with coordinates."""
    stop_id: str
    stop_code: str
    name: str
    latitude: float
    longitude: float
    lines: list[str] = field(default_factory=list)


@dataclass
class LineGeometry:
    """Metro line geometry for interpolation."""
    line_code: str
    coordinates: list[tuple[float, float]]  # [(lng, lat), ...]
    total_length_meters: float = 0.0

    def __post_init__(self):
        if not self.total_length_meters:
            self.total_length_meters = self._calculate_length()

    def _calculate_length(self) -> float:
        """Calculate total line length in meters."""
        total = 0.0
        for i in range(1, len(self.coordinates)):
            total += haversine_distance(
                self.coordinates[i-1][1], self.coordinates[i-1][0],
                self.coordinates[i][1], self.coordinates[i][0]
            )
        return total


@dataclass
class TrainArrival:
    """Single train arrival at a station."""
    train_id: str  # codi_servei
    line_code: str
    direction: int  # 1 or 2 (via)
    station_code: str
    seconds_to_arrival: int
    destination: str
    route_code: str
    occupancy_percent: int | None = None


@dataclass
class EstimatedPosition:
    """Estimated train position."""
    vehicle_key: str
    line_code: str
    route_id: str | None
    direction_id: int
    latitude: float
    longitude: float
    bearing: float | None
    previous_stop_id: str | None
    next_stop_id: str | None
    previous_stop_name: str | None
    next_stop_name: str | None
    status: str  # IN_TRANSIT_TO, ARRIVING, STOPPED_AT
    progress_fraction: float
    distance_along_line: float
    estimated_speed_mps: float
    line_total_length: float
    source: str = "imetro"
    confidence: str = "medium"
    arrival_seconds_to_next: int | None = None


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance between two points in meters using Haversine formula."""
    R = 6371000  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = math.sin(delta_phi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

    return R * c


def calculate_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate bearing from point 1 to point 2 in degrees."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_lambda = math.radians(lon2 - lon1)

    x = math.sin(delta_lambda) * math.cos(phi2)
    y = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(delta_lambda)

    bearing = math.degrees(math.atan2(x, y))
    return (bearing + 360) % 360


def interpolate_position(
    start: tuple[float, float],
    end: tuple[float, float],
    fraction: float
) -> tuple[float, float]:
    """Interpolate position between two points."""
    lng = start[0] + (end[0] - start[0]) * fraction
    lat = start[1] + (end[1] - start[1]) * fraction
    return (lng, lat)


def load_stations_from_geojson(path: Path) -> dict[str, Station]:
    """Load station data from GeoJSON file."""
    stations: dict[str, Station] = {}

    if not path.exists():
        LOGGER.warning("Stations GeoJSON not found: %s", path)
        return stations

    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    for feature in data.get("features", []):
        props = feature.get("properties", {})
        coords = feature.get("geometry", {}).get("coordinates", [])

        if len(coords) >= 2:
            stop_code = str(props.get("stop_code", ""))
            station = Station(
                stop_id=props.get("id", ""),
                stop_code=stop_code,
                name=props.get("name", ""),
                longitude=coords[0],
                latitude=coords[1],
                lines=props.get("lines", []),
            )
            stations[stop_code] = station

    LOGGER.info("Loaded %d stations from %s", len(stations), path)
    return stations


def load_line_geometries(lines_dir: Path) -> dict[str, LineGeometry]:
    """Load line geometries from GeoJSON files."""
    geometries: dict[str, LineGeometry] = {}

    if not lines_dir.exists():
        LOGGER.warning("Lines directory not found: %s", lines_dir)
        return geometries

    for geojson_file in lines_dir.glob("*.geojson"):
        try:
            with open(geojson_file, encoding="utf-8") as f:
                data = json.load(f)

            for feature in data.get("features", []):
                props = feature.get("properties", {})
                line_code = props.get("line_code", "")
                geom = feature.get("geometry", {})

                if geom.get("type") == "LineString" and line_code:
                    coords = [(c[0], c[1]) for c in geom.get("coordinates", [])]
                    geometries[line_code] = LineGeometry(
                        line_code=line_code,
                        coordinates=coords,
                    )
        except Exception as e:
            LOGGER.warning("Failed to load %s: %s", geojson_file, e)

    LOGGER.info("Loaded %d line geometries", len(geometries))
    return geometries


def fetch_imetro_arrivals(app_id: str, app_key: str) -> list[dict[str, Any]]:
    """Fetch arrivals from iMetro API."""
    url = f"{IMETRO_API_URL}?app_id={app_id}&app_key={app_key}"

    response = requests.get(url, timeout=HTTP_TIMEOUT)
    response.raise_for_status()

    return response.json()


def parse_arrivals(raw_data: list[dict[str, Any]]) -> list[TrainArrival]:
    """Parse raw API response into TrainArrival objects."""
    arrivals: list[TrainArrival] = []

    for entry in raw_data:
        line_num = entry.get("codi_linia")
        direction = entry.get("codi_via", 1)
        station_code = str(entry.get("codi_estacio", ""))

        line_code = LINE_CODE_MAP.get(line_num, f"L{line_num}")

        for train in entry.get("propers_trens", []):
            train_id = train.get("codi_servei", "")
            if not train_id:
                continue

            # Get occupancy if available
            occupancy = None
            info_tren = train.get("info_tren", {})
            if info_tren:
                occupancy = info_tren.get("percentatge_ocupacio")

            # Determine full line code (L9N/L9S, L10N/L10S based on route)
            nom_linia = train.get("nom_linia", line_code)
            if nom_linia:
                line_code = nom_linia

            arrivals.append(TrainArrival(
                train_id=train_id,
                line_code=line_code,
                direction=direction,
                station_code=station_code,
                seconds_to_arrival=train.get("temps_restant", 0),
                destination=train.get("desti_trajecte", ""),
                route_code=train.get("codi_trajecte", ""),
                occupancy_percent=occupancy,
            ))

    return arrivals


def group_arrivals_by_train(arrivals: list[TrainArrival]) -> dict[str, list[TrainArrival]]:
    """Group arrivals by train ID + direction."""
    groups: dict[str, list[TrainArrival]] = {}

    for arrival in arrivals:
        # Key by train_id + line + direction to handle same train ID on different lines
        key = f"{arrival.line_code}-{arrival.direction}-{arrival.train_id}"
        if key not in groups:
            groups[key] = []
        groups[key].append(arrival)

    # Sort each group by seconds_to_arrival
    for key in groups:
        groups[key].sort(key=lambda a: a.seconds_to_arrival)

    return groups


def estimate_train_position(
    train_key: str,
    arrivals: list[TrainArrival],
    stations: dict[str, Station],
    line_geometries: dict[str, LineGeometry],
) -> EstimatedPosition | None:
    """Estimate a train's position based on its arrivals."""
    if not arrivals:
        return None

    # Get the train's next station (smallest arrival time)
    next_arrival = arrivals[0]
    line_code = next_arrival.line_code
    direction = next_arrival.direction

    # Get station coordinates
    next_station = stations.get(next_arrival.station_code)
    if not next_station:
        LOGGER.debug("Station not found: %s", next_arrival.station_code)
        return None

    # Determine status and position
    seconds_to_next = next_arrival.seconds_to_arrival

    if seconds_to_next <= 30:
        # Train is arriving or at station
        status = "ARRIVING" if seconds_to_next > 0 else "STOPPED_AT"
        lat, lng = next_station.latitude, next_station.longitude
        progress = 1.0
        prev_station = None
        bearing = None
    else:
        # Train is in transit - find previous station
        status = "IN_TRANSIT_TO"

        # Previous station is either from arrivals list or we estimate
        prev_station = None
        if len(arrivals) >= 2:
            # The second arrival is actually at a station further away
            # We need to find a station with negative time (just passed)
            # For now, use simple interpolation between estimated previous and next
            pass

        # Estimate position based on typical segment time
        # If we have 120s to next station and segment takes 120s, we're at the previous station
        # If we have 60s to next station and segment takes 120s, we're halfway
        segment_time = DEFAULT_SEGMENT_TIME_SECONDS
        progress = max(0.0, min(1.0, 1.0 - (seconds_to_next / segment_time)))

        # For now, place train at a fraction of distance before the station
        # In a more sophisticated version, we'd interpolate along line geometry
        line_geom = line_geometries.get(line_code)
        if line_geom and len(line_geom.coordinates) > 1:
            # Find station position in line geometry and interpolate backwards
            lat, lng = next_station.latitude, next_station.longitude

            # Simple: move back along line by progress fraction
            # Find the closest point on line to the station
            station_idx = find_closest_point_index(
                line_geom.coordinates,
                (next_station.longitude, next_station.latitude)
            )

            if station_idx > 0:
                # Calculate how far back to go
                points_back = int((1 - progress) * min(station_idx, 20))
                if points_back > 0:
                    prev_idx = max(0, station_idx - points_back)
                    prev_coord = line_geom.coordinates[prev_idx]
                    next_coord = line_geom.coordinates[station_idx]

                    # Interpolate between points
                    inter_progress = progress * points_back / max(1, points_back)
                    lng, lat = interpolate_position(prev_coord, next_coord, inter_progress)

                    # Calculate bearing
                    bearing = calculate_bearing(
                        prev_coord[1], prev_coord[0],
                        next_coord[1], next_coord[0]
                    )
        else:
            lat, lng = next_station.latitude, next_station.longitude
            bearing = None

    # Build vehicle key
    vehicle_key = f"metro-{line_code}-{direction}-{next_arrival.train_id}"

    # Get line total length
    line_geom = line_geometries.get(line_code)
    line_length = line_geom.total_length_meters if line_geom else 0.0

    # Estimate speed (very rough)
    avg_speed_mps = 8.33  # ~30 km/h average metro speed

    # Determine confidence based on arrival time
    if seconds_to_next < 60:
        confidence = "high"
    elif seconds_to_next < 300:
        confidence = "medium"
    else:
        confidence = "low"

    return EstimatedPosition(
        vehicle_key=vehicle_key,
        line_code=line_code,
        route_id=f"1.{LINE_CODE_MAP.get(int(line_code[1:].rstrip('NS')), line_code)}.{direction}",
        direction_id=0 if direction == 1 else 1,
        latitude=lat,
        longitude=lng,
        bearing=bearing if 'bearing' in dir() else None,
        previous_stop_id=None,  # Would need station order data
        next_stop_id=next_station.stop_id,
        previous_stop_name=None,
        next_stop_name=next_station.name,
        status=status,
        progress_fraction=progress,
        distance_along_line=0.0,  # Would need to calculate
        estimated_speed_mps=avg_speed_mps,
        line_total_length=line_length,
        source="imetro",
        confidence=confidence,
        arrival_seconds_to_next=seconds_to_next,
    )


def find_closest_point_index(
    coordinates: list[tuple[float, float]],
    target: tuple[float, float]
) -> int:
    """Find index of closest point in coordinate list to target."""
    min_dist = float("inf")
    min_idx = 0

    for i, coord in enumerate(coordinates):
        dist = haversine_distance(coord[1], coord[0], target[1], target[0])
        if dist < min_dist:
            min_dist = dist
            min_idx = i

    return min_idx


def connect_db(database_url: str) -> psycopg2.extensions.connection:
    """Connect to PostgreSQL database."""
    conn = psycopg2.connect(database_url)
    conn.autocommit = False
    return conn


def ensure_snapshot(conn: psycopg2.extensions.connection, polled_at: datetime) -> uuid.UUID:
    """Create a snapshot record and return its ID."""
    snapshot_id = uuid.uuid4()

    with conn.cursor() as cur:
        cur.execute(
            f"""
            INSERT INTO {SNAPSHOTS_TABLE} (snapshot_id, polled_at_utc)
            VALUES (%s, %s)
            ON CONFLICT (snapshot_id) DO NOTHING
            """,
            (str(snapshot_id), polled_at),
        )

    return snapshot_id


def write_positions_to_db(
    conn: psycopg2.extensions.connection,
    snapshot_id: uuid.UUID,
    positions: list[EstimatedPosition],
    polled_at: datetime,
) -> None:
    """Write estimated positions to database."""
    if not positions:
        return

    now = datetime.now(timezone.utc)

    # Write to current table (upsert)
    current_sql = f"""
        INSERT INTO {METRO_CURRENT_TABLE} (
            vehicle_key, snapshot_id, line_code, route_id, direction_id,
            latitude, longitude, bearing,
            previous_stop_id, next_stop_id, previous_stop_name, next_stop_name,
            status, progress_fraction, distance_along_line, estimated_speed_mps,
            line_total_length, source, confidence, arrival_seconds_to_next,
            estimated_at_utc, polled_at_utc, updated_at
        ) VALUES (
            %s, %s, %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s
        )
        ON CONFLICT (vehicle_key) DO UPDATE SET
            snapshot_id = EXCLUDED.snapshot_id,
            line_code = EXCLUDED.line_code,
            route_id = EXCLUDED.route_id,
            direction_id = EXCLUDED.direction_id,
            latitude = EXCLUDED.latitude,
            longitude = EXCLUDED.longitude,
            bearing = EXCLUDED.bearing,
            previous_stop_id = EXCLUDED.previous_stop_id,
            next_stop_id = EXCLUDED.next_stop_id,
            previous_stop_name = EXCLUDED.previous_stop_name,
            next_stop_name = EXCLUDED.next_stop_name,
            status = EXCLUDED.status,
            progress_fraction = EXCLUDED.progress_fraction,
            distance_along_line = EXCLUDED.distance_along_line,
            estimated_speed_mps = EXCLUDED.estimated_speed_mps,
            line_total_length = EXCLUDED.line_total_length,
            source = EXCLUDED.source,
            confidence = EXCLUDED.confidence,
            arrival_seconds_to_next = EXCLUDED.arrival_seconds_to_next,
            estimated_at_utc = EXCLUDED.estimated_at_utc,
            polled_at_utc = EXCLUDED.polled_at_utc,
            updated_at = EXCLUDED.updated_at
    """

    current_rows = [
        (
            p.vehicle_key, str(snapshot_id), p.line_code, p.route_id, p.direction_id,
            p.latitude, p.longitude, p.bearing,
            p.previous_stop_id, p.next_stop_id, p.previous_stop_name, p.next_stop_name,
            p.status, p.progress_fraction, p.distance_along_line, p.estimated_speed_mps,
            p.line_total_length, p.source, p.confidence, p.arrival_seconds_to_next,
            now, polled_at, now,
        )
        for p in positions
    ]

    with conn.cursor() as cur:
        execute_batch(cur, current_sql, current_rows, page_size=100)

    # Write to history table
    history_sql = f"""
        INSERT INTO {METRO_HISTORY_TABLE} (
            vehicle_key, snapshot_id, line_code, direction_id,
            latitude, longitude, bearing,
            previous_stop_id, next_stop_id, status, progress_fraction,
            polled_at_utc
        ) VALUES (
            %s, %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s, %s,
            %s
        )
        ON CONFLICT (vehicle_key, snapshot_id) DO NOTHING
    """

    history_rows = [
        (
            p.vehicle_key, str(snapshot_id), p.line_code, p.direction_id,
            p.latitude, p.longitude, p.bearing,
            p.previous_stop_id, p.next_stop_id, p.status, p.progress_fraction,
            polled_at,
        )
        for p in positions
    ]

    with conn.cursor() as cur:
        execute_batch(cur, history_sql, history_rows, page_size=100)

    conn.commit()
    LOGGER.info("Wrote %d Metro positions to database", len(positions))


def prune_old_history(
    conn: psycopg2.extensions.connection,
    retention_hours: float = 24.0,
) -> int:
    """Delete history records older than retention period."""
    with conn.cursor() as cur:
        cur.execute(
            f"""
            DELETE FROM {METRO_HISTORY_TABLE}
            WHERE polled_at_utc < NOW() - INTERVAL '%s hours'
            """,
            (retention_hours,),
        )
        deleted = cur.rowcount
    conn.commit()

    if deleted > 0:
        LOGGER.info("Pruned %d old Metro history records", deleted)

    return deleted


def parse_args() -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="Poll TMB iMetro API and estimate Metro train positions."
    )
    parser.add_argument(
        "--database-url",
        default=os.getenv("DATABASE_URL"),
        help="PostgreSQL connection string (defaults to DATABASE_URL env var).",
    )
    parser.add_argument(
        "--app-id",
        default=os.getenv("TMB_APP_ID"),
        help="TMB API App ID (defaults to TMB_APP_ID env var).",
    )
    parser.add_argument(
        "--app-key",
        default=os.getenv("TMB_APP_KEY"),
        help="TMB API App Key (defaults to TMB_APP_KEY env var).",
    )
    parser.add_argument(
        "--stations-geojson",
        default="../../web/public/tmb_data/metro/stations.geojson",
        help="Path to Metro stations GeoJSON file.",
    )
    parser.add_argument(
        "--lines-dir",
        default="../../web/public/tmb_data/metro/lines",
        help="Path to directory containing line geometry GeoJSON files.",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=30.0,
        help="Seconds between polling iterations (default: 30).",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run once and exit instead of continuous polling.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch data but don't write to database.",
    )
    parser.add_argument(
        "--history-retention-hours",
        type=float,
        default=24.0,
        help="Hours to retain in history table (default: 24).",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Enable verbose logging.",
    )
    return parser.parse_args()


def main() -> None:
    """Main entry point."""
    # Load environment from .env files
    load_dotenv("../../.env")
    load_dotenv("../../.env.local", override=True)

    args = parse_args()

    # Configure logging
    log_level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Validate required arguments
    if not args.database_url:
        LOGGER.error("DATABASE_URL is required")
        sys.exit(1)

    if not args.app_id or not args.app_key:
        LOGGER.error("TMB_APP_ID and TMB_APP_KEY are required")
        sys.exit(1)

    # Resolve paths relative to script location
    script_dir = Path(__file__).parent
    stations_path = (script_dir / args.stations_geojson).resolve()
    lines_dir = (script_dir / args.lines_dir).resolve()

    # Load static data
    LOGGER.info("Loading station data from %s", stations_path)
    stations = load_stations_from_geojson(stations_path)

    LOGGER.info("Loading line geometries from %s", lines_dir)
    line_geometries = load_line_geometries(lines_dir)

    if not stations:
        LOGGER.error("No stations loaded - cannot estimate positions")
        sys.exit(1)

    # Connect to database
    conn = None
    if not args.dry_run:
        LOGGER.info("Connecting to database")
        conn = connect_db(args.database_url)

    # Set up signal handler for graceful shutdown
    running = True

    def signal_handler(sig, frame):
        nonlocal running
        LOGGER.info("Received signal %s, shutting down...", sig)
        running = False

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # Main polling loop
    LOGGER.info("Starting Metro poller (interval: %ds)", args.interval)

    while running:
        try:
            poll_start = time.time()
            polled_at = datetime.now(timezone.utc)

            # Fetch from iMetro API
            LOGGER.info("Fetching iMetro data...")
            raw_data = fetch_imetro_arrivals(args.app_id, args.app_key)
            LOGGER.info("Received %d station entries", len(raw_data))

            # Parse arrivals
            arrivals = parse_arrivals(raw_data)
            LOGGER.info("Parsed %d train arrivals", len(arrivals))

            # Group by train
            train_groups = group_arrivals_by_train(arrivals)
            LOGGER.info("Found %d active trains", len(train_groups))

            # Estimate positions
            positions: list[EstimatedPosition] = []
            for train_key, train_arrivals in train_groups.items():
                pos = estimate_train_position(
                    train_key, train_arrivals, stations, line_geometries
                )
                if pos:
                    positions.append(pos)

            LOGGER.info("Estimated %d train positions", len(positions))

            # Write to database
            if conn and positions:
                snapshot_id = ensure_snapshot(conn, polled_at)
                write_positions_to_db(conn, snapshot_id, positions, polled_at)

                # Prune old history periodically
                prune_old_history(conn, args.history_retention_hours)

            poll_duration = time.time() - poll_start
            LOGGER.info("Poll completed in %.2fs", poll_duration)

            # Exit if --once flag
            if args.once:
                break

            # Sleep until next poll
            sleep_time = max(0, args.interval - poll_duration)
            if sleep_time > 0 and running:
                time.sleep(sleep_time)

        except requests.RequestException as e:
            LOGGER.error("API request failed: %s", e)
            if args.once:
                sys.exit(1)
            time.sleep(min(args.interval, 10))

        except psycopg2.Error as e:
            LOGGER.error("Database error: %s", e)
            if conn:
                conn.rollback()
            if args.once:
                sys.exit(1)
            time.sleep(min(args.interval, 10))

        except Exception as e:
            LOGGER.exception("Unexpected error: %s", e)
            if args.once:
                sys.exit(1)
            time.sleep(min(args.interval, 10))

    # Cleanup
    if conn:
        conn.close()

    LOGGER.info("Metro poller stopped")


if __name__ == "__main__":
    main()
