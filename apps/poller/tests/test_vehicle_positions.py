import json
import uuid
from pathlib import Path
import unittest

from google.protobuf.json_format import ParseDict
from google.transit import gtfs_realtime_pb2

from scripts.poll_to_postgres import (
    DimLookup,
    FeedEnvelope,
    FeedType,
    extract_vehicle_position_rows,
)


class StubCursor:
    def __init__(self, data):
        self.data = data
        self._rows: list[tuple] = []
        self._one: tuple | None = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, query, params=None):
        params = params or ()
        sql = query.lower()
        if "from dim_stops" in sql:
            stop_id = params[0]
            self._one = (1,) if stop_id in self.data["stops"] else None
            self._rows = []
        elif "from dim_trips" in sql:
            trip_id = params[0]
            if "route_id" in sql:
                route = self.data["trip_routes"].get(trip_id)
                self._one = (route,) if route else None
            else:
                self._one = (1,) if trip_id in self.data["trips"] else None
            self._rows = []
        elif "from dim_routes" in sql:
            route_id = params[0]
            self._one = (1,) if route_id in self.data["routes"] else None
            self._rows = []
        elif "from dim_stop_times" in sql:
            trip_id = params[0]
            rows = self.data["stop_times"].get(trip_id)
            self._rows = rows[:] if rows else []
            self._one = None
        else:
            self._rows = []
            self._one = None

    def fetchone(self):
        return self._one

    def fetchall(self):
        return self._rows


class StubConnection:
    def __init__(self, data):
        self.data = data

    def cursor(self):
        return StubCursor(self.data)


class VehiclePositionFallbackTest(unittest.TestCase):
    def setUp(self):
        csv_path = Path("tests/data/stop_times_sample.csv")
        stops = set()
        with csv_path.open() as fh:
            header = fh.readline()
            for line in fh:
                parts = line.strip().split(",")
                if len(parts) < 5:
                    continue
                stops.add(parts[3])

        data = {
            "stops": stops,
            "trips": set(),  # force trip lookup to miss DB
            "trip_routes": {},
            "routes": set(),
            "stop_times": {},  # ensure fallback needed for profiles
        }
        self.lookup = DimLookup(StubConnection(data), stop_times_csv=csv_path)
        sample_path = Path("tests/data/vehicle_positions_sample.json")
        with sample_path.open() as fh:
            payload = json.load(fh)
        message = gtfs_realtime_pb2.FeedMessage()
        ParseDict(payload, message)
        self.envelope = FeedEnvelope(
            url="https://example.com/vehicle_positions.pb",
            feed_type=FeedType.VEHICLE_POSITIONS,
            message=message,
            header_timestamp=None,
        )

    def test_previous_and_next_stop_from_csv_fallback(self):
        rows = extract_vehicle_position_rows(uuid.uuid4(), self.envelope, self.lookup)
        self.assertTrue(rows, "Expected vehicle rows to be extracted")

        target_row = None
        for row in rows:
            if row[6] == "51003":  # current_stop_id field
                target_row = row
                break

        self.assertIsNotNone(target_row, "Sample data should include stop 51003")
        # tuple layout: (..., current_stop_id, previous_stop_id, next_stop_id, next_stop_sequence, ...)
        self.assertEqual(target_row[7], "43000")
        self.assertEqual(target_row[8], "51100")
        self.assertEqual(target_row[9], 9)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
