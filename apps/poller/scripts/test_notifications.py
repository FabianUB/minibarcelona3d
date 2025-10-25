#!/usr/bin/env python3
"""Utility to exercise Discord notification paths for the GTFS poller."""
from __future__ import annotations

import argparse
import os
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

from dotenv import load_dotenv

import poll_to_postgres


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Send test notifications to the configured Discord webhooks and/or "
            "generate the daily GTFS summary without running the poller loop."
        )
    )
    parser.add_argument(
        "--check-alert",
        action="store_true",
        help="Send a sample failure alert using DISCORD_WEBHOOK_URL (or --alert-webhook).",
    )
    parser.add_argument(
        "--check-report",
        action="store_true",
        help="Generate the daily report for a given date and optionally post it to Discord.",
    )
    parser.add_argument(
        "--report-date",
        type=lambda value: datetime.strptime(value, "%Y-%m-%d").date(),
        help="Date (Europe/Madrid) to summarise, e.g. 2025-09-18. Defaults to yesterday.",
    )
    parser.add_argument(
        "--database-url",
        default=os.getenv("DATABASE_URL"),
        help="Override DATABASE_URL for report generation.",
    )
    parser.add_argument(
        "--alert-webhook",
        default=os.getenv("DISCORD_WEBHOOK_URL"),
        help="Override DISCORD_WEBHOOK_URL for alert testing.",
    )
    parser.add_argument(
        "--alert-username",
        default=os.getenv("DISCORD_USERNAME"),
        help="Override DISCORD_USERNAME when sending the test alert.",
    )
    parser.add_argument(
        "--alert-avatar",
        default=os.getenv("DISCORD_AVATAR_URL"),
        help="Override DISCORD_AVATAR_URL when sending the test alert.",
    )
    parser.add_argument(
        "--report-webhook",
        default=os.getenv("DISCORD_REPORT_WEBHOOK_URL"),
        help="Override DISCORD_REPORT_WEBHOOK_URL for report testing.",
    )
    parser.add_argument(
        "--report-username",
        default=os.getenv("DISCORD_REPORT_USERNAME"),
        help="Override DISCORD_REPORT_USERNAME when posting the summary.",
    )
    parser.add_argument(
        "--report-avatar",
        default=os.getenv("DISCORD_REPORT_AVATAR_URL"),
        help="Override DISCORD_REPORT_AVATAR_URL when posting the summary.",
    )
    parser.add_argument(
        "--simulate-failure",
        action="append",
        metavar="FEED_URL@HH:MM",
        help="Include a synthetic failure time in the report (repeat for multiple entries).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print payloads instead of posting to Discord.",
    )
    return parser.parse_args()


def ensure_bool_flags(namespace: argparse.Namespace) -> None:
    if not namespace.check_alert and not namespace.check_report:
        raise SystemExit("Nothing to do. Use --check-alert and/or --check-report.")


def synthesise_failures(entries: list[str] | None) -> dict[str, set[str]]:
    failures: dict[str, set[str]] = {}
    if not entries:
        return failures

    for entry in entries:
        if "@" not in entry:
            raise SystemExit(
                f"Invalid --simulate-failure '{entry}'. Expected format FEED_URL@HH:MM"
            )
        feed_url, time_str = entry.split("@", 1)
        feed_url = feed_url.strip()
        time_str = time_str.strip()
        if not feed_url or not time_str:
            raise SystemExit(
                f"Invalid --simulate-failure '{entry}'. Expected format FEED_URL@HH:MM"
            )
        failures.setdefault(feed_url, set()).add(time_str)

    return failures


def main() -> None:
    project_root = Path(__file__).resolve().parent.parent
    load_dotenv(dotenv_path=project_root / ".env")

    args = parse_args()
    ensure_bool_flags(args)

    if args.check_alert:
        content = (
            ":test_tube: **GTFS poller alert test**\n"
            "This is a manual notification to validate the failure webhook configuration."
        )
        if args.dry_run:
            print("[DRY-RUN] Alert payload:\n", content)
        else:
            poll_to_postgres.send_failure_notification(
                args.alert_webhook,
                feed_url="TEST_FEED",
                failure_count=1,
                threshold=1,
                exc=RuntimeError("Simulated failure"),
                username=args.alert_username,
                avatar_url=args.alert_avatar,
            )

    if args.check_report:
        database_url = poll_to_postgres.ensure_database_url(args.database_url)
        report_date = args.report_date or (
            datetime.now(poll_to_postgres.MADRID_TZ).date() - timedelta(days=1)
        )
        failures = synthesise_failures(args.simulate_failure)

        conn = poll_to_postgres.connect(database_url)
        try:
            report_text, has_data = poll_to_postgres.summarize_day(conn, report_date, failures)
        finally:
            conn.close()

        header = f"[Report for {report_date.isoformat()}] (has data: {has_data})"

        if args.dry_run:
            print(header)
            print(report_text)
        else:
            success = poll_to_postgres.post_discord_webhook(
                args.report_webhook,
                content=report_text,
                username=args.report_username,
                avatar_url=args.report_avatar,
                logger_context=f"manual daily report {report_date.isoformat()}",
            )
            if not success:
                sys.exit(1)


if __name__ == "__main__":
    main()
