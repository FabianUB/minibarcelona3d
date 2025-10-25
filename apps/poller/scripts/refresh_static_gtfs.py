#!/usr/bin/env python3
"""Refresh static GTFS dimensions from a Renfe zip bundle."""
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Load GTFS static data into PostgreSQL dimension tables.",
    )
    parser.add_argument(
        "--zip-path",
        default="data/static/fomento_transit.zip",
        help="Path to the GTFS static zip (default: data/static/fomento_transit.zip).",
    )
    parser.add_argument(
        "--zip-url",
        help="Optional URL to download the GTFS static zip if the path is missing.",
    )
    parser.add_argument(
        "--database-url",
        default=os.getenv("DATABASE_URL"),
        help="PostgreSQL connection string (defaults to DATABASE_URL env var).",
    )
    return parser.parse_args()


def ensure_database_url(url: str | None) -> str:
    if not url:
        raise SystemExit(
            "Database URL not provided. Use --database-url or set DATABASE_URL env var."
        )
    return url


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


def _download_zip(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    LOGGER.info("Downloading GTFS static bundle from %s", url)
    with requests.get(url, stream=True, timeout=60) as response:
        response.raise_for_status()
        with open(dest, "wb") as fh:
            for chunk in response.iter_content(chunk_size=1 << 20):
                if chunk:
                    fh.write(chunk)
    LOGGER.info("Saved GTFS static bundle to %s (%s bytes)", dest, dest.stat().st_size)
    return dest


def truncate_dimensions(conn: psycopg2.extensions.connection) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "TRUNCATE TABLE dim_stop_times, dim_trips, dim_routes, dim_stops RESTART IDENTITY CASCADE"
        )
    conn.commit()


def load_routes(conn: psycopg2.extensions.connection, reader: Iterable[dict[str, str]]) -> int:
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
                )
            )
            count += 1
            if len(rows) >= BATCH_SIZE:
                execute_batch(
                    cur,
                    """
                    INSERT INTO dim_routes (
                        route_id, line_code, short_name, long_name,
                        route_type, color, text_color
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s)
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
                    route_type, color, text_color
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                rows,
            )
    conn.commit()
    LOGGER.info("Loaded %d routes", count)
    return count


def load_stops(conn: psycopg2.extensions.connection, reader: Iterable[dict[str, str]]) -> int:
    rows: list[tuple] = []
    count = 0
    with conn.cursor() as cur:
        for row in reader:
            stop_id = _clean(row.get("stop_id"))
            if not stop_id:
                continue
            name = _clean(row.get("stop_name"))
            lat = _to_float(row.get("stop_lat"))
            lon = _to_float(row.get("stop_lon"))
            wheelchair = _to_int(row.get("wheelchair_boarding"))
            rows.append((stop_id, name, lat, lon, wheelchair))
            count += 1
            if len(rows) >= BATCH_SIZE:
                execute_batch(
                    cur,
                    """
                    INSERT INTO dim_stops (
                        stop_id, name, lat, lon, wheelchair_boarding
                    ) VALUES (%s, %s, %s, %s, %s)
                    """,
                    rows,
                )
                rows.clear()
        if rows:
            execute_batch(
                cur,
                """
                INSERT INTO dim_stops (
                    stop_id, name, lat, lon, wheelchair_boarding
                ) VALUES (%s, %s, %s, %s, %s)
                """,
                rows,
            )
    conn.commit()
    LOGGER.info("Loaded %d stops", count)
    return count


def load_trips(conn: psycopg2.extensions.connection, reader: Iterable[dict[str, str]]) -> int:
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
            block_id = _clean(row.get("block_id"))
            wheelchair = _to_int(row.get("wheelchair_accessible"))
            rows.append((trip_id, route_id, service_id, shape_id, block_id, wheelchair))
            count += 1
            if len(rows) >= BATCH_SIZE:
                execute_batch(
                    cur,
                    """
                    INSERT INTO dim_trips (
                        trip_id, route_id, service_id, shape_id, block_id, wheelchair_accessible
                    ) VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    rows,
                )
                rows.clear()
        if rows:
            execute_batch(
                cur,
                """
                INSERT INTO dim_trips (
                    trip_id, route_id, service_id, shape_id, block_id, wheelchair_accessible
                ) VALUES (%s, %s, %s, %s, %s, %s)
                """,
                rows,
            )
    conn.commit()
    LOGGER.info("Loaded %d trips", count)
    return count


def load_stop_times(
    conn: psycopg2.extensions.connection,
    reader: Iterable[dict[str, str]],
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
                )
            )
            count += 1
            if len(rows) >= BATCH_SIZE:
                execute_batch(
                    cur,
                    """
                    INSERT INTO dim_stop_times (
                        trip_id, stop_sequence, stop_id, arrival_seconds, departure_seconds
                    ) VALUES (%s, %s, %s, %s, %s)
                    """,
                    rows,
                )
                rows.clear()
        if rows:
            execute_batch(
                cur,
                """
                INSERT INTO dim_stop_times (
                    trip_id, stop_sequence, stop_id, arrival_seconds, departure_seconds
                ) VALUES (%s, %s, %s, %s, %s)
                """,
                rows,
            )
    conn.commit()
    LOGGER.info("Loaded %d stop_time rows", count)
    return count


def main() -> None:
    args = parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    database_url = ensure_database_url(args.database_url)
    zip_path = Path(args.zip_path)
    if not zip_path.exists():
        if args.zip_url:
            _download_zip(args.zip_url, zip_path)
        else:
            raise SystemExit(f"Zip file not found: {zip_path}")
    elif args.zip_url:
        LOGGER.info("Using existing GTFS bundle at %s; skip download from %s", zip_path, args.zip_url)

    conn = psycopg2.connect(database_url)
    conn.autocommit = False
    try:
        LOGGER.info("Ensuring dimension tables exist before reload.")
        ensure_schema(conn)

        LOGGER.info("Truncating dimension tables before reload.")
        truncate_dimensions(conn)

        with zipfile.ZipFile(zip_path) as zf:
            LOGGER.info("Loading routes.txt")
            with _open_csv(zf, "routes.txt") as raw:
                load_routes(conn, csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig")))

            LOGGER.info("Loading stops.txt")
            with _open_csv(zf, "stops.txt") as raw:
                load_stops(conn, csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig")))

            LOGGER.info("Loading trips.txt")
            with _open_csv(zf, "trips.txt") as raw:
                load_trips(conn, csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig")))

            LOGGER.info("Loading stop_times.txt (this may take a while)")
            with _open_csv(zf, "stop_times.txt") as raw:
                load_stop_times(
                    conn,
                    csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig")),
                )

        LOGGER.info("Static GTFS dimensions refreshed successfully.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
