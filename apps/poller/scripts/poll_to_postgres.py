#!/usr/bin/env python3
"""Poll GTFS-RT feeds and persist snapshots into PostgreSQL staging tables."""
from __future__ import annotations

import argparse
import csv
import logging
import os
import signal
import subprocess
import sys
import time
import uuid
from datetime import datetime, time as dt_time, timedelta, timezone
from pathlib import Path
from dataclasses import dataclass
from enum import Enum
from typing import Iterable, Mapping, Sequence

try:
    import poll_gtfs
except ImportError:  # pragma: no cover - support package import during testing
    from . import poll_gtfs  # type: ignore
import psycopg2
from dotenv import load_dotenv
import requests
from google.protobuf.json_format import MessageToDict
from google.transit import gtfs_realtime_pb2
from psycopg2.extras import execute_batch
from zoneinfo import ZoneInfo

LOGGER = logging.getLogger(__name__)
MADRID_TZ = ZoneInfo("Europe/Madrid")

VEHICLE_POSITIONS_TABLE = "rt_vehicle_positions"
RODALIES_POSITIONS_TABLE = "rt_rodalies_vehicle_positions"
RODALIES_CURRENT_TABLE = "rt_rodalies_vehicle_current"
RODALIES_HISTORY_TABLE = "rt_rodalies_vehicle_history"


@dataclass
class StopTimeEntry:
    stop_sequence: int
    stop_id: str
    arrival_seconds: int | None
    departure_seconds: int | None


@dataclass(frozen=True)
class VehiclePositionRecord:
    snapshot_id: uuid.UUID
    entity_id: str
    vehicle_id: str | None
    vehicle_label: str | None
    trip_id: str | None
    route_id: str | None
    current_stop_id: str | None
    previous_stop_id: str | None
    next_stop_id: str | None
    next_stop_sequence: int | None
    status: str | None
    latitude: float | None
    longitude: float | None
    vehicle_timestamp_utc: datetime | None

    def as_positions_tuple(self) -> tuple:
        return (
            str(self.snapshot_id),
            self.entity_id,
            self.vehicle_id,
            self.vehicle_label,
            self.trip_id,
            self.route_id,
            self.current_stop_id,
            self.previous_stop_id,
            self.next_stop_id,
            self.next_stop_sequence,
            self.status,
            self.latitude,
            self.longitude,
        )


@dataclass(frozen=True)
class TripDelaySnapshot:
    arrival_delay_seconds: int | None
    departure_delay_seconds: int | None
    schedule_relationship: str | None
    predicted_arrival_utc: datetime | None
    predicted_departure_utc: datetime | None


def _parse_time_of_day(value: str) -> dt_time:
    parts = value.split(":")
    if len(parts) not in (2, 3):
        raise ValueError(f"Invalid time format: {value!r}")
    try:
        hour = int(parts[0])
        minute = int(parts[1])
        second = int(parts[2]) if len(parts) == 3 else 0
    except ValueError as exc:
        raise ValueError(f"Invalid time components in {value!r}") from exc
    if not (0 <= hour < 24 and 0 <= minute < 60 and 0 <= second < 60):
        raise ValueError(f"Time out of range: {value!r}")
    return dt_time(hour=hour, minute=minute, second=second)


def _time_to_seconds(value: str | None) -> int | None:
    if not value:
        return None
    value = value.strip()
    if not value:
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


def _to_bool(value: str | None) -> bool:
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _vehicle_key(vehicle_id: str | None, entity_id: str) -> str:
    if vehicle_id:
        return vehicle_id
    return f"entity:{entity_id}"


class StopTimesCsvFallback:
    """Lazy loader for stop_times rows sourced from a CSV file."""

    def __init__(self, csv_path: Path) -> None:
        self.csv_path = csv_path
        self._cache: dict[str, list[StopTimeEntry]] = {}
        self._misses: set[str] = set()

    def get_profile(self, trip_id: str) -> list[StopTimeEntry]:
        if trip_id in self._cache:
            return self._cache[trip_id]
        if trip_id in self._misses:
            return []

        profile: list[StopTimeEntry] = []
        if not self.csv_path.exists():
            self._misses.add(trip_id)
            return []

        with self.csv_path.open(newline="", encoding="utf-8") as fh:
            reader = csv.DictReader(fh)
            if reader.fieldnames:
                reader.fieldnames = [name.strip() if name else name for name in reader.fieldnames]
            for row in reader:
                if "stop_sequence" not in row:
                    row = {k.strip() if isinstance(k, str) else k: v for k, v in row.items()}
                if row.get("trip_id") != trip_id:
                    continue
                stop_sequence_raw = row.get("stop_sequence")
                try:
                    stop_sequence = int(stop_sequence_raw) if stop_sequence_raw else None
                except ValueError:
                    stop_sequence = None
                stop_id = row.get("stop_id")
                if stop_sequence is None or not stop_id:
                    continue
                profile.append(
                    StopTimeEntry(
                        stop_sequence=stop_sequence,
                        stop_id=stop_id,
                        arrival_seconds=_time_to_seconds(row.get("arrival_time")),
                        departure_seconds=_time_to_seconds(row.get("departure_time")),
                    )
                )

        if profile:
            profile.sort(key=lambda entry: entry.stop_sequence)
            self._cache[trip_id] = profile
        else:
            self._misses.add(trip_id)
        return profile


class FeedType(str, Enum):
    VEHICLE_POSITIONS = "vehicle_positions"
    TRIP_UPDATES = "trip_updates"
    ALERTS = "alerts"


@dataclass
class FeedEnvelope:
    url: str
    feed_type: FeedType
    message: gtfs_realtime_pb2.FeedMessage
    header_timestamp: int | None


class DimLookup:
    """Lazy cache of static GTFS lookups with missing-data tracking."""

    def __init__(
        self,
        conn: psycopg2.extensions.connection,
        stop_times_csv: Path | None = None,
    ) -> None:
        self.conn = conn
        self._trip_routes: dict[str, str | None] = {}
        self._trip_profiles: dict[str, list[StopTimeEntry]] = {}
        self._trip_exists: dict[str, bool] = {}
        self._route_exists: dict[str, bool] = {}
        self._stop_exists: dict[str, bool] = {}
        self._stop_times_fallback: StopTimesCsvFallback | None = (
            StopTimesCsvFallback(stop_times_csv) if stop_times_csv else None
        )
        self.missing: dict[str, set[str]] = {
            "trip": set(),
            "route": set(),
            "stop": set(),
        }

    def ensure_trip(self, trip_id: str | None) -> bool:
        if not trip_id:
            return False
        if trip_id in self._trip_exists:
            return self._trip_exists[trip_id]
        with self.conn.cursor() as cur:
            cur.execute("SELECT 1 FROM dim_trips WHERE trip_id = %s", (trip_id,))
            exists = cur.fetchone() is not None
        if not exists:
            self.missing["trip"].add(trip_id)
        self._trip_exists[trip_id] = exists
        return exists

    def get_route_for_trip(self, trip_id: str | None) -> str | None:
        if not trip_id:
            return None
        if trip_id in self._trip_routes:
            return self._trip_routes[trip_id]
        route_id = None
        with self.conn.cursor() as cur:
            cur.execute("SELECT route_id FROM dim_trips WHERE trip_id = %s", (trip_id,))
            row = cur.fetchone()
            if row:
                route_id = row[0]
        if route_id is None:
            self.missing["trip"].add(trip_id)
            self._trip_routes[trip_id] = None
            return None
        if not route_id:
            self.missing["route"].add(f"(from trip {trip_id})")
        self._trip_routes[trip_id] = route_id
        return route_id

    def _load_trip_profile(self, trip_id: str) -> list[StopTimeEntry]:
        if trip_id in self._trip_profiles:
            return self._trip_profiles[trip_id]
        with self.conn.cursor() as cur:
            cur.execute(
                """
                SELECT stop_sequence, stop_id, arrival_seconds, departure_seconds
                FROM dim_stop_times
                WHERE trip_id = %s
                ORDER BY stop_sequence
                """,
                (trip_id,),
            )
            rows = cur.fetchall()
        profile: list[StopTimeEntry] = []
        if rows:
            profile = [
                StopTimeEntry(
                    stop_sequence=int(row[0]),
                    stop_id=row[1],
                    arrival_seconds=_to_int(row[2]),
                    departure_seconds=_to_int(row[3]),
                )
                for row in rows
            ]
        elif self._stop_times_fallback:
            profile = self._stop_times_fallback.get_profile(trip_id)
            if not profile:
                self.missing["trip"].add(trip_id)
        else:
            self.missing["trip"].add(trip_id)
        self._trip_profiles[trip_id] = profile
        return profile

    def get_stop_context(
        self, trip_id: str | None, stop_id: str | None
    ) -> tuple[int, StopTimeEntry] | None:
        if not trip_id or not stop_id:
            return None
        profile = self._load_trip_profile(trip_id)
        if not profile:
            return None
        for index, entry in enumerate(profile):
            if entry.stop_id == stop_id:
                return index, entry
        self.missing["stop"].add(stop_id)
        return None

    def get_adjacent_stop(
        self, trip_id: str | None, current_index: int, forward: bool
    ) -> StopTimeEntry | None:
        if trip_id is None:
            return None
        profile = self._load_trip_profile(trip_id)
        if not profile:
            return None
        next_index = current_index + (1 if forward else -1)
        if 0 <= next_index < len(profile):
            return profile[next_index]
        return None

    def ensure_route(self, route_id: str | None) -> bool:
        if not route_id:
            return False
        if route_id in self._route_exists:
            return self._route_exists[route_id]
        with self.conn.cursor() as cur:
            cur.execute("SELECT 1 FROM dim_routes WHERE route_id = %s", (route_id,))
            exists = cur.fetchone() is not None
        if not exists:
            self.missing["route"].add(route_id)
        self._route_exists[route_id] = exists
        return exists

    def ensure_stop(self, stop_id: str | None) -> bool:
        if not stop_id:
            return False
        if stop_id in self._stop_exists:
            return self._stop_exists[stop_id]
        with self.conn.cursor() as cur:
            cur.execute("SELECT 1 FROM dim_stops WHERE stop_id = %s", (stop_id,))
            exists = cur.fetchone() is not None
        if not exists:
            self.missing["stop"].add(stop_id)
        self._stop_exists[stop_id] = exists
        return exists

    def report_missing(self) -> None:
        for key, values in self.missing.items():
            if not values:
                continue
            sample = sorted(values)[:10]
            more = "" if len(values) <= 10 else f" (+{len(values) - 10} more)"
            LOGGER.warning(
                "Static GTFS mismatch: missing %s entries such as %s%s",
                key,
                ", ".join(sample),
                more,
            )
            values.clear()

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download GTFS-RT protobuf feeds and load them into PostgreSQL."
    )
    parser.add_argument(
        "--feed",
        dest="feeds",
        action="append",
        help="GTFS-RT protobuf feed URL. Provide once per endpoint.",
    )
    parser.add_argument(
        "--http-timeout",
        type=float,
        default=15.0,
        help="Seconds to wait for each feed response (default: 15).",
    )
    parser.add_argument(
        "--database-url",
        default=os.getenv("DATABASE_URL"),
        help="PostgreSQL connection string. Defaults to DATABASE_URL env var.",
    )
    parser.add_argument(
        "--stop-times-csv",
        help=(
            "Optional CSV path with stop_times rows used to derive previous/next stops "
            "when the database lacks static trip timing data. Can also be provided via "
            "STOP_TIMES_CSV_PATH env var."
        ),
    )
    parser.add_argument(
        "--interval",
        type=float,
        help="Seconds between polling iterations. If omitted, run once and exit.",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Execute a single polling iteration even if --interval is provided.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch feeds and log stats without writing to PostgreSQL.",
    )
    parser.add_argument(
        "--vehicle-history-hours",
        type=float,
        help=(
            f"Number of hours to retain in {RODALIES_HISTORY_TABLE} and {RODALIES_CURRENT_TABLE} "
            "before pruning stale records (default: 24)."
        ),
    )
    parser.add_argument(
        "--align-interval",
        type=float,
        help="Enable aligned polling cadence (seconds between aligned polls).",
    )
    parser.add_argument(
        "--align-offset",
        type=float,
        help="Seconds offset applied to the aligned cadence (default: 0).",
    )
    parser.add_argument(
        "--auto-refresh-static",
        action="store_true",
        help=(
            "Automatically refresh static GTFS dimensions once per day before polling. "
            "The run occurs after the configured --static-refresh-time (Madrid)."
        ),
    )
    parser.add_argument(
        "--static-refresh-time",
        help=(
            "Time-of-day in HH:MM or HH:MM:SS (Europe/Madrid) when the static refresh "
            "should occur (default: 10:00)."
        ),
    )
    parser.add_argument(
        "--static-zip-path",
        help="Optional path to the GTFS static zip to pass to refresh_static_gtfs.py.",
    )
    parser.add_argument(
        "--static-zip-url",
        help="Optional download URL passed through to refresh_static_gtfs.py.",
    )
    parser.add_argument(
        "--auto-archive-snapshots",
        action="store_true",
        help=(
            "Automatically archive historical snapshot rows once per day after "
            "the configured --archive-time (Madrid)."
        ),
    )
    parser.add_argument(
        "--archive-time",
        help=(
            "Time-of-day in HH:MM or HH:MM:SS (Europe/Madrid) when the snapshot archive "
            "should run (default: 02:00)."
        ),
    )
    parser.add_argument(
        "--archive-retention-days",
        type=float,
        help=(
            "Retention window (in days) for raw snapshot rows before archiving. "
            "Defaults to 7 days."
        ),
    )
    parser.add_argument(
        "--archive-interval-days",
        type=float,
        help=(
            "Minimum number of days between automatic archive runs when auto-archive "
            "is enabled (default: 1)."
        ),
    )
    parser.add_argument(
        "--archive-force",
        action="store_true",
        help="Recreate archive blobs even if an entry already exists for the day.",
    )
    return parser.parse_args()


def ensure_database_url(url: str | None) -> str:
    if not url:
        raise SystemExit("Database URL not provided. Use --database-url or set DATABASE_URL env var.")
    return url


def connect(database_url: str) -> psycopg2.extensions.connection:
    conn = psycopg2.connect(database_url)
    conn.autocommit = False
    return conn


def fetch_latest_archive_date(
    conn: psycopg2.extensions.connection,
) -> datetime.date | None:
    with conn.cursor() as cur:
        cur.execute("SELECT MAX(archive_date) FROM rt_snapshot_archives")
        row = cur.fetchone()
    if not row:
        return None
    return row[0]


def ensure_schema(conn: psycopg2.extensions.connection) -> None:
    statements = [
        """
        CREATE TABLE IF NOT EXISTS dim_routes (
            route_id TEXT PRIMARY KEY,
            line_code TEXT,
            short_name TEXT,
            long_name TEXT,
            route_type INTEGER,
            color TEXT,
            text_color TEXT,
            updated_at TIMESTAMPTZ DEFAULT now()
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS dim_trips (
            trip_id TEXT PRIMARY KEY,
            route_id TEXT REFERENCES dim_routes(route_id) ON DELETE SET NULL,
            service_id TEXT,
            shape_id TEXT,
            block_id TEXT,
            wheelchair_accessible INTEGER,
            updated_at TIMESTAMPTZ DEFAULT now()
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS dim_stops (
            stop_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            lat DOUBLE PRECISION,
            lon DOUBLE PRECISION,
            wheelchair_boarding INTEGER,
            updated_at TIMESTAMPTZ DEFAULT now()
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS dim_stop_times (
            trip_id TEXT REFERENCES dim_trips(trip_id) ON DELETE CASCADE,
            stop_sequence INTEGER,
            stop_id TEXT REFERENCES dim_stops(stop_id) ON DELETE CASCADE,
            arrival_seconds INTEGER,
            departure_seconds INTEGER,
            PRIMARY KEY (trip_id, stop_sequence)
        );
        """,
        """
        CREATE INDEX IF NOT EXISTS dim_stop_times_by_trip_stop_idx
            ON dim_stop_times (trip_id, stop_id);
        """,
        """
        CREATE TABLE IF NOT EXISTS rt_snapshots (
            snapshot_id UUID PRIMARY KEY,
            polled_at_utc TIMESTAMPTZ NOT NULL,
            vehicle_feed_timestamp_utc TIMESTAMPTZ,
            trip_feed_timestamp_utc TIMESTAMPTZ,
            alert_feed_timestamp_utc TIMESTAMPTZ
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS rt_feed_cursors (
            feed_type TEXT PRIMARY KEY,
            last_header_timestamp BIGINT,
            last_snapshot_id UUID
        );
        """,
        f"""
        CREATE TABLE IF NOT EXISTS {VEHICLE_POSITIONS_TABLE} (
            snapshot_id UUID REFERENCES rt_snapshots(snapshot_id) ON DELETE CASCADE,
            entity_id TEXT NOT NULL,
            vehicle_id TEXT,
            vehicle_label TEXT,
            trip_id TEXT REFERENCES dim_trips(trip_id) ON DELETE SET NULL,
            route_id TEXT REFERENCES dim_routes(route_id) ON DELETE SET NULL,
            current_stop_id TEXT REFERENCES dim_stops(stop_id) ON DELETE SET NULL,
            previous_stop_id TEXT REFERENCES dim_stops(stop_id) ON DELETE SET NULL,
            next_stop_id TEXT REFERENCES dim_stops(stop_id) ON DELETE SET NULL,
            next_stop_sequence INTEGER,
            status TEXT,
            latitude DOUBLE PRECISION,
            longitude DOUBLE PRECISION,
            PRIMARY KEY (snapshot_id, entity_id)
        );
        """,
        f"""
        CREATE INDEX IF NOT EXISTS {VEHICLE_POSITIONS_TABLE}_vehicle_idx
            ON {VEHICLE_POSITIONS_TABLE} (vehicle_id, snapshot_id DESC);
        """,
        f"""
        CREATE TABLE IF NOT EXISTS {RODALIES_POSITIONS_TABLE} (
            snapshot_id UUID REFERENCES rt_snapshots(snapshot_id) ON DELETE CASCADE,
            entity_id TEXT NOT NULL,
            vehicle_id TEXT,
            vehicle_label TEXT,
            trip_id TEXT REFERENCES dim_trips(trip_id) ON DELETE SET NULL,
            route_id TEXT REFERENCES dim_routes(route_id) ON DELETE SET NULL,
            current_stop_id TEXT REFERENCES dim_stops(stop_id) ON DELETE SET NULL,
            previous_stop_id TEXT REFERENCES dim_stops(stop_id) ON DELETE SET NULL,
            next_stop_id TEXT REFERENCES dim_stops(stop_id) ON DELETE SET NULL,
            next_stop_sequence INTEGER,
            status TEXT,
            latitude DOUBLE PRECISION,
            longitude DOUBLE PRECISION,
            arrival_delay_seconds INTEGER,
            departure_delay_seconds INTEGER,
            schedule_relationship TEXT,
            predicted_arrival_utc TIMESTAMPTZ,
            predicted_departure_utc TIMESTAMPTZ,
            trip_update_timestamp_utc TIMESTAMPTZ,
            PRIMARY KEY (snapshot_id, entity_id)
        );
        """,
        f"""
        CREATE INDEX IF NOT EXISTS {RODALIES_POSITIONS_TABLE}_vehicle_idx
            ON {RODALIES_POSITIONS_TABLE} (vehicle_id, snapshot_id DESC);
        """,
        f"""
        CREATE TABLE IF NOT EXISTS {RODALIES_CURRENT_TABLE} (
            vehicle_key TEXT PRIMARY KEY,
            snapshot_id UUID NOT NULL REFERENCES rt_snapshots(snapshot_id) ON DELETE CASCADE,
            vehicle_id TEXT,
            entity_id TEXT NOT NULL,
            vehicle_label TEXT,
            trip_id TEXT REFERENCES dim_trips(trip_id) ON DELETE SET NULL,
            route_id TEXT REFERENCES dim_routes(route_id) ON DELETE SET NULL,
            current_stop_id TEXT REFERENCES dim_stops(stop_id) ON DELETE SET NULL,
            previous_stop_id TEXT REFERENCES dim_stops(stop_id) ON DELETE SET NULL,
            next_stop_id TEXT REFERENCES dim_stops(stop_id) ON DELETE SET NULL,
            next_stop_sequence INTEGER,
            status TEXT,
            latitude DOUBLE PRECISION,
            longitude DOUBLE PRECISION,
            vehicle_timestamp_utc TIMESTAMPTZ,
            polled_at_utc TIMESTAMPTZ NOT NULL,
            arrival_delay_seconds INTEGER,
            departure_delay_seconds INTEGER,
            schedule_relationship TEXT,
            predicted_arrival_utc TIMESTAMPTZ,
            predicted_departure_utc TIMESTAMPTZ,
            trip_update_timestamp_utc TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """,
        f"""
        CREATE UNIQUE INDEX IF NOT EXISTS {RODALIES_CURRENT_TABLE}_vehicle_id_idx
            ON {RODALIES_CURRENT_TABLE} (vehicle_id)
            WHERE vehicle_id IS NOT NULL;
        """,
        f"""
        CREATE INDEX IF NOT EXISTS {RODALIES_CURRENT_TABLE}_route_idx
            ON {RODALIES_CURRENT_TABLE} (route_id)
            WHERE route_id IS NOT NULL;
        """,
        f"""
        CREATE TABLE IF NOT EXISTS {RODALIES_HISTORY_TABLE} (
            vehicle_key TEXT NOT NULL,
            snapshot_id UUID NOT NULL REFERENCES rt_snapshots(snapshot_id) ON DELETE CASCADE,
            vehicle_id TEXT,
            entity_id TEXT NOT NULL,
            vehicle_label TEXT,
            trip_id TEXT REFERENCES dim_trips(trip_id) ON DELETE SET NULL,
            route_id TEXT REFERENCES dim_routes(route_id) ON DELETE SET NULL,
            current_stop_id TEXT REFERENCES dim_stops(stop_id) ON DELETE SET NULL,
            previous_stop_id TEXT REFERENCES dim_stops(stop_id) ON DELETE SET NULL,
            next_stop_id TEXT REFERENCES dim_stops(stop_id) ON DELETE SET NULL,
            next_stop_sequence INTEGER,
            status TEXT,
            latitude DOUBLE PRECISION,
            longitude DOUBLE PRECISION,
            vehicle_timestamp_utc TIMESTAMPTZ,
            polled_at_utc TIMESTAMPTZ NOT NULL,
            arrival_delay_seconds INTEGER,
            departure_delay_seconds INTEGER,
            schedule_relationship TEXT,
            predicted_arrival_utc TIMESTAMPTZ,
            predicted_departure_utc TIMESTAMPTZ,
            trip_update_timestamp_utc TIMESTAMPTZ,
            PRIMARY KEY (vehicle_key, snapshot_id)
        );
        """,
        f"""
        CREATE INDEX IF NOT EXISTS {RODALIES_HISTORY_TABLE}_vehicle_idx
            ON {RODALIES_HISTORY_TABLE} (vehicle_id, polled_at_utc DESC)
            WHERE vehicle_id IS NOT NULL;
        """,
        f"""
        CREATE INDEX IF NOT EXISTS {RODALIES_HISTORY_TABLE}_route_idx
            ON {RODALIES_HISTORY_TABLE} (route_id, polled_at_utc DESC)
            WHERE route_id IS NOT NULL;
        """,
        """
        CREATE TABLE IF NOT EXISTS rt_trip_delays (
            snapshot_id UUID REFERENCES rt_snapshots(snapshot_id) ON DELETE CASCADE,
            trip_id TEXT NOT NULL REFERENCES dim_trips(trip_id) ON DELETE CASCADE,
            stop_id TEXT NOT NULL REFERENCES dim_stops(stop_id) ON DELETE CASCADE,
            stop_sequence INTEGER,
            scheduled_arrival_seconds INTEGER,
            scheduled_departure_seconds INTEGER,
            predicted_arrival_utc TIMESTAMPTZ,
            predicted_departure_utc TIMESTAMPTZ,
            arrival_delay_seconds INTEGER,
            departure_delay_seconds INTEGER,
            schedule_relationship TEXT,
            PRIMARY KEY (snapshot_id, trip_id, stop_id)
        );
        """,
        """
        CREATE INDEX IF NOT EXISTS rt_trip_delays_trip_idx
            ON rt_trip_delays (trip_id, snapshot_id DESC);
        """,
        """
        CREATE TABLE IF NOT EXISTS rt_alerts (
            snapshot_id UUID REFERENCES rt_snapshots(snapshot_id) ON DELETE CASCADE,
            alert_id TEXT NOT NULL,
            language TEXT NOT NULL,
            message TEXT,
            effect TEXT,
            cause TEXT,
            active_start_utc TIMESTAMPTZ,
            active_end_utc TIMESTAMPTZ,
            created_at_utc TIMESTAMPTZ,
            PRIMARY KEY (snapshot_id, alert_id, language)
        );
        """,
        """
        CREATE INDEX IF NOT EXISTS rt_alerts_alert_idx
            ON rt_alerts (alert_id, snapshot_id DESC);
        """,
        """
        CREATE TABLE IF NOT EXISTS rt_alert_routes (
            snapshot_id UUID REFERENCES rt_snapshots(snapshot_id) ON DELETE CASCADE,
            alert_id TEXT NOT NULL,
            route_id TEXT NOT NULL REFERENCES dim_routes(route_id) ON DELETE CASCADE,
            PRIMARY KEY (snapshot_id, alert_id, route_id)
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS rt_alert_stops (
            snapshot_id UUID REFERENCES rt_snapshots(snapshot_id) ON DELETE CASCADE,
            alert_id TEXT NOT NULL,
            stop_id TEXT NOT NULL REFERENCES dim_stops(stop_id) ON DELETE CASCADE,
            PRIMARY KEY (snapshot_id, alert_id, stop_id)
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS rt_alert_trips (
            snapshot_id UUID REFERENCES rt_snapshots(snapshot_id) ON DELETE CASCADE,
            alert_id TEXT NOT NULL,
            trip_id TEXT NOT NULL REFERENCES dim_trips(trip_id) ON DELETE CASCADE,
            PRIMARY KEY (snapshot_id, alert_id, trip_id)
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS rt_alert_active_periods (
            snapshot_id UUID REFERENCES rt_snapshots(snapshot_id) ON DELETE CASCADE,
            alert_id TEXT NOT NULL,
            period_index INTEGER NOT NULL,
            active_start_utc TIMESTAMPTZ,
            active_end_utc TIMESTAMPTZ,
            PRIMARY KEY (snapshot_id, alert_id, period_index)
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS rt_snapshot_archives (
            archive_date DATE PRIMARY KEY,
            snapshot_ids UUID[] NOT NULL,
            snapshot_csv BYTEA,
            vehicle_positions_csv BYTEA,
            trip_delays_csv BYTEA,
            alerts_csv BYTEA,
            alert_routes_csv BYTEA,
            alert_stops_csv BYTEA,
            alert_trips_csv BYTEA,
            alert_active_periods_csv BYTEA,
            created_at TIMESTAMPTZ DEFAULT now()
        );
        """,
    ]

    with conn.cursor() as cur:
        for statement in statements:
            cur.execute(statement)
    conn.commit()


def _to_float(value: object | None) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _to_int(value: object | None) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def post_discord_webhook(
    webhook_url: str | None,
    content: str,
    username: str | None = None,
    avatar_url: str | None = None,
    logger_context: str | None = None,
) -> bool:
    if not webhook_url:
        LOGGER.warning(
            "Skipping Discord webhook post%s: webhook URL not configured.",
            f" ({logger_context})" if logger_context else "",
        )
        return False

    payload: dict[str, object] = {"content": content}
    if username:
        payload["username"] = username
    if avatar_url:
        payload["avatar_url"] = avatar_url

    try:
        response = requests.post(webhook_url, json=payload, timeout=10)
        response.raise_for_status()
    except Exception:
        LOGGER.exception("Failed to post Discord webhook%s", f" ({logger_context})" if logger_context else "")
        return False

    LOGGER.info(
        "Posted Discord webhook successfully%s",
        f" ({logger_context})" if logger_context else "",
    )
    return True


def send_failure_notification(
    webhook_url: str | None,
    feed_url: str,
    failure_count: int,
    threshold: int,
    exc: Exception,
    username: str | None,
    avatar_url: str | None,
) -> None:
    content = (
        f":warning: GTFS poller alert\n"
        f"Feed: `{feed_url}`\n"
        f"Consecutive failures: **{failure_count}** (threshold {threshold})\n"
        f"Timestamp (UTC): {datetime.now(timezone.utc).isoformat()}\n"
        f"Last error: `{type(exc).__name__}: {exc}`"
    )

    posted = post_discord_webhook(
        webhook_url,
        content=content,
        username=username,
        avatar_url=avatar_url,
        logger_context=f"failure alert for {feed_url}",
    )
    if posted:
        LOGGER.warning(
            "Sent Discord alert after %d consecutive failures for %s",
            failure_count,
            feed_url,
        )


def _header_is_stale(header: int | None, previous: int | None) -> bool:
    if header is None or previous is None:
        return False
    return header <= previous


def run_static_refresh(
    script_path: Path,
    project_root: Path,
    database_url: str,
    zip_path: Path | None,
    zip_url: str | None,
) -> bool:
    if not script_path.exists():
        LOGGER.error("Static refresh script not found at %s", script_path)
        return False

    env = os.environ.copy()
    env.setdefault("DATABASE_URL", database_url)

    cmd = [sys.executable, str(script_path)]
    if zip_path:
        cmd.extend(["--zip-path", str(zip_path)])
    if zip_url:
        cmd.extend(["--zip-url", zip_url])
    cmd.extend(["--database-url", database_url])

    LOGGER.info("Starting scheduled static GTFS refresh using %s", script_path)
    try:
        subprocess.run(cmd, check=True, cwd=project_root, env=env)
    except FileNotFoundError:
        LOGGER.exception("Python executable not found while launching static refresh")
        return False
    except subprocess.CalledProcessError as exc:
        LOGGER.error("Static refresh exited with code %s", exc.returncode)
        return False

    LOGGER.info("Static GTFS refresh completed successfully.")
    return True


def run_archive_snapshots(
    script_path: Path,
    project_root: Path,
    database_url: str,
    retention_days: float,
    force: bool,
) -> bool:
    if not script_path.exists():
        LOGGER.error("Snapshot archive script not found at %s", script_path)
        return False

    env = os.environ.copy()
    env.setdefault("DATABASE_URL", database_url)

    cmd = [
        sys.executable,
        str(script_path),
        "--database-url",
        database_url,
        "--retention-days",
        f"{retention_days}",
    ]
    if force:
        cmd.append("--force")

    LOGGER.info(
        "Starting scheduled snapshot archive using %s (retention=%.2f days)",
        script_path,
        retention_days,
    )
    try:
        subprocess.run(cmd, check=True, cwd=project_root, env=env)
    except FileNotFoundError:
        LOGGER.exception("Python executable not found while launching snapshot archive")
        return False
    except subprocess.CalledProcessError as exc:
        LOGGER.error("Snapshot archive exited with code %s", exc.returncode)
        return False

    LOGGER.info("Snapshot archive completed successfully.")
    return True


def extract_vehicle_position_rows(
    snapshot_id: uuid.UUID,
    envelope: FeedEnvelope,
    lookup: DimLookup,
) -> list[VehiclePositionRecord]:
    if not envelope.message.entity:
        return []

    records_by_entity: dict[str, VehiclePositionRecord] = {}
    for entity in envelope.message.entity:
        if not entity.HasField("vehicle"):
            continue
        payload = MessageToDict(
            entity,
            preserving_proto_field_name=True,
            always_print_fields_with_no_presence=False,
        )
        entity_id = payload.get("id")
        if not entity_id:
            continue

        vehicle = payload.get("vehicle", {})
        descriptor = vehicle.get("vehicle", {})
        position = vehicle.get("position", {})
        trip = vehicle.get("trip", {})

        raw_trip_id = trip.get("trip_id")
        trip_valid = lookup.ensure_trip(raw_trip_id)
        trip_id = raw_trip_id if trip_valid else None
        route_id = lookup.get_route_for_trip(raw_trip_id) if trip_valid else None
        if route_id and not lookup.ensure_route(route_id):
            route_id = None

        current_stop_id = vehicle.get("stop_id")
        if not lookup.ensure_stop(current_stop_id):
            current_stop_id = None

        previous_stop_id = None
        next_stop_id = None
        next_stop_sequence = None
        context: tuple[int, StopTimeEntry] | None = None
        if current_stop_id and raw_trip_id:
            context = lookup.get_stop_context(raw_trip_id, current_stop_id)
        if context:
            index, entry = context
            prev_entry = lookup.get_adjacent_stop(raw_trip_id, index, forward=False)
            next_entry = lookup.get_adjacent_stop(raw_trip_id, index, forward=True)
            if prev_entry and lookup.ensure_stop(prev_entry.stop_id):
                previous_stop_id = prev_entry.stop_id
            if next_entry and lookup.ensure_stop(next_entry.stop_id):
                next_stop_id = next_entry.stop_id
                next_stop_sequence = next_entry.stop_sequence

        records_by_entity[entity_id] = VehiclePositionRecord(
            snapshot_id=snapshot_id,
            entity_id=entity_id,
            vehicle_id=descriptor.get("id"),
            vehicle_label=descriptor.get("label"),
            trip_id=trip_id,
            route_id=route_id,
            current_stop_id=current_stop_id,
            previous_stop_id=previous_stop_id,
            next_stop_id=next_stop_id,
            next_stop_sequence=next_stop_sequence,
            status=vehicle.get("current_status"),
            latitude=_to_float(position.get("latitude")),
            longitude=_to_float(position.get("longitude")),
            vehicle_timestamp_utc=_epoch_to_datetime(vehicle.get("timestamp")),
        )

    return list(records_by_entity.values())


def store_vehicle_positions(
    conn: psycopg2.extensions.connection,
    snapshot_id: uuid.UUID,
    polled_at: datetime,
    envelope: FeedEnvelope,
    lookup: DimLookup,
    history_retention: timedelta | None,
    delay_lookup: Mapping[tuple[str, str], TripDelaySnapshot] | None,
    trip_update_timestamp: datetime | None,
) -> int:
    delay_lookup = delay_lookup or {}
    records = extract_vehicle_position_rows(snapshot_id, envelope, lookup)
    if not records:
        return 0

    position_rows = [record.as_positions_tuple() for record in records]
    rodalies_records = [
        record
        for record in records
        if record.vehicle_label and record.vehicle_label.strip().upper().startswith("R")
    ]
    rodalies_position_rows: list[tuple] = []
    history_rows: list[tuple] = []
    current_rows: list[tuple] = []
    updated_at = datetime.now(timezone.utc)

    for record in rodalies_records:
        vehicle_key = _vehicle_key(record.vehicle_id, record.entity_id)
        delay = None
        if record.trip_id and record.current_stop_id:
            delay = delay_lookup.get((record.trip_id, record.current_stop_id))
        arrival_delay = delay.arrival_delay_seconds if delay else None
        departure_delay = delay.departure_delay_seconds if delay else None
        schedule_relationship = delay.schedule_relationship if delay else None
        predicted_arrival = delay.predicted_arrival_utc if delay else None
        predicted_departure = delay.predicted_departure_utc if delay else None

        rodalies_position_rows.append(
            (
                str(snapshot_id),
                record.entity_id,
                record.vehicle_id,
                record.vehicle_label,
                record.trip_id,
                record.route_id,
                record.current_stop_id,
                record.previous_stop_id,
                record.next_stop_id,
                record.next_stop_sequence,
                record.status,
                record.latitude,
                record.longitude,
                arrival_delay,
                departure_delay,
                schedule_relationship,
                predicted_arrival,
                predicted_departure,
                trip_update_timestamp,
            )
        )
        history_rows.append(
            (
                vehicle_key,
                str(snapshot_id),
                record.vehicle_id,
                record.entity_id,
                record.vehicle_label,
                record.trip_id,
                record.route_id,
                record.current_stop_id,
                record.previous_stop_id,
                record.next_stop_id,
                record.next_stop_sequence,
                record.status,
                record.latitude,
                record.longitude,
                record.vehicle_timestamp_utc,
                polled_at,
                arrival_delay,
                departure_delay,
                schedule_relationship,
                predicted_arrival,
                predicted_departure,
                trip_update_timestamp,
            )
        )
        current_rows.append(
            (
                vehicle_key,
                str(snapshot_id),
                record.vehicle_id,
                record.entity_id,
                record.vehicle_label,
                record.trip_id,
                record.route_id,
                record.current_stop_id,
                record.previous_stop_id,
                record.next_stop_id,
                record.next_stop_sequence,
                record.status,
                record.latitude,
                record.longitude,
                record.vehicle_timestamp_utc,
                polled_at,
                arrival_delay,
                departure_delay,
                schedule_relationship,
                predicted_arrival,
                predicted_departure,
                trip_update_timestamp,
                updated_at,
            )
        )

    with conn.cursor() as cur:
        execute_batch(
            cur,
            f"""
            INSERT INTO {VEHICLE_POSITIONS_TABLE} (
                snapshot_id,
                entity_id,
                vehicle_id,
                vehicle_label,
                trip_id,
                route_id,
                current_stop_id,
                previous_stop_id,
                next_stop_id,
                next_stop_sequence,
                status,
                latitude,
                longitude
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (snapshot_id, entity_id) DO NOTHING
            """,
            position_rows,
        )

        if rodalies_position_rows:
            execute_batch(
                cur,
                f"""
                INSERT INTO {RODALIES_POSITIONS_TABLE} (
                    snapshot_id,
                    entity_id,
                    vehicle_id,
                    vehicle_label,
                    trip_id,
                    route_id,
                    current_stop_id,
                    previous_stop_id,
                    next_stop_id,
                    next_stop_sequence,
                    status,
                    latitude,
                    longitude,
                    arrival_delay_seconds,
                    departure_delay_seconds,
                    schedule_relationship,
                    predicted_arrival_utc,
                    predicted_departure_utc,
                    trip_update_timestamp_utc
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (snapshot_id, entity_id) DO NOTHING
                """,
                rodalies_position_rows,
            )

        if history_rows:
            execute_batch(
                cur,
                f"""
                INSERT INTO {RODALIES_HISTORY_TABLE} (
                    vehicle_key,
                    snapshot_id,
                    vehicle_id,
                    entity_id,
                    vehicle_label,
                    trip_id,
                    route_id,
                    current_stop_id,
                    previous_stop_id,
                    next_stop_id,
                    next_stop_sequence,
                    status,
                    latitude,
                    longitude,
                    vehicle_timestamp_utc,
                    polled_at_utc,
                    arrival_delay_seconds,
                    departure_delay_seconds,
                    schedule_relationship,
                    predicted_arrival_utc,
                    predicted_departure_utc,
                    trip_update_timestamp_utc
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (vehicle_key, snapshot_id) DO NOTHING
                """,
                history_rows,
            )

        if current_rows:
            execute_batch(
                cur,
                f"""
                INSERT INTO {RODALIES_CURRENT_TABLE} (
                    vehicle_key,
                    snapshot_id,
                    vehicle_id,
                    entity_id,
                    vehicle_label,
                    trip_id,
                    route_id,
                    current_stop_id,
                    previous_stop_id,
                    next_stop_id,
                    next_stop_sequence,
                    status,
                    latitude,
                    longitude,
                    vehicle_timestamp_utc,
                    polled_at_utc,
                    arrival_delay_seconds,
                    departure_delay_seconds,
                    schedule_relationship,
                    predicted_arrival_utc,
                    predicted_departure_utc,
                    trip_update_timestamp_utc,
                    updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (vehicle_key) DO UPDATE SET
                    snapshot_id = EXCLUDED.snapshot_id,
                    vehicle_id = EXCLUDED.vehicle_id,
                    entity_id = EXCLUDED.entity_id,
                    vehicle_label = EXCLUDED.vehicle_label,
                    trip_id = EXCLUDED.trip_id,
                    route_id = EXCLUDED.route_id,
                    current_stop_id = EXCLUDED.current_stop_id,
                    previous_stop_id = EXCLUDED.previous_stop_id,
                    next_stop_id = EXCLUDED.next_stop_id,
                    next_stop_sequence = EXCLUDED.next_stop_sequence,
                    status = EXCLUDED.status,
                    latitude = EXCLUDED.latitude,
                    longitude = EXCLUDED.longitude,
                    vehicle_timestamp_utc = EXCLUDED.vehicle_timestamp_utc,
                    polled_at_utc = EXCLUDED.polled_at_utc,
                    arrival_delay_seconds = EXCLUDED.arrival_delay_seconds,
                    departure_delay_seconds = EXCLUDED.departure_delay_seconds,
                    schedule_relationship = EXCLUDED.schedule_relationship,
                    predicted_arrival_utc = EXCLUDED.predicted_arrival_utc,
                    predicted_departure_utc = EXCLUDED.predicted_departure_utc,
                    trip_update_timestamp_utc = EXCLUDED.trip_update_timestamp_utc,
                    updated_at = EXCLUDED.updated_at
                """,
                current_rows,
            )

        if history_retention is not None:
            cutoff = polled_at - history_retention
            cur.execute(
                f"DELETE FROM {RODALIES_HISTORY_TABLE} WHERE polled_at_utc < %s",
                (cutoff,),
            )
            cur.execute(
                f"DELETE FROM {RODALIES_CURRENT_TABLE} WHERE polled_at_utc < %s",
                (cutoff,),
            )

    return len(records)


def store_trip_delays(
    conn: psycopg2.extensions.connection,
    snapshot_id: uuid.UUID,
    envelope: FeedEnvelope,
    lookup: DimLookup,
) -> tuple[int, dict[tuple[str, str], TripDelaySnapshot]]:
    if not envelope.message.entity:
        return 0, {}

    rows_by_key: dict[tuple[str, str], tuple] = {}
    delay_lookup: dict[tuple[str, str], TripDelaySnapshot] = {}
    for entity in envelope.message.entity:
        if not entity.HasField("trip_update"):
            continue
        payload = MessageToDict(
            entity,
            preserving_proto_field_name=True,
            always_print_fields_with_no_presence=False,
        )
        trip_update = payload.get("trip_update", {})
        trip = trip_update.get("trip", {})
        raw_trip_id = trip.get("trip_id")
        if not lookup.ensure_trip(raw_trip_id):
            continue

        for stop_update in trip_update.get("stop_time_update", []) or []:
            stop_id = stop_update.get("stop_id")
            if not lookup.ensure_stop(stop_id):
                continue

            context = lookup.get_stop_context(raw_trip_id, stop_id)
            stop_sequence = None
            scheduled_arrival = None
            scheduled_departure = None
            if context:
                _, entry = context
                stop_sequence = entry.stop_sequence
                scheduled_arrival = entry.arrival_seconds
                scheduled_departure = entry.departure_seconds

            arrival = stop_update.get("arrival", {})
            departure = stop_update.get("departure", {})
            predicted_arrival = _epoch_to_datetime(arrival.get("time"))
            predicted_departure = _epoch_to_datetime(departure.get("time"))
            arrival_delay = _to_int(arrival.get("delay"))
            departure_delay = _to_int(departure.get("delay"))
            schedule_relationship = (
                stop_update.get("schedule_relationship") or trip.get("schedule_relationship")
            )
            rows_by_key[(raw_trip_id, stop_id)] = (
                str(snapshot_id),
                raw_trip_id,
                stop_id,
                stop_sequence,
                scheduled_arrival,
                scheduled_departure,
                predicted_arrival,
                predicted_departure,
                arrival_delay,
                departure_delay,
                schedule_relationship,
            )
            delay_lookup[(raw_trip_id, stop_id)] = TripDelaySnapshot(
                arrival_delay_seconds=arrival_delay,
                departure_delay_seconds=departure_delay,
                schedule_relationship=schedule_relationship,
                predicted_arrival_utc=predicted_arrival,
                predicted_departure_utc=predicted_departure,
            )

    if not rows_by_key:
        return 0, {}

    with conn.cursor() as cur:
        execute_batch(
            cur,
            """
            INSERT INTO rt_trip_delays (
                snapshot_id,
                trip_id,
                stop_id,
                stop_sequence,
                scheduled_arrival_seconds,
                scheduled_departure_seconds,
                predicted_arrival_utc,
                predicted_departure_utc,
                arrival_delay_seconds,
                departure_delay_seconds,
                schedule_relationship
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            list(rows_by_key.values()),
        )

    return len(rows_by_key), delay_lookup


def store_alerts(
    conn: psycopg2.extensions.connection,
    snapshot_id: uuid.UUID,
    envelope: FeedEnvelope,
    lookup: DimLookup,
) -> int:
    if not envelope.message.entity:
        return 0

    base_rows: dict[tuple[str, str], tuple] = {}
    route_rows: set[tuple[str, str]] = set()
    stop_rows: set[tuple[str, str]] = set()
    trip_rows: set[tuple[str, str]] = set()
    period_rows: list[tuple] = []

    header_dt = _epoch_to_datetime(envelope.header_timestamp)

    for entity in envelope.message.entity:
        if not entity.HasField("alert"):
            continue
        payload = MessageToDict(
            entity,
            preserving_proto_field_name=True,
            always_print_fields_with_no_presence=False,
        )
        alert_id = payload.get("id")
        if not alert_id:
            continue

        alert = payload.get("alert", {})
        translations = alert.get("description_text", {}).get("translation", []) or []
        if not translations:
            translations = [{"language": "und", "text": None}]

        active_periods = alert.get("active_period", []) or []
        period_starts = [
            _epoch_to_datetime(period.get("start")) for period in active_periods
        ]
        period_ends = [
            _epoch_to_datetime(period.get("end")) for period in active_periods
        ]
        aggregate_start = min((ts for ts in period_starts if ts), default=header_dt)
        aggregate_end = max((ts for ts in period_ends if ts), default=None)

        for period_index, period in enumerate(active_periods):
            period_rows.append(
                (
                    str(snapshot_id),
                    alert_id,
                    period_index,
                    _epoch_to_datetime(period.get("start")),
                    _epoch_to_datetime(period.get("end")),
                )
            )

        for translation in translations:
            language = translation.get("language") or "und"
            base_rows[(alert_id, language)] = (
                str(snapshot_id),
                alert_id,
                language,
                translation.get("text"),
                alert.get("effect"),
                alert.get("cause"),
                aggregate_start,
                aggregate_end,
                header_dt,
            )

        for informed in alert.get("informed_entity", []) or []:
            route_id = informed.get("route_id")
            if lookup.ensure_route(route_id):
                route_rows.add((alert_id, route_id))
            stop_id = informed.get("stop_id")
            if lookup.ensure_stop(stop_id):
                stop_rows.add((alert_id, stop_id))
            trip_info = informed.get("trip") or {}
            trip_id = trip_info.get("trip_id")
            if lookup.ensure_trip(trip_id):
                trip_rows.add((alert_id, trip_id))

    if not base_rows:
        return 0

    with conn.cursor() as cur:
        execute_batch(
            cur,
            """
            INSERT INTO rt_alerts (
                snapshot_id,
                alert_id,
                language,
                message,
                effect,
                cause,
                active_start_utc,
                active_end_utc,
                created_at_utc
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            list(base_rows.values()),
        )

        if route_rows:
            execute_batch(
                cur,
                """
                INSERT INTO rt_alert_routes (snapshot_id, alert_id, route_id)
                VALUES (%s, %s, %s)
                ON CONFLICT DO NOTHING
                """,
                [(str(snapshot_id), alert_id, route_id) for alert_id, route_id in route_rows],
            )

        if stop_rows:
            execute_batch(
                cur,
                """
                INSERT INTO rt_alert_stops (snapshot_id, alert_id, stop_id)
                VALUES (%s, %s, %s)
                ON CONFLICT DO NOTHING
                """,
                [(str(snapshot_id), alert_id, stop_id) for alert_id, stop_id in stop_rows],
            )

        if trip_rows:
            execute_batch(
                cur,
                """
                INSERT INTO rt_alert_trips (snapshot_id, alert_id, trip_id)
                VALUES (%s, %s, %s)
                ON CONFLICT DO NOTHING
                """,
                [(str(snapshot_id), alert_id, trip_id) for alert_id, trip_id in trip_rows],
            )

        if period_rows:
            execute_batch(
                cur,
                """
                INSERT INTO rt_alert_active_periods (
                    snapshot_id,
                    alert_id,
                    period_index,
                    active_start_utc,
                    active_end_utc
                ) VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT DO NOTHING
                """,
                period_rows,
            )

    return len({key[0] for key in base_rows.keys()})


def fetch_single_feed(url: str, timeout: float) -> FeedEnvelope:
    _raw_bytes, message = poll_gtfs.fetch_feed(url, timeout)
    header_timestamp = getattr(message.header, "timestamp", 0) or None
    feed_type = classify_feed(url, message)
    return FeedEnvelope(
        url=url,
        feed_type=feed_type,
        message=message,
        header_timestamp=int(header_timestamp) if header_timestamp else None,
    )


def run_iteration(
    conn: psycopg2.extensions.connection,
    feeds: Iterable[str],
    timeout: float,
    dry_run: bool,
    failure_state: dict[str, dict[str, object]],
    failure_history: dict[datetime.date, dict[str, set[str]]],
    failure_threshold: int,
    webhook_url: str | None,
    webhook_username: str | None,
    webhook_avatar_url: str | None,
    stop_times_csv: Path | None = None,
    vehicle_history_retention: timedelta | None = None,
) -> bool:
    envelopes: list[FeedEnvelope] = []
    expected_types = {FeedType.VEHICLE_POSITIONS, FeedType.TRIP_UPDATES, FeedType.ALERTS}

    for url in feeds:
        try:
            envelope = fetch_single_feed(url, timeout)
        except Exception as exc:
            LOGGER.exception("Failed to process feed %s", url)
            conn.rollback()
            state = failure_state.setdefault(url, {"count": 0, "alert_sent": False})
            state["count"] = int(state.get("count", 0)) + 1

            now_madrid = datetime.now(MADRID_TZ)
            date_key = now_madrid.date()
            time_str = now_madrid.strftime("%H:%M")
            feed_failures = failure_history.setdefault(date_key, {})
            times = feed_failures.setdefault(url, set())
            times.add(time_str)
            LOGGER.warning(
                "Recorded polling failure for %s at %s Europe/Madrid (consecutive=%d)",
                url,
                time_str,
                state["count"],
            )
            if (
                failure_threshold > 0
                and state["count"] >= failure_threshold
                and not bool(state.get("alert_sent"))
            ):
                send_failure_notification(
                    webhook_url,
                    feed_url=url,
                    failure_count=state["count"],
                    threshold=failure_threshold,
                    exc=exc,
                    username=webhook_username,
                    avatar_url=webhook_avatar_url,
                )
                state["alert_sent"] = True
        else:
            envelopes.append(envelope)
            state = failure_state.setdefault(url, {"count": 0, "alert_sent": False})
            if state.get("count") or state.get("alert_sent"):
                state["count"] = 0
                state["alert_sent"] = False

    feed_types = {env.feed_type for env in envelopes}
    if len(feed_types) != len(expected_types):
        LOGGER.warning(
            "Skipping snapshot because not all feeds were fetched successfully (%s).",
            ", ".join(sorted(env.feed_type.value for env in envelopes)) or "none",
        )
        conn.rollback()
        return False

    cursors = load_feed_cursors(conn)
    if all(_header_is_stale(env.header_timestamp, cursors.get(env.feed_type)) for env in envelopes):
        LOGGER.info("All feed headers unchanged; skipping snapshot write.")
        conn.rollback()
        return False

    indexed = index_envelopes(envelopes)
    polled_at = datetime.now(timezone.utc)

    if dry_run:
        for feed_type, envelope in indexed.items():
            LOGGER.info(
                "Dry run: %s feed contains %d entities (header=%s)",
                feed_type.value,
                len(envelope.message.entity),
                envelope.header_timestamp,
            )
        conn.rollback()
        return True

    lookup = DimLookup(conn, stop_times_csv=stop_times_csv)
    snapshot_id = insert_snapshot(conn, polled_at, indexed)

    delay_count, delay_lookup = store_trip_delays(
        conn,
        snapshot_id,
        indexed[FeedType.TRIP_UPDATES],
        lookup,
    )
    alert_count = store_alerts(
        conn,
        snapshot_id,
        indexed[FeedType.ALERTS],
        lookup,
    )
    trip_feed_timestamp = _epoch_to_datetime(
        indexed[FeedType.TRIP_UPDATES].header_timestamp
        if indexed.get(FeedType.TRIP_UPDATES)
        else None
    )
    vehicle_count = store_vehicle_positions(
        conn,
        snapshot_id,
        polled_at,
        indexed[FeedType.VEHICLE_POSITIONS],
        lookup,
        vehicle_history_retention,
        delay_lookup,
        trip_feed_timestamp,
    )

    for feed_type, envelope in indexed.items():
        update_feed_cursor(conn, feed_type, envelope.header_timestamp, snapshot_id)

    lookup.report_missing()
    conn.commit()

    LOGGER.info(
        "Stored snapshot %s at %s (vehicles=%d, delays=%d, alerts=%d)",
        snapshot_id,
        polled_at.isoformat(),
        vehicle_count,
        delay_count,
        alert_count,
    )

    return True
def _epoch_to_datetime(value: int | str | None) -> datetime | None:
    if value in (None, "", 0):
        return None
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc)
    except (TypeError, ValueError, OverflowError):
        return None


def _seconds_until_next_alignment(
    now: datetime, interval_seconds: float, offset_seconds: float
) -> float:
    """Return seconds to the next aligned poll instant given interval/offset."""

    if interval_seconds <= 0:
        raise ValueError("Alignment interval must be positive.")

    epoch = now.timestamp()
    remainder = (epoch - offset_seconds) % interval_seconds
    wait = (interval_seconds - remainder) % interval_seconds
    if wait < 1e-3:
        return 0.0
    return wait


def classify_feed(url: str, message: gtfs_realtime_pb2.FeedMessage) -> FeedType:
    for entity in message.entity:
        if entity.HasField("vehicle"):
            return FeedType.VEHICLE_POSITIONS
        if entity.HasField("trip_update"):
            return FeedType.TRIP_UPDATES
        if entity.HasField("alert"):
            return FeedType.ALERTS
    url_lower = url.lower()
    if "vehicle" in url_lower:
        return FeedType.VEHICLE_POSITIONS
    if "trip" in url_lower:
        return FeedType.TRIP_UPDATES
    if "alert" in url_lower:
        return FeedType.ALERTS
    raise ValueError(f"Unable to classify feed type for {url}")


def load_feed_cursors(
    conn: psycopg2.extensions.connection,
) -> dict[FeedType, int]:
    cursors: dict[FeedType, int] = {}
    with conn.cursor() as cur:
        cur.execute("SELECT feed_type, last_header_timestamp FROM rt_feed_cursors")
        for feed_type, header in cur.fetchall():
            try:
                cursors[FeedType(feed_type)] = int(header)
            except (ValueError, TypeError):
                continue
    return cursors


def update_feed_cursor(
    conn: psycopg2.extensions.connection,
    feed_type: FeedType,
    header_timestamp: int | None,
    snapshot_id: uuid.UUID,
) -> None:
    if header_timestamp is None:
        return
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO rt_feed_cursors (feed_type, last_header_timestamp, last_snapshot_id)
            VALUES (%s, %s, %s)
            ON CONFLICT (feed_type)
            DO UPDATE SET
                last_header_timestamp = EXCLUDED.last_header_timestamp,
                last_snapshot_id = EXCLUDED.last_snapshot_id
            """,
            (feed_type.value, header_timestamp, str(snapshot_id)),
        )


def index_envelopes(
    envelopes: Sequence[FeedEnvelope],
) -> dict[FeedType, FeedEnvelope]:
    indexed: dict[FeedType, FeedEnvelope] = {}
    for envelope in envelopes:
        existing = indexed.get(envelope.feed_type)
        if existing:
            LOGGER.warning(
                "Duplicate %s feed encountered; keeping the most recent header timestamp.",
                envelope.feed_type.value,
            )
            existing_ts = existing.header_timestamp or -1
            new_ts = envelope.header_timestamp or -1
            if new_ts > existing_ts:
                indexed[envelope.feed_type] = envelope
        else:
            indexed[envelope.feed_type] = envelope
    return indexed


def insert_snapshot(
    conn: psycopg2.extensions.connection,
    polled_at: datetime,
    indexed_envelopes: Mapping[FeedType, FeedEnvelope],
) -> uuid.UUID:
    snapshot_id = uuid.uuid4()
    vehicle_ts = _epoch_to_datetime(
        indexed_envelopes.get(FeedType.VEHICLE_POSITIONS).header_timestamp
        if indexed_envelopes.get(FeedType.VEHICLE_POSITIONS)
        else None
    )
    trip_ts = _epoch_to_datetime(
        indexed_envelopes.get(FeedType.TRIP_UPDATES).header_timestamp
        if indexed_envelopes.get(FeedType.TRIP_UPDATES)
        else None
    )
    alert_ts = _epoch_to_datetime(
        indexed_envelopes.get(FeedType.ALERTS).header_timestamp
        if indexed_envelopes.get(FeedType.ALERTS)
        else None
    )
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO rt_snapshots (
                snapshot_id,
                polled_at_utc,
                vehicle_feed_timestamp_utc,
                trip_feed_timestamp_utc,
                alert_feed_timestamp_utc
            ) VALUES (%s, %s, %s, %s, %s)
            """,
            (
                str(snapshot_id),
                polled_at,
                vehicle_ts,
                trip_ts,
                alert_ts,
            ),
        )
    return snapshot_id




def load_failure_threshold(default: int = 5) -> int:
    raw = os.getenv("FAILURE_ALERT_THRESHOLD")
    value = _to_int(raw) if raw is not None else None
    if value is None:
        return default
    return max(value, 0)


def summarize_day(
    conn: psycopg2.extensions.connection,
    report_date: datetime.date,
    failure_times: dict[str, set[str]] | None,
) -> tuple[str, bool]:
    """Return a summary report string and flag if any data was found."""

    start_madrid = datetime.combine(report_date, dt_time.min, tzinfo=MADRID_TZ)
    end_madrid = start_madrid + timedelta(days=1)
    start_utc = start_madrid.astimezone(timezone.utc)
    end_utc = end_madrid.astimezone(timezone.utc)

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*) AS snapshots,
                   MIN(polled_at_utc),
                   MAX(polled_at_utc)
            FROM rt_snapshots
            WHERE polled_at_utc >= %s AND polled_at_utc < %s
            """,
            (start_utc, end_utc),
        )
        snapshot_count, first_poll, last_poll = cur.fetchone()

        cur.execute(
            """
            SELECT COUNT(*)
            FROM rt_vehicle_positions vp
            JOIN rt_snapshots rs USING (snapshot_id)
            WHERE rs.polled_at_utc >= %s AND rs.polled_at_utc < %s
            """,
            (start_utc, end_utc),
        )
        vehicle_rows_total = cur.fetchone()[0]

        cur.execute(
            f"""
            SELECT COUNT(*)
            FROM {RODALIES_POSITIONS_TABLE} vp
            JOIN rt_snapshots rs USING (snapshot_id)
            WHERE rs.polled_at_utc >= %s AND rs.polled_at_utc < %s
            """,
            (start_utc, end_utc),
        )
        rodalies_rows_total = cur.fetchone()[0]

        cur.execute(
            """
            SELECT COUNT(*)
            FROM rt_trip_delays td
            JOIN rt_snapshots rs USING (snapshot_id)
            WHERE rs.polled_at_utc >= %s AND rs.polled_at_utc < %s
            """,
            (start_utc, end_utc),
        )
        trip_updates_total = cur.fetchone()[0]

        cur.execute(
            """
            SELECT COUNT(DISTINCT alert_id)
            FROM rt_alerts ra
            JOIN rt_snapshots rs USING (snapshot_id)
            WHERE rs.polled_at_utc >= %s AND rs.polled_at_utc < %s
            """,
            (start_utc, end_utc),
        )
        distinct_alerts = cur.fetchone()[0]

    lines = [
        f"**GTFS-RT Daily Report – {report_date.strftime('%Y-%m-%d')} (Europe/Madrid)**",
        "",
    ]

    if snapshot_count:
        lines.append(
            f"Snapshots captured: {snapshot_count} "
            f"(first {first_poll.isoformat() if first_poll else 'n/a'}, "
            f"last {last_poll.isoformat() if last_poll else 'n/a'})."
        )
        lines.append(
            f"Vehicle position rows (all services): {vehicle_rows_total}."
        )
        lines.append(
            f"Rodalies vehicle rows: {rodalies_rows_total}."
        )
        lines.append(
            f"Trip updates stored: {trip_updates_total}, distinct alerts stored: {distinct_alerts}."
        )
    else:
        lines.append(
            f"No GTFS-RT snapshots were captured on {report_date.strftime('%Y-%m-%d')} "
            "(Europe/Madrid)."
        )

    failure_section_added = False
    if failure_times:
        sorted_feeds = sorted(failure_times.keys())
        if sorted_feeds:
            lines.append("")
            lines.append("Polling failures (Europe/Madrid):")
            for feed_url in sorted_feeds:
                times = sorted(failure_times.get(feed_url, []))
                if times:
                    lines.append(
                        f"- `{feed_url}` at {', '.join(times)}"
                    )
            failure_section_added = True

    if not failure_section_added:
        lines.append("")
        lines.append("Polling failures: none recorded.")

    has_data = bool(snapshot_count or vehicle_rows_total or trip_updates_total or distinct_alerts)
    if not has_data and failure_times:
        has_data = any(failure_times.values())

    return "\n".join(lines), has_data


def maybe_send_daily_report(
    conn: psycopg2.extensions.connection,
    report_state: dict[str, datetime.date | None],
    failure_history: dict[datetime.date, dict[str, set[str]]],
    webhook_url: str | None,
    username: str | None,
    avatar_url: str | None,
) -> None:
    now_madrid = datetime.now(MADRID_TZ)
    current_date = now_madrid.date()
    last_sent = report_state.get("last_sent_date")

    if last_sent == current_date:
        return

    if now_madrid.time() < dt_time(hour=0, minute=5):
        return

    if not webhook_url:
        report_state["last_sent_date"] = current_date
        LOGGER.debug("Daily report webhook not configured; skipping report dispatch.")
        return

    report_date = current_date - timedelta(days=1)
    if report_date.year < 1970:
        report_state["last_sent_date"] = current_date
        return

    report_text, _ = summarize_day(conn, report_date, failure_history.get(report_date, {}))

    caption = f"daily report for {report_date.strftime('%Y-%m-%d')}"

    posted = post_discord_webhook(
        webhook_url,
        content=report_text,
        username=username,
        avatar_url=avatar_url,
        logger_context=caption,
    )
    if posted:
        report_state["last_sent_date"] = current_date
        failure_history.pop(report_date, None)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    project_root = Path(__file__).resolve().parent.parent
    load_dotenv(dotenv_path=project_root / ".env")

    args = parse_args()
    if args.interval is None:
        interval_env = os.getenv("POLL_INTERVAL")
        if interval_env:
            try:
                args.interval = float(interval_env)
            except ValueError as exc:
                raise SystemExit(
                    f"Invalid POLL_INTERVAL value: {interval_env!r}. Provide a numeric interval."
                ) from exc
    if args.interval is not None and args.interval <= 0:
        raise SystemExit("Polling interval must be greater than zero.")

    align_interval = args.align_interval
    if align_interval is None:
        align_env = os.getenv("POLL_ALIGN_INTERVAL")
        if align_env:
            try:
                align_interval = float(align_env)
            except ValueError as exc:
                raise SystemExit(
                    f"Invalid POLL_ALIGN_INTERVAL value: {align_env!r}. Provide a numeric interval."
                ) from exc

    align_offset = args.align_offset
    if align_offset is None:
        align_offset_env = os.getenv("POLL_ALIGN_OFFSET")
        if align_offset_env:
            try:
                align_offset = float(align_offset_env)
            except ValueError as exc:
                raise SystemExit(
                    f"Invalid POLL_ALIGN_OFFSET value: {align_offset_env!r}. Provide a numeric offset."
                ) from exc

    if align_interval is not None:
        if align_interval <= 0:
            raise SystemExit("POLL_ALIGN_INTERVAL must be greater than zero.")
        if align_offset is None:
            align_offset = 0.0
        align_offset = float(align_offset) % align_interval
        LOGGER.info(
            "Poll alignment enabled (interval=%ss, offset=%ss)",
            align_interval,
            align_offset,
        )
    else:
        if align_offset is not None:
            LOGGER.warning(
                "POLL_ALIGN_OFFSET provided without POLL_ALIGN_INTERVAL; ignoring offset value."
            )
        align_offset = None

    database_url = ensure_database_url(args.database_url)

    auto_refresh_static = args.auto_refresh_static or _to_bool(os.getenv("AUTO_REFRESH_STATIC"))

    static_refresh_time_str = (
        args.static_refresh_time
        or os.getenv("STATIC_REFRESH_TIME")
        or "10:00"
    )
    try:
        static_refresh_time = _parse_time_of_day(static_refresh_time_str)
    except ValueError as exc:
        raise SystemExit(f"Invalid static refresh time: {static_refresh_time_str!r}") from exc

    static_zip_path_value = args.static_zip_path or os.getenv("STATIC_REFRESH_ZIP_PATH")
    static_zip_path = Path(static_zip_path_value).expanduser() if static_zip_path_value else None
    static_zip_url = args.static_zip_url or os.getenv("STATIC_REFRESH_ZIP_URL")

    initial_static_refresh_env = os.getenv("INITIAL_STATIC_REFRESH")
    if initial_static_refresh_env is not None:
        initial_static_refresh = _to_bool(initial_static_refresh_env)
    else:
        initial_static_refresh = auto_refresh_static

    auto_archive_snapshots = args.auto_archive_snapshots or _to_bool(os.getenv("AUTO_ARCHIVE_SNAPSHOTS"))

    archive_retention_days = args.archive_retention_days
    if archive_retention_days is None:
        retention_env = os.getenv("ARCHIVE_RETENTION_DAYS")
        if retention_env:
            try:
                archive_retention_days = float(retention_env)
            except ValueError as exc:
                raise SystemExit(
                    f"Invalid ARCHIVE_RETENTION_DAYS value: {retention_env!r}. Provide a numeric value."
                ) from exc
    if archive_retention_days is None:
        archive_retention_days = 7.0
    if archive_retention_days <= 0:
        raise SystemExit("Archive retention days must be greater than zero.")

    archive_time_str = args.archive_time or os.getenv("ARCHIVE_TIME") or "02:00"
    try:
        archive_time = _parse_time_of_day(archive_time_str)
    except ValueError as exc:
        raise SystemExit(f"Invalid snapshot archive time: {archive_time_str!r}") from exc

    archive_force = args.archive_force or _to_bool(os.getenv("ARCHIVE_FORCE"))

    initial_archive_env = os.getenv("INITIAL_ARCHIVE_SNAPSHOTS")
    if initial_archive_env is not None:
        initial_archive_snapshots = _to_bool(initial_archive_env)
    else:
        initial_archive_snapshots = auto_archive_snapshots

    archive_interval_days = args.archive_interval_days
    if archive_interval_days is None:
        interval_env = os.getenv("ARCHIVE_INTERVAL_DAYS")
        if interval_env:
            try:
                archive_interval_days = float(interval_env)
            except ValueError as exc:
                raise SystemExit(
                    f"Invalid ARCHIVE_INTERVAL_DAYS value: {interval_env!r}. Provide a numeric value."
                ) from exc
    if archive_interval_days is None:
        archive_interval_days = 1.0
    if archive_interval_days <= 0:
        raise SystemExit("Archive interval days must be greater than zero.")

    stop_times_csv = args.stop_times_csv or os.getenv("STOP_TIMES_CSV_PATH")
    stop_times_path: Path | None = None
    if stop_times_csv:
        candidate = Path(stop_times_csv).expanduser()
        if candidate.exists():
            stop_times_path = candidate
            LOGGER.info("Using stop_times CSV fallback at %s", candidate)
        else:
            LOGGER.warning(
                "stop_times CSV fallback %s does not exist; ignoring fallback option.",
                candidate,
            )

    vehicle_history_hours = args.vehicle_history_hours
    if vehicle_history_hours is None:
        history_env = os.getenv("VEHICLE_HISTORY_HOURS")
        if history_env:
            try:
                vehicle_history_hours = float(history_env)
            except ValueError as exc:
                raise SystemExit(
                    f"Invalid VEHICLE_HISTORY_HOURS value: {history_env!r}. Provide a numeric value."
                ) from exc
    if vehicle_history_hours is None:
        vehicle_history_hours = 24.0
    if vehicle_history_hours <= 0:
        raise SystemExit("Vehicle history hours must be greater than zero.")
    vehicle_history_retention = timedelta(hours=vehicle_history_hours)

    feeds = poll_gtfs.resolve_feeds(args.feeds)
    if not feeds:
        raise SystemExit(
            "No feeds provided. Use --feed multiple times or set RENFE_GTFS_FEEDS env var."
        )

    static_refresh_script = project_root / "scripts" / "refresh_static_gtfs.py"
    static_refresh_state: dict[str, datetime.date | None] = {"last_refresh_date": None}
    archive_script = project_root / "scripts" / "archive_db_snapshots.py"

    archive_interval_delta = timedelta(days=archive_interval_days)

    # Connect to database early so we can check archive status
    conn = connect(database_url)
    ensure_schema(conn)

    latest_archive_date: datetime.date | None = None
    if auto_archive_snapshots and not args.dry_run:
        latest_archive_date = fetch_latest_archive_date(conn)

    today_madrid = datetime.now(MADRID_TZ).date()
    if latest_archive_date:
        next_archive_date = latest_archive_date + archive_interval_delta
    else:
        next_archive_date = today_madrid + archive_interval_delta

    archive_state: dict[str, datetime.date | None] = {
        "last_archive_date": latest_archive_date,
        "last_attempt_date": None,
        "next_archive_date": next_archive_date if auto_archive_snapshots else None,
    }

    if initial_static_refresh and not args.dry_run:
        now_madrid = datetime.now(MADRID_TZ)
        LOGGER.info("Performing startup static GTFS refresh.")
        refresh_ok = run_static_refresh(
            script_path=static_refresh_script,
            project_root=project_root,
            database_url=database_url,
            zip_path=static_zip_path,
            zip_url=static_zip_url,
        )
        if not refresh_ok:
            raise SystemExit("Initial static GTFS refresh failed; aborting poller startup.")
        if now_madrid.time() >= static_refresh_time:
            static_refresh_state["last_refresh_date"] = now_madrid.date()

    # Database connection already created earlier - no need to reconnect
    if auto_archive_snapshots and not args.dry_run and initial_archive_snapshots:
        LOGGER.info("Performing startup snapshot archive run.")
        archive_state["next_archive_date"] = today_madrid
        conn.close()
        archive_ok = run_archive_snapshots(
            script_path=archive_script,
            project_root=project_root,
            database_url=database_url,
            retention_days=archive_retention_days,
            force=archive_force,
        )
        conn = connect(database_url)
        ensure_schema(conn)
        now_madrid = datetime.now(MADRID_TZ)
        archive_state["last_attempt_date"] = now_madrid.date()
        if archive_ok and now_madrid.time() >= archive_time:
            archive_state["last_archive_date"] = now_madrid.date()
            archive_state["next_archive_date"] = now_madrid.date() + archive_interval_delta
        elif archive_state.get("next_archive_date") is None:
            archive_state["next_archive_date"] = now_madrid.date() + archive_interval_delta
        if not archive_ok:
            LOGGER.error("Startup snapshot archive failed; continuing with polling loop.")

    failure_threshold = load_failure_threshold()
    failure_state: dict[str, dict[str, object]] = {}
    failure_history: dict[datetime.date, dict[str, set[str]]] = {}
    report_state: dict[str, datetime.date | None] = {
        "last_sent_date": datetime.now(MADRID_TZ).date()
    }
    webhook_url = os.getenv("DISCORD_WEBHOOK_URL")
    webhook_username = os.getenv("DISCORD_USERNAME")
    webhook_avatar_url = os.getenv("DISCORD_AVATAR_URL")
    webhook_report = os.getenv("DISCORD_REPORT_WEBHOOK_URL")
    report_username = os.getenv("DISCORD_REPORT_USERNAME")
    report_avatar = os.getenv("DISCORD_REPORT_AVATAR_URL")
    shutdown_notified = False

    def _handle_shutdown(signum, frame):
        nonlocal shutdown_notified
        LOGGER.info("Received signal %s; shutting down poller.", signum)
        if (
            not args.dry_run
            and webhook_report
            and not shutdown_notified
        ):
            posted = post_discord_webhook(
                webhook_url,
                content=(
                    ":octagonal_sign: GTFS poller stopped\n"
                    f"Signal {signum} received; ingestion halted."
                ),
                username=webhook_username,
                avatar_url=webhook_avatar_url,
                logger_context="shutdown",
            )
            if posted:
                shutdown_notified = True
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, _handle_shutdown)
    signal.signal(signal.SIGINT, _handle_shutdown)

    startup_notified = False

    interval_value: float | None = None
    if args.interval is not None:
        interval_value = max(args.interval, 1.0)

    def wait_for_alignment() -> None:
        if align_interval is None:
            return
        delay = _seconds_until_next_alignment(
            datetime.now(timezone.utc), align_interval, align_offset or 0.0
        )
        if delay > 0:
            LOGGER.debug("Sleeping %.2fs to align next poll window.", delay)
            time.sleep(delay)

    try:
        if align_interval is not None:
            LOGGER.info(
                "Entering aligned polling loop (interval=%ss, offset=%ss)",
                align_interval,
                align_offset,
            )
        elif interval_value is not None:
            LOGGER.info("Entering polling loop (interval=%ss)", interval_value)

        first_cycle = True
        while True:
            if align_interval is not None:
                wait_for_alignment()
            elif not first_cycle:
                if interval_value is None:
                    break
                LOGGER.debug("Sleeping %.2fs before next poll.", interval_value)
                time.sleep(interval_value)

            if auto_refresh_static and not args.dry_run:
                now_madrid = datetime.now(MADRID_TZ)
                last_refresh_date = static_refresh_state.get("last_refresh_date")
                if now_madrid.time() >= static_refresh_time and last_refresh_date != now_madrid.date():
                    LOGGER.info(
                        "Triggering scheduled static GTFS refresh for %s",
                        now_madrid.date(),
                    )
                    conn.close()
                    refresh_ok = run_static_refresh(
                        script_path=static_refresh_script,
                        project_root=project_root,
                        database_url=database_url,
                        zip_path=static_zip_path,
                        zip_url=static_zip_url,
                    )
                    if not refresh_ok:
                        raise SystemExit("Static GTFS refresh failed; poller stopping.")
                    conn = connect(database_url)
                    ensure_schema(conn)
                    static_refresh_state["last_refresh_date"] = now_madrid.date()
                    failure_state.clear()
                    failure_history.clear()
                    continue

            if auto_archive_snapshots and not args.dry_run:
                now_madrid = datetime.now(MADRID_TZ)
                if now_madrid.time() >= archive_time:
                    last_archive_date = archive_state.get("last_archive_date")
                    last_attempt_date = archive_state.get("last_attempt_date")
                    next_archive_date = archive_state.get("next_archive_date")
                    if (
                        last_archive_date != now_madrid.date()
                        and last_attempt_date != now_madrid.date()
                        and (next_archive_date is None or now_madrid.date() >= next_archive_date)
                    ):
                        LOGGER.info(
                            "Triggering scheduled snapshot archive for %s",
                            now_madrid.date(),
                        )
                        conn.close()
                        archive_ok = run_archive_snapshots(
                            script_path=archive_script,
                            project_root=project_root,
                            database_url=database_url,
                            retention_days=archive_retention_days,
                            force=archive_force,
                        )
                        archive_state["last_attempt_date"] = now_madrid.date()
                        conn = connect(database_url)
                        ensure_schema(conn)
                        if archive_ok:
                            archive_state["last_archive_date"] = now_madrid.date()
                            archive_state["next_archive_date"] = now_madrid.date() + archive_interval_delta
                        else:
                            LOGGER.error(
                                "Snapshot archive failed for %s; polling will continue without compression.",
                                now_madrid.date(),
                            )
                            if archive_state.get("next_archive_date") is None:
                                archive_state["next_archive_date"] = now_madrid.date() + archive_interval_delta
                        continue

            success = run_iteration(
                conn,
                feeds,
                args.http_timeout,
                args.dry_run,
                failure_state,
                failure_history,
                failure_threshold,
                webhook_url,
                webhook_username,
                webhook_avatar_url,
                stop_times_path,
                vehicle_history_retention,
            )
            if (
                not startup_notified
                and not args.dry_run
                and webhook_url
                and success
            ):
                message = (
                    ":white_check_mark: GTFS poller connected\nInitial polling completed successfully."
                    if first_cycle
                    else ":white_check_mark: GTFS poller connected\nPolling loop is now storing snapshots."
                )
                posted = post_discord_webhook(
                    webhook_url,
                    content=message,
                    username=webhook_username,
                    avatar_url=webhook_avatar_url,
                    logger_context="startup connectivity",
                )
                if posted:
                    startup_notified = True

            maybe_send_daily_report(
                conn,
                report_state,
                failure_history,
                webhook_report,
                report_username,
                report_avatar,
            )

            first_cycle = False

            if args.once or args.dry_run:
                break
            if align_interval is None and interval_value is None:
                break
    finally:
        if (
            not args.dry_run
            and webhook_url
            and not shutdown_notified
        ):
            posted = post_discord_webhook(
                webhook_url,
                content=(
                    ":stop_sign: GTFS poller halted\n"
                    "Ingestion loop exited."
                ),
                username=webhook_username,
                avatar_url=webhook_avatar_url,
                logger_context="shutdown",
            )
            if posted:
                shutdown_notified = True
        conn.close()


if __name__ == "__main__":
    main()
