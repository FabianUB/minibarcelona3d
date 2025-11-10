#!/usr/bin/env python3
"""Archive historical GTFS-RT rows inside PostgreSQL by storing gzip blobs."""
from __future__ import annotations

import argparse
import gzip
import io
import logging
import os
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Sequence

import psycopg2
from psycopg2 import sql
from psycopg2.extensions import connection as PgConnection

LOGGER = logging.getLogger(__name__)

TABLE_SELECTS: dict[str, str] = {
    "rt_snapshots": "SELECT * FROM rt_snapshots WHERE snapshot_id IN ({ids}) ORDER BY polled_at_utc, snapshot_id",
    "rt_vehicle_positions": "SELECT * FROM rt_vehicle_positions WHERE snapshot_id IN ({ids}) ORDER BY snapshot_id, entity_id",
    "rt_trip_delays": "SELECT * FROM rt_trip_delays WHERE snapshot_id IN ({ids}) ORDER BY snapshot_id, trip_id, stop_sequence NULLS FIRST",
    "rt_alerts": "SELECT * FROM rt_alerts WHERE snapshot_id IN ({ids}) ORDER BY snapshot_id, alert_id, language",
    "rt_alert_routes": "SELECT * FROM rt_alert_routes WHERE snapshot_id IN ({ids}) ORDER BY snapshot_id, alert_id, route_id",
    "rt_alert_stops": "SELECT * FROM rt_alert_stops WHERE snapshot_id IN ({ids}) ORDER BY snapshot_id, alert_id, stop_id",
    "rt_alert_trips": "SELECT * FROM rt_alert_trips WHERE snapshot_id IN ({ids}) ORDER BY snapshot_id, alert_id, trip_id",
    "rt_alert_active_periods": "SELECT * FROM rt_alert_active_periods WHERE snapshot_id IN ({ids}) ORDER BY snapshot_id, alert_id, period_index",
}


@dataclass
class ArchiveSummary:
    archive_date: date
    snapshot_ids: list[str]
    row_counts: dict[str, int]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compress historical snapshot rows inside PostgreSQL to conserve disk space."
    )
    parser.add_argument(
        "--database-url",
        help="PostgreSQL database URL or set DATABASE_URL env var.",
    )
    parser.add_argument(
        "--retention-days",
        type=float,
        default=7.0,
        help="Keep raw rows newer than this many days; archive anything older (default: 7).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List which snapshot dates would be archived without modifying the database.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite existing archives for a date instead of skipping them.",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        help="Python logging level (default: INFO).",
    )
    return parser.parse_args()


def resolve_database_url(cli_value: str | None) -> str:
    if cli_value:
        return cli_value
    env_value = os.getenv("DATABASE_URL")
    if env_value:
        return env_value
    raise SystemExit("Database URL not provided. Use --database-url or set DATABASE_URL.")


def connect(database_url: str) -> PgConnection:
    conn = psycopg2.connect(database_url)
    conn.autocommit = False
    return conn


def ensure_archive_table(conn: PgConnection) -> None:
    statement = """
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
    """
    with conn.cursor() as cur:
        cur.execute(statement)
    conn.commit()


def fetch_archive_candidates(conn: PgConnection, cutoff: datetime) -> list[tuple[date, list[str]]]:
    query = """
        SELECT polled_at_utc::date AS archive_date,
               array_agg(snapshot_id ORDER BY polled_at_utc, snapshot_id) AS snapshot_ids
        FROM rt_snapshots
        WHERE polled_at_utc < %s
        GROUP BY 1
        ORDER BY 1;
    """
    with conn.cursor() as cur:
        cur.execute(query, (cutoff,))
        rows = cur.fetchall()
    return [(row[0], row[1]) for row in rows]


def archive_exists(conn: PgConnection, archive_date: date) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM rt_snapshot_archives WHERE archive_date = %s", (archive_date,))
        return cur.fetchone() is not None


def dump_table_to_gzip(conn: PgConnection, select_sql: str) -> tuple[bytes | None, int]:
    buffer = io.StringIO()
    with conn.cursor() as cur:
        cur.copy_expert(f"COPY ({select_sql}) TO STDOUT WITH CSV HEADER", buffer)
    text = buffer.getvalue()
    if not text:
        return None, 0
    lines = text.splitlines()
    row_count = max(len(lines) - 1, 0) if lines else 0
    return gzip.compress(text.encode("utf-8"), compresslevel=9), row_count


def delete_snapshot_rows(conn: PgConnection, table: str, snapshot_ids: Sequence[str]) -> int:
    query = sql.SQL("DELETE FROM {} WHERE snapshot_id = ANY(%s)").format(sql.Identifier(table))
    with conn.cursor() as cur:
        cur.execute(query, (list(snapshot_ids),))
        return cur.rowcount or 0


def delete_snapshots(conn: PgConnection, snapshot_ids: Sequence[str]) -> int:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM rt_snapshots WHERE snapshot_id = ANY(%s)", (list(snapshot_ids),))
        return cur.rowcount or 0


def archive_day(
    conn: PgConnection,
    archive_date: date,
    snapshot_ids: Sequence[str],
    dry_run: bool,
    force: bool,
) -> ArchiveSummary | None:
    if not snapshot_ids:
        return None

    if archive_exists(conn, archive_date) and not force:
        LOGGER.info("Skipping %s (archive already exists)", archive_date)
        return None

    ids_literal = ", ".join(sql.Literal(str(sid)).as_string(conn) for sid in snapshot_ids)
    row_counts: dict[str, int] = {}
    compressed_results: dict[str, bytes | None] = {}

    for table, template in TABLE_SELECTS.items():
        select_sql = template.format(ids=ids_literal)
        compressed, count = dump_table_to_gzip(conn, select_sql)
        compressed_results[table] = compressed
        row_counts[table] = count

    if dry_run:
        LOGGER.info(
            "Would archive %s (%d snapshots, %d vehicle rows, %d trip rows)",
            archive_date,
            len(snapshot_ids),
            row_counts.get("rt_vehicle_positions", 0),
            row_counts.get("rt_trip_delays", 0),
        )
        return ArchiveSummary(archive_date=archive_date, snapshot_ids=list(snapshot_ids), row_counts=row_counts)

    with conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO rt_snapshot_archives (
                    archive_date,
                    snapshot_ids,
                    snapshot_csv,
                    vehicle_positions_csv,
                    trip_delays_csv,
                    alerts_csv,
                    alert_routes_csv,
                    alert_stops_csv,
                    alert_trips_csv,
                    alert_active_periods_csv
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (archive_date) DO UPDATE
                SET snapshot_ids = EXCLUDED.snapshot_ids,
                    snapshot_csv = EXCLUDED.snapshot_csv,
                    vehicle_positions_csv = EXCLUDED.vehicle_positions_csv,
                    trip_delays_csv = EXCLUDED.trip_delays_csv,
                    alerts_csv = EXCLUDED.alerts_csv,
                    alert_routes_csv = EXCLUDED.alert_routes_csv,
                    alert_stops_csv = EXCLUDED.alert_stops_csv,
                    alert_trips_csv = EXCLUDED.alert_trips_csv,
                    alert_active_periods_csv = EXCLUDED.alert_active_periods_csv,
                    created_at = now();
                """,
                (
                    archive_date,
                    list(snapshot_ids),
                    compressed_results["rt_snapshots"],
                    compressed_results["rt_vehicle_positions"],
                    compressed_results["rt_trip_delays"],
                    compressed_results["rt_alerts"],
                    compressed_results["rt_alert_routes"],
                    compressed_results["rt_alert_stops"],
                    compressed_results["rt_alert_trips"],
                    compressed_results["rt_alert_active_periods"],
                ),
            )

        for table in (
            "rt_vehicle_positions",
            "rt_trip_delays",
            "rt_alert_routes",
            "rt_alert_stops",
            "rt_alert_trips",
            "rt_alert_active_periods",
            "rt_alerts",
        ):
            deleted = delete_snapshot_rows(conn, table, snapshot_ids)
            LOGGER.debug("Deleted %d rows from %s for %s", deleted, table, archive_date)

        delete_snapshots(conn, snapshot_ids)

    LOGGER.info(
        "Archived %s (%d snapshots, %d vehicle rows, %d trip rows)",
        archive_date,
        len(snapshot_ids),
        row_counts.get("rt_vehicle_positions", 0),
        row_counts.get("rt_trip_delays", 0),
    )
    return ArchiveSummary(archive_date=archive_date, snapshot_ids=list(snapshot_ids), row_counts=row_counts)


def main() -> None:
    args = parse_args()
    logging.basicConfig(level=getattr(logging, args.log_level.upper(), logging.INFO))
    database_url = resolve_database_url(args.database_url)
    conn = connect(database_url)
    ensure_archive_table(conn)

    cutoff = datetime.now(timezone.utc) - timedelta(days=args.retention_days)
    candidates = fetch_archive_candidates(conn, cutoff)

    if not candidates:
        LOGGER.info("No snapshot dates older than %s", cutoff.date())
        return

    LOGGER.info("Found %d archive candidates older than %s", len(candidates), cutoff.date())

    for archive_date, snapshot_ids in candidates:
        archive_day(conn, archive_date, snapshot_ids, dry_run=args.dry_run, force=args.force)

    if not args.dry_run:
        conn.commit()
        LOGGER.info("Archival complete; run VACUUM FULL manually if further disk compaction is needed.")
    conn.close()


if __name__ == "__main__":
    main()
