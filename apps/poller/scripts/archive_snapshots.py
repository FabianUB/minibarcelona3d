#!/usr/bin/env python3
"""Archive GTFS snapshot folders older than the retention window."""
from __future__ import annotations

import argparse
import logging
import shutil
import tarfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable


LOGGER = logging.getLogger(__name__)

TIMESTAMP_FORMAT = "%Y%m%dT%H%M%SZ"


@dataclass
class ArchiveResult:
    source: Path
    archive: Path
    skipped: bool
    reason: str | None = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compress timestamped GTFS snapshot folders to tar.gz archives."
    )
    parser.add_argument(
        "--root",
        default="data/raw",
        help="Root directory containing timestamped snapshot folders (default: data/raw).",
    )
    parser.add_argument(
        "--retention-days",
        type=float,
        default=7.0,
        help="Keep snapshots newer than this many days uncompressed (default: 7).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show which folders would be archived without modifying the filesystem.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Recreate archives even if a .tar.gz already exists.",
    )
    return parser.parse_args()


def iter_snapshot_dirs(root: Path) -> Iterable[tuple[Path, datetime]]:
    for entry in sorted(root.iterdir()):
        if not entry.is_dir():
            continue
        try:
            snapshot_dt = datetime.strptime(entry.name, TIMESTAMP_FORMAT)
        except ValueError:
            LOGGER.debug("Skipping non snapshot folder: %s", entry.name)
            continue
        yield entry, snapshot_dt.replace(tzinfo=timezone.utc)


def create_archive(source: Path, target: Path) -> None:
    tmp_target = target.with_name(target.name + ".tmp")
    if tmp_target.exists():
        tmp_target.unlink()

    with tarfile.open(tmp_target, mode="w:gz") as handle:
        handle.add(source, arcname=source.name)

    tmp_target.replace(target)


def archive_snapshots(
    root: Path, retention_days: float, dry_run: bool = False, force: bool = False
) -> list[ArchiveResult]:
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=retention_days)
    results: list[ArchiveResult] = []

    for snapshot_dir, snapshot_dt in iter_snapshot_dirs(root):
        archive_path = snapshot_dir.parent / f"{snapshot_dir.name}.tar.gz"

        if snapshot_dt > cutoff:
            results.append(
                ArchiveResult(
                    source=snapshot_dir,
                    archive=archive_path,
                    skipped=True,
                    reason="within retention window",
                )
            )
            continue

        if archive_path.exists() and not force:
            results.append(
                ArchiveResult(
                    source=snapshot_dir,
                    archive=archive_path,
                    skipped=True,
                    reason="archive already exists",
                )
            )
            continue

        if dry_run:
            action = "would recreate" if archive_path.exists() else "would create"
            LOGGER.info("%s archive for %s", action.capitalize(), snapshot_dir.name)
            results.append(
                ArchiveResult(source=snapshot_dir, archive=archive_path, skipped=True, reason="dry-run")
            )
            continue

        if archive_path.exists() and force:
            LOGGER.info("Removing existing archive %s before recreation", archive_path.name)
            archive_path.unlink()

        LOGGER.info("Archiving %s -> %s", snapshot_dir.name, archive_path.name)
        create_archive(snapshot_dir, archive_path)
        shutil.rmtree(snapshot_dir)
        results.append(
            ArchiveResult(source=snapshot_dir, archive=archive_path, skipped=False)
        )

    return results


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    args = parse_args()
    root = Path(args.root).resolve()

    if not root.exists():
        raise SystemExit(f"Root directory does not exist: {root}")

    if not root.is_dir():
        raise SystemExit(f"Root path is not a directory: {root}")

    archive_snapshots(root=root, retention_days=args.retention_days, dry_run=args.dry_run, force=args.force)


if __name__ == "__main__":
    main()
