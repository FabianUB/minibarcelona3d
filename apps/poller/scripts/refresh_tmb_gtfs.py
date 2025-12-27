#!/usr/bin/env python3
"""Refresh TMB static GTFS dimensions (Metro, Bus, Funicular) from TMB API."""
from __future__ import annotations

import argparse
import csv
import io
import logging
import os
from pathlib import Path
from typing import Iterable
import zipfile

import psycopg2
import requests
from psycopg2.extras import execute_batch

from poll_to_postgres import ensure_schema

LOGGER = logging.getLogger(__name__)
BATCH_SIZE = 2000
NETWORK = "tmb"
TMB_GTFS_URL = "https://api.tmb.cat/v1/static/datasets/gtfs.zip"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Load TMB GTFS static data (Metro, Bus, Funicular) into PostgreSQL dimension tables.",
    )
    parser.add_argument(
        "--zip-path",
        default="data/static/tmb_gtfs.zip",
        help="Path to store/use the TMB GTFS static zip (default: data/static/tmb_gtfs.zip).",
    )
    parser.add_argument(
        "--force-download",
        action="store_true",
        help="Force re-download even if the zip file exists.",
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
    return parser.parse_args()


def ensure_database_url(url: str | None) -> str:
    if not url:
        raise SystemExit(
            "Database URL not provided. Use --database-url or set DATABASE_URL env var."
        )
    return url


def ensure_tmb_credentials(app_id: str | None, app_key: str | None) -> tuple[str, str]:
    if not app_id or not app_key:
        raise SystemExit(
            "TMB API credentials not provided. Use --app-id/--app-key or set TMB_APP_ID/TMB_APP_KEY env vars."
        )
    return app_id, app_key


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _to_int(value: str | None) -> int | None:
    value = _clean(value)
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _to_float(value: str | None) -> float | None:
    value = _clean(value)
    if value is None:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _time_to_seconds(value: str | None) -> int | None:
    value = _clean(value)
    if value is None:
        return None
    parts = value.split(":")
    if len(parts) < 2:
        return None
    try:
        hours = int(parts[0])
        minutes = int(parts[1])
        seconds = int(parts[2]) if len(parts) > 2 else 0
    except ValueError:
        return None
    return hours * 3600 + minutes * 60 + seconds


def _open_csv(zf: zipfile.ZipFile, name: str) -> zipfile.ZipExtFile:
    try:
        return zf.open(name)
    except KeyError as exc:
        raise SystemExit(f"File {name} not found inside {zf.filename}") from exc


def _download_tmb_gtfs(app_id: str, app_key: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    url = f"{TMB_GTFS_URL}?app_id={app_id}&app_key={app_key}"
    LOGGER.info("Downloading TMB GTFS bundle from TMB API")
    with requests.get(url, stream=True, timeout=120) as response:
        response.raise_for_status()
        with open(dest, "wb") as fh:
            for chunk in response.iter_content(chunk_size=1 << 20):
                if chunk:
                    fh.write(chunk)
    LOGGER.info("Saved TMB GTFS bundle to %s (%s bytes)", dest, dest.stat().st_size)
    return dest


def delete_network_data(conn: psycopg2.extensions.connection, network: str) -> None:
    """Delete all dimension data for a specific network."""
    with conn.cursor() as cur:
        # Delete in order respecting foreign keys
        cur.execute("DELETE FROM dim_shapes WHERE network = %s", (network,))
        cur.execute("DELETE FROM dim_stop_times WHERE network = %s", (network,))
        cur.execute("DELETE FROM dim_trips WHERE network = %s", (network,))
        cur.execute("DELETE FROM dim_stops WHERE network = %s", (network,))
        cur.execute("DELETE FROM dim_routes WHERE network = %s", (network,))
    conn.commit()
    LOGGER.info("Deleted existing %s dimension data", network)


def load_routes(conn: psycopg2.extensions.connection, reader: Iterable[dict[str, str]], network: str) -> int:
    rows: list[tuple] = []
    count = 0
    with conn.cursor() as cur:
        for row in reader:
            route_id = _clean(row.get("route_id"))
            if not route_id:
                continue
            short_name = _clean(row.get("route_short_name"))
            long_name = _clean(row.get("route_long_name"))
            route_type = _to_int(row.get("route_type"))
            color = _clean(row.get("route_color"))
            text_color = _clean(row.get("route_text_color"))
            line_code = short_name
            rows.append(
                (
                    route_id,
                    line_code,
                    short_name,
                    long_name,
                    route_type,
                    color,
                    text_color,
                    network,
                )
            )
            count += 1
            if len(rows) >= BATCH_SIZE:
                execute_batch(
                    cur,
                    """
                    INSERT INTO dim_routes (
                        route_id, line_code, short_name, long_name,
                        route_type, color, text_color, network
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (route_id) DO UPDATE SET
                        line_code = EXCLUDED.line_code,
                        short_name = EXCLUDED.short_name,
                        long_name = EXCLUDED.long_name,
                        route_type = EXCLUDED.route_type,
                        color = EXCLUDED.color,
                        text_color = EXCLUDED.text_color,
                        network = EXCLUDED.network,
                        updated_at = now()
                    """,
                    rows,
                )
                rows.clear()
        if rows:
            execute_batch(
                cur,
                """
                INSERT INTO dim_routes (
                    route_id, line_code, short_name, long_name,
                    route_type, color, text_color, network
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (route_id) DO UPDATE SET
                    line_code = EXCLUDED.line_code,
                    short_name = EXCLUDED.short_name,
                    long_name = EXCLUDED.long_name,
                    route_type = EXCLUDED.route_type,
                    color = EXCLUDED.color,
                    text_color = EXCLUDED.text_color,
                    network = EXCLUDED.network,
                    updated_at = now()
                """,
                rows,
            )
    conn.commit()
    LOGGER.info("Loaded %d routes for network=%s", count, network)
    return count


def load_stops(conn: psycopg2.extensions.connection, reader: Iterable[dict[str, str]], network: str) -> int:
    rows: list[tuple] = []
    count = 0
    with conn.cursor() as cur:
        for row in reader:
            stop_id = _clean(row.get("stop_id"))
            if not stop_id:
                continue
            stop_code = _clean(row.get("stop_code"))
            name = _clean(row.get("stop_name"))
            lat = _to_float(row.get("stop_lat"))
            lon = _to_float(row.get("stop_lon"))
            location_type = _to_int(row.get("location_type")) or 0
            parent_station = _clean(row.get("parent_station"))
            wheelchair = _to_int(row.get("wheelchair_boarding"))
            rows.append((stop_id, stop_code, name, lat, lon, location_type, parent_station, wheelchair, network))
            count += 1
            if len(rows) >= BATCH_SIZE:
                execute_batch(
                    cur,
                    """
                    INSERT INTO dim_stops (
                        stop_id, stop_code, name, lat, lon, location_type, parent_station, wheelchair_boarding, network
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (stop_id) DO UPDATE SET
                        stop_code = EXCLUDED.stop_code,
                        name = EXCLUDED.name,
                        lat = EXCLUDED.lat,
                        lon = EXCLUDED.lon,
                        location_type = EXCLUDED.location_type,
                        parent_station = EXCLUDED.parent_station,
                        wheelchair_boarding = EXCLUDED.wheelchair_boarding,
                        network = EXCLUDED.network,
                        updated_at = now()
                    """,
                    rows,
                )
                rows.clear()
        if rows:
            execute_batch(
                cur,
                """
                INSERT INTO dim_stops (
                    stop_id, stop_code, name, lat, lon, location_type, parent_station, wheelchair_boarding, network
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (stop_id) DO UPDATE SET
                    stop_code = EXCLUDED.stop_code,
                    name = EXCLUDED.name,
                    lat = EXCLUDED.lat,
                    lon = EXCLUDED.lon,
                    location_type = EXCLUDED.location_type,
                    parent_station = EXCLUDED.parent_station,
                    wheelchair_boarding = EXCLUDED.wheelchair_boarding,
                    network = EXCLUDED.network,
                    updated_at = now()
                """,
                rows,
            )
    conn.commit()
    LOGGER.info("Loaded %d stops for network=%s", count, network)
    return count


def load_trips(conn: psycopg2.extensions.connection, reader: Iterable[dict[str, str]], network: str) -> int:
    rows: list[tuple] = []
    count = 0
    with conn.cursor() as cur:
        for row in reader:
            trip_id = _clean(row.get("trip_id"))
            if not trip_id:
                continue
            route_id = _clean(row.get("route_id"))
            service_id = _clean(row.get("service_id"))
            shape_id = _clean(row.get("shape_id"))
            direction_id = _to_int(row.get("direction_id"))
            trip_headsign = _clean(row.get("trip_headsign"))
            block_id = _clean(row.get("block_id"))
            wheelchair = _to_int(row.get("wheelchair_accessible"))
            rows.append((trip_id, route_id, service_id, shape_id, direction_id, trip_headsign, block_id, wheelchair, network))
            count += 1
            if len(rows) >= BATCH_SIZE:
                execute_batch(
                    cur,
                    """
                    INSERT INTO dim_trips (
                        trip_id, route_id, service_id, shape_id, direction_id, trip_headsign, block_id, wheelchair_accessible, network
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (trip_id) DO UPDATE SET
                        route_id = EXCLUDED.route_id,
                        service_id = EXCLUDED.service_id,
                        shape_id = EXCLUDED.shape_id,
                        direction_id = EXCLUDED.direction_id,
                        trip_headsign = EXCLUDED.trip_headsign,
                        block_id = EXCLUDED.block_id,
                        wheelchair_accessible = EXCLUDED.wheelchair_accessible,
                        network = EXCLUDED.network,
                        updated_at = now()
                    """,
                    rows,
                )
                rows.clear()
        if rows:
            execute_batch(
                cur,
                """
                INSERT INTO dim_trips (
                    trip_id, route_id, service_id, shape_id, direction_id, trip_headsign, block_id, wheelchair_accessible, network
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (trip_id) DO UPDATE SET
                    route_id = EXCLUDED.route_id,
                    service_id = EXCLUDED.service_id,
                    shape_id = EXCLUDED.shape_id,
                    direction_id = EXCLUDED.direction_id,
                    trip_headsign = EXCLUDED.trip_headsign,
                    block_id = EXCLUDED.block_id,
                    wheelchair_accessible = EXCLUDED.wheelchair_accessible,
                    network = EXCLUDED.network,
                    updated_at = now()
                """,
                rows,
            )
    conn.commit()
    LOGGER.info("Loaded %d trips for network=%s", count, network)
    return count


def load_stop_times(
    conn: psycopg2.extensions.connection,
    reader: Iterable[dict[str, str]],
    network: str,
) -> int:
    rows: list[tuple] = []
    count = 0

    # DictReader instances expose fieldnames; normalize them to avoid trailing whitespace
    fieldnames = getattr(reader, "fieldnames", None)
    if fieldnames:
        normalized = [name.strip() if isinstance(name, str) else name for name in fieldnames]
        if normalized != fieldnames:
            reader.fieldnames = normalized  # type: ignore[attr-defined]

    with conn.cursor() as cur:
        for row in reader:
            if "stop_sequence" not in row:
                row = {k.strip() if isinstance(k, str) else k: v for k, v in row.items()}
            trip_id = _clean(row.get("trip_id"))
            stop_id = _clean(row.get("stop_id"))
            stop_sequence = _to_int(row.get("stop_sequence"))
            if not trip_id or not stop_id or stop_sequence is None:
                continue
            arrival_seconds = _time_to_seconds(row.get("arrival_time"))
            departure_seconds = _time_to_seconds(row.get("departure_time"))
            rows.append(
                (
                    trip_id,
                    stop_sequence,
                    stop_id,
                    arrival_seconds,
                    departure_seconds,
                    network,
                )
            )
            count += 1
            if len(rows) >= BATCH_SIZE:
                execute_batch(
                    cur,
                    """
                    INSERT INTO dim_stop_times (
                        trip_id, stop_sequence, stop_id, arrival_seconds, departure_seconds, network
                    ) VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (trip_id, stop_sequence) DO UPDATE SET
                        stop_id = EXCLUDED.stop_id,
                        arrival_seconds = EXCLUDED.arrival_seconds,
                        departure_seconds = EXCLUDED.departure_seconds,
                        network = EXCLUDED.network
                    """,
                    rows,
                )
                rows.clear()
        if rows:
            execute_batch(
                cur,
                """
                INSERT INTO dim_stop_times (
                    trip_id, stop_sequence, stop_id, arrival_seconds, departure_seconds, network
                ) VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (trip_id, stop_sequence) DO UPDATE SET
                    stop_id = EXCLUDED.stop_id,
                    arrival_seconds = EXCLUDED.arrival_seconds,
                    departure_seconds = EXCLUDED.departure_seconds,
                    network = EXCLUDED.network
                """,
                rows,
            )
    conn.commit()
    LOGGER.info("Loaded %d stop_time rows for network=%s", count, network)
    return count


def load_shapes(
    conn: psycopg2.extensions.connection,
    reader: Iterable[dict[str, str]],
    network: str,
) -> int:
    rows: list[tuple] = []
    count = 0

    with conn.cursor() as cur:
        for row in reader:
            shape_id = _clean(row.get("shape_id"))
            shape_pt_sequence = _to_int(row.get("shape_pt_sequence"))
            shape_pt_lat = _to_float(row.get("shape_pt_lat"))
            shape_pt_lon = _to_float(row.get("shape_pt_lon"))
            if not shape_id or shape_pt_sequence is None or shape_pt_lat is None or shape_pt_lon is None:
                continue
            rows.append((network, shape_id, shape_pt_sequence, shape_pt_lat, shape_pt_lon))
            count += 1
            if len(rows) >= BATCH_SIZE:
                execute_batch(
                    cur,
                    """
                    INSERT INTO dim_shapes (
                        network, shape_id, shape_pt_sequence, shape_pt_lat, shape_pt_lon
                    ) VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (shape_id, shape_pt_sequence) DO UPDATE SET
                        network = EXCLUDED.network,
                        shape_pt_lat = EXCLUDED.shape_pt_lat,
                        shape_pt_lon = EXCLUDED.shape_pt_lon
                    """,
                    rows,
                )
                rows.clear()
        if rows:
            execute_batch(
                cur,
                """
                INSERT INTO dim_shapes (
                    network, shape_id, shape_pt_sequence, shape_pt_lat, shape_pt_lon
                ) VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (shape_id, shape_pt_sequence) DO UPDATE SET
                    network = EXCLUDED.network,
                    shape_pt_lat = EXCLUDED.shape_pt_lat,
                    shape_pt_lon = EXCLUDED.shape_pt_lon
                """,
                rows,
            )
    conn.commit()
    LOGGER.info("Loaded %d shape points for network=%s", count, network)
    return count


def main() -> None:
    args = parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    database_url = ensure_database_url(args.database_url)
    app_id, app_key = ensure_tmb_credentials(args.app_id, args.app_key)
    zip_path = Path(args.zip_path)

    if not zip_path.exists() or args.force_download:
        _download_tmb_gtfs(app_id, app_key, zip_path)
    else:
        LOGGER.info("Using existing TMB GTFS bundle at %s", zip_path)

    conn = psycopg2.connect(database_url)
    conn.autocommit = False
    try:
        LOGGER.info("Ensuring dimension tables exist before reload.")
        ensure_schema(conn)

        LOGGER.info("Deleting existing TMB dimension data before reload.")
        delete_network_data(conn, NETWORK)

        with zipfile.ZipFile(zip_path) as zf:
            LOGGER.info("Loading routes.txt")
            with _open_csv(zf, "routes.txt") as raw:
                load_routes(conn, csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig")), NETWORK)

            LOGGER.info("Loading stops.txt")
            with _open_csv(zf, "stops.txt") as raw:
                load_stops(conn, csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig")), NETWORK)

            LOGGER.info("Loading trips.txt")
            with _open_csv(zf, "trips.txt") as raw:
                load_trips(conn, csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig")), NETWORK)

            LOGGER.info("Loading stop_times.txt (this may take a while)")
            with _open_csv(zf, "stop_times.txt") as raw:
                load_stop_times(
                    conn,
                    csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig")),
                    NETWORK,
                )

            LOGGER.info("Loading shapes.txt")
            with _open_csv(zf, "shapes.txt") as raw:
                load_shapes(
                    conn,
                    csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig")),
                    NETWORK,
                )

        LOGGER.info("TMB GTFS dimensions refreshed successfully.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
