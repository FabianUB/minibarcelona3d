#!/usr/bin/env python3
"""Fetch GTFS-RT protobuf feeds and persist timestamped snapshots."""
from __future__ import annotations

import argparse
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import requests
from dotenv import load_dotenv
from google.protobuf.json_format import MessageToDict
from google.transit import gtfs_realtime_pb2

LOGGER = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download GTFS-RT protobuf feeds for later batch ingestion."
    )
    parser.add_argument(
        "--feed",
        dest="feeds",
        action="append",
        help="GTFS-RT protobuf feed URL. Provide once per endpoint.",
    )
    parser.add_argument(
        "--output-dir",
        default="data/raw",
        help="Directory where timestamped snapshots are stored (default: data/raw).",
    )
    parser.add_argument(
        "--http-timeout",
        type=float,
        default=15.0,
        help="Seconds to wait for each feed response (default: 15).",
    )
    parser.add_argument(
        "--timestamp",
        help=(
            "Override the timestamp chunk (UTC) used for the snapshot folder, e.g. "
            "20240217T120000Z."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and log feed stats without writing files.",
    )
    parser.add_argument(
        "--no-json",
        action="store_true",
        help="Skip writing JSON projections (default is to produce .json files).",
    )
    args = parser.parse_args()
    return args


def resolve_feeds(cli_feeds: Iterable[str] | None) -> list[str]:
    env_value = os.getenv("RENFE_GTFS_FEEDS", "")
    feeds: list[str] = []

    if env_value:
        feeds.extend(part.strip() for part in env_value.split(",") if part.strip())

    if cli_feeds:
        feeds.extend(feed.strip() for feed in cli_feeds if feed and feed.strip())

    seen: set[str] = set()
    deduped: list[str] = []
    for feed in feeds:
        if feed not in seen:
            seen.add(feed)
            deduped.append(feed)

    return deduped


def current_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def slugify(identifier: str) -> str:
    cleaned = [ch if ch.isalnum() else "_" for ch in identifier]
    slug = "".join(cleaned).strip("_")
    return slug or "feed"


def fetch_feed(url: str, timeout: float) -> tuple[bytes, gtfs_realtime_pb2.FeedMessage]:
    LOGGER.debug("Requesting %s", url)
    response = requests.get(url, timeout=timeout)
    response.raise_for_status()

    feed_message = gtfs_realtime_pb2.FeedMessage()
    feed_message.ParseFromString(response.content)
    return response.content, feed_message


def write_feed_log(
    output_dir: Path,
    slug: str,
    url: str,
    retrieved_at: datetime,
    entity_count: int,
    trip_updates: int,
    vehicle_positions: int,
    alerts: int,
    feed_message: gtfs_realtime_pb2.FeedMessage,
) -> None:
    log_path = output_dir / f"{slug}.log"
    lines = [
        f"retrieved_at_utc={retrieved_at.isoformat()}",
        f"url={url}",
        f"entities={entity_count}",
        f"trip_updates={trip_updates}",
        f"vehicle_positions={vehicle_positions}",
        f"alerts={alerts}",
    ]

    header_timestamp = getattr(feed_message.header, "timestamp", 0)
    if header_timestamp:
        header_iso = datetime.fromtimestamp(header_timestamp, tz=timezone.utc).isoformat()
        lines.append(f"feed_header_timestamp={header_timestamp}")
        lines.append(f"feed_header_datetime_utc={header_iso}")

    log_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def snapshot_feed(
    url: str,
    output_dir: Path,
    timeout: float,
    store_json: bool,
    dry_run: bool,
) -> None:
    raw_bytes, feed_message = fetch_feed(url, timeout)
    retrieved_at = datetime.now(timezone.utc)

    entity_count = len(feed_message.entity)
    trip_updates = sum(1 for entity in feed_message.entity if entity.HasField("trip_update"))
    vehicle_positions = sum(
        1 for entity in feed_message.entity if entity.HasField("vehicle")
    )
    alerts = sum(1 for entity in feed_message.entity if entity.HasField("alert"))

    LOGGER.info(
        "Fetched %s (entities=%d, trip_updates=%d, vehicles=%d, alerts=%d)",
        url,
        entity_count,
        trip_updates,
        vehicle_positions,
        alerts,
    )

    if dry_run:
        return

    slug = slugify(url)
    pb_path = output_dir / f"{slug}.pb"
    pb_path.write_bytes(raw_bytes)

    if store_json:
        json_path = output_dir / f"{slug}.json"
        json_payload = MessageToDict(
            feed_message,
            preserving_proto_field_name=True,
            always_print_fields_with_no_presence=False,
        )
        json_path.write_text(json.dumps(json_payload, indent=2), encoding="utf-8")
        LOGGER.debug("Wrote JSON snapshot to %s", json_path)

    write_feed_log(
        output_dir=output_dir,
        slug=slug,
        url=url,
        retrieved_at=retrieved_at,
        entity_count=entity_count,
        trip_updates=trip_updates,
        vehicle_positions=vehicle_positions,
        alerts=alerts,
        feed_message=feed_message,
    )

    LOGGER.debug("Wrote protobuf snapshot to %s", pb_path)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    project_root = Path(__file__).resolve().parent.parent
    load_dotenv(dotenv_path=project_root / ".env")

    args = parse_args()

    feeds = resolve_feeds(args.feeds)
    if not feeds:
        raise SystemExit(
            "No feeds provided. Use --feed multiple times or set RENFE_GTFS_FEEDS env var."
        )

    timestamp = args.timestamp or current_timestamp()
    output_dir = Path(args.output_dir) / timestamp

    if not args.dry_run:
        output_dir.mkdir(parents=True, exist_ok=True)
        LOGGER.debug("Snapshots will be written under %s", output_dir)
    else:
        LOGGER.info("Dry run: no files will be written.")

    store_json = not args.no_json

    for url in feeds:
        try:
            snapshot_feed(
                url=url,
                output_dir=output_dir,
                timeout=args.http_timeout,
                store_json=store_json,
                dry_run=args.dry_run,
            )
        except requests.RequestException as exc:
            LOGGER.error("HTTP error while fetching %s: %s", url, exc)
        except Exception as exc:  # pragma: no cover - defensive catch for parsing errors
            LOGGER.exception("Unexpected error while processing %s: %s", url, exc)


if __name__ == "__main__":
    main()
