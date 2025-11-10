import gzip
import os
import sys
import types
import unittest
from pathlib import Path
from typing import Any


class _LiteralStub:
    def __init__(self, value: str):
        self.value = value

    def as_string(self, _conn) -> str:
        return f"'{self.value}'"


class _SQLStub(str):
    def format(self, *args, **kwargs):
        return _SQLStub(super().format(*args, **kwargs))


def _literal(value: str) -> _LiteralStub:
    return _LiteralStub(value)


def _identifier(value: str) -> str:
    return value


psycopg2_stub = types.ModuleType("psycopg2")
psycopg2_sql_stub = types.SimpleNamespace(Literal=_literal, Identifier=_identifier, SQL=_SQLStub)
psycopg2_stub.sql = psycopg2_sql_stub
psycopg2_stub.connect = lambda *args, **kwargs: None
psycopg2_extensions_stub = types.SimpleNamespace(connection=object)
psycopg2_stub.extensions = psycopg2_extensions_stub

sys.modules.setdefault("psycopg2", psycopg2_stub)
sys.modules.setdefault("psycopg2.sql", psycopg2_sql_stub)
sys.modules.setdefault("psycopg2.extensions", psycopg2_extensions_stub)

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.archive_db_snapshots import dump_table_to_gzip, resolve_database_url


class CopyCursor:
    def __init__(self, copy_payload: str):
        self.copy_payload = copy_payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def copy_expert(self, _sql: str, buffer: Any) -> None:
        buffer.write(self.copy_payload)


class CopyConn:
    def __init__(self, copy_payload: str):
        self.copy_payload = copy_payload

    def cursor(self):
        return CopyCursor(self.copy_payload)


class ArchiveDbSnapshotsTest(unittest.TestCase):
    def test_resolve_database_url_prefers_cli(self):
        os.environ.pop("DATABASE_URL", None)
        result = resolve_database_url("postgres://example")
        self.assertEqual(result, "postgres://example")

    def test_resolve_database_url_env_fallback(self):
        os.environ["DATABASE_URL"] = "postgres://env"
        result = resolve_database_url(None)
        self.assertEqual(result, "postgres://env")

    def test_dump_table_to_gzip_counts_rows(self):
        payload = "col1,col2\n1,2\n3,4\n"
        conn = CopyConn(payload)
        compressed, count = dump_table_to_gzip(conn, "SELECT * FROM demo")
        self.assertEqual(count, 2)
        self.assertEqual(
            gzip.decompress(compressed).decode("utf-8"),
            payload,
        )

    def test_dump_table_to_gzip_handles_empty(self):
        conn = CopyConn("")
        compressed, count = dump_table_to_gzip(conn, "SELECT 1")
        self.assertIsNone(compressed)
        self.assertEqual(count, 0)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
