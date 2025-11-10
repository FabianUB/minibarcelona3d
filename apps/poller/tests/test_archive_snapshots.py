import shutil
import sys
import tarfile
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.archive_snapshots import TIMESTAMP_FORMAT, archive_snapshots


class ArchiveSnapshotsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.mkdtemp()
        self.root = Path(self.tempdir)

    def tearDown(self) -> None:
        shutil.rmtree(self.tempdir)

    def _make_snapshot(self, timestamp: str, marker: str) -> Path:
        snapshot_dir = self.root / timestamp
        snapshot_dir.mkdir()
        (snapshot_dir / "payload.pb").write_text(marker, encoding="utf-8")
        return snapshot_dir

    def test_archives_folders_older_than_retention(self) -> None:
        old_ts = (datetime.now(timezone.utc) - timedelta(days=9)).strftime(TIMESTAMP_FORMAT)
        recent_ts = (datetime.now(timezone.utc) - timedelta(days=2)).strftime(TIMESTAMP_FORMAT)

        old_dir = self._make_snapshot(old_ts, "older")
        recent_dir = self._make_snapshot(recent_ts, "recent")

        archive_snapshots(root=self.root, retention_days=7, dry_run=False, force=False)

        old_archive = self.root / f"{old_ts}.tar.gz"
        self.assertTrue(old_archive.exists(), "Expected old snapshot to be compressed")
        self.assertFalse(old_dir.exists(), "Old snapshot directory should be removed after archiving")
        self.assertTrue(recent_dir.exists(), "Recent snapshot should remain untouched")
        self.assertFalse((self.root / f"{recent_ts}.tar.gz").exists(), "Recent snapshot should not be archived")

        with tarfile.open(old_archive, "r:gz") as handle:
            members = handle.getnames()
            self.assertIn(f"{old_ts}/payload.pb", members)

    def test_dry_run_does_not_modify_filesystem(self) -> None:
        old_ts = (datetime.now(timezone.utc) - timedelta(days=9)).strftime(TIMESTAMP_FORMAT)
        snapshot_dir = self._make_snapshot(old_ts, "older")

        archive_snapshots(root=self.root, retention_days=7, dry_run=True, force=False)

        self.assertTrue(snapshot_dir.exists(), "Dry run must not remove snapshot directory")
        self.assertFalse((self.root / f"{old_ts}.tar.gz").exists(), "Dry run must not create archive")


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
