#!/usr/bin/env python3
"""Export TMB GTFS data to GeoJSON files for frontend visualization."""
from __future__ import annotations

import argparse
import csv
import io
import json
import logging
import os
from collections import defaultdict
from pathlib import Path
from typing import Any
import zipfile

LOGGER = logging.getLogger(__name__)

# Route types in GTFS
ROUTE_TYPE_METRO = 1
ROUTE_TYPE_BUS = 3
ROUTE_TYPE_FUNICULAR = 7

# Location types in GTFS
LOCATION_TYPE_STOP = 0
LOCATION_TYPE_PARENT = 1
LOCATION_TYPE_ENTRANCE = 2


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export TMB GTFS data to GeoJSON files for frontend visualization.",
    )
    parser.add_argument(
        "--gtfs-zip",
        default="specs/006-metro-bus-integration/data/tmb-metro-gtfs.zip",
        help="Path to the TMB GTFS zip file.",
    )
    parser.add_argument(
        "--output-dir",
        default="apps/web/public/tmb_data",
        help="Output directory for GeoJSON files.",
    )
    parser.add_argument(
        "--metro-only",
        action="store_true",
        help="Only export Metro data (skip Bus routes).",
    )
    return parser.parse_args()


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


def load_routes(zf: zipfile.ZipFile) -> dict[str, dict[str, Any]]:
    """Load routes from GTFS, keyed by route_id."""
    routes = {}
    with zf.open("routes.txt") as f:
        reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))
        for row in reader:
            route_id = _clean(row.get("route_id"))
            if not route_id:
                continue
            routes[route_id] = {
                "route_id": route_id,
                "short_name": _clean(row.get("route_short_name")),
                "long_name": _clean(row.get("route_long_name")),
                "route_type": _to_int(row.get("route_type")),
                "color": _clean(row.get("route_color")),
                "text_color": _clean(row.get("route_text_color")),
            }
    return routes


def load_stops(zf: zipfile.ZipFile) -> dict[str, dict[str, Any]]:
    """Load stops from GTFS, keyed by stop_id."""
    stops = {}
    with zf.open("stops.txt") as f:
        reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))
        for row in reader:
            stop_id = _clean(row.get("stop_id"))
            if not stop_id:
                continue
            stops[stop_id] = {
                "stop_id": stop_id,
                "stop_code": _clean(row.get("stop_code")),
                "name": _clean(row.get("stop_name")),
                "lat": _to_float(row.get("stop_lat")),
                "lon": _to_float(row.get("stop_lon")),
                "location_type": _to_int(row.get("location_type")) or 0,
                "parent_station": _clean(row.get("parent_station")),
            }
    return stops


def load_trips(zf: zipfile.ZipFile) -> dict[str, dict[str, Any]]:
    """Load trips from GTFS, keyed by trip_id."""
    trips = {}
    with zf.open("trips.txt") as f:
        reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))
        for row in reader:
            trip_id = _clean(row.get("trip_id"))
            if not trip_id:
                continue
            trips[trip_id] = {
                "trip_id": trip_id,
                "route_id": _clean(row.get("route_id")),
                "shape_id": _clean(row.get("shape_id")),
                "direction_id": _to_int(row.get("direction_id")),
                "trip_headsign": _clean(row.get("trip_headsign")),
            }
    return trips


def load_shapes(zf: zipfile.ZipFile) -> dict[str, list[tuple[float, float]]]:
    """Load shapes from GTFS, keyed by shape_id."""
    shapes: dict[str, list[tuple[int, float, float]]] = defaultdict(list)
    with zf.open("shapes.txt") as f:
        reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))
        for row in reader:
            shape_id = _clean(row.get("shape_id"))
            if not shape_id:
                continue
            seq = _to_int(row.get("shape_pt_sequence"))
            lat = _to_float(row.get("shape_pt_lat"))
            lon = _to_float(row.get("shape_pt_lon"))
            if seq is not None and lat is not None and lon is not None:
                shapes[shape_id].append((seq, lon, lat))

    # Sort by sequence and extract coordinates
    result = {}
    for shape_id, points in shapes.items():
        points.sort(key=lambda x: x[0])
        result[shape_id] = [(p[1], p[2]) for p in points]
    return result


def load_stop_times(zf: zipfile.ZipFile) -> dict[str, list[str]]:
    """Load stop_times from GTFS, returning trip_id -> list of stop_ids in order."""
    stop_times: dict[str, list[tuple[int, str]]] = defaultdict(list)
    with zf.open("stop_times.txt") as f:
        reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))
        for row in reader:
            trip_id = _clean(row.get("trip_id"))
            stop_id = _clean(row.get("stop_id"))
            seq = _to_int(row.get("stop_sequence"))
            if trip_id and stop_id and seq is not None:
                stop_times[trip_id].append((seq, stop_id))

    # Sort by sequence and extract stop_ids
    result = {}
    for trip_id, stops in stop_times.items():
        stops.sort(key=lambda x: x[0])
        result[trip_id] = [s[1] for s in stops]
    return result


def get_route_stops(
    routes: dict[str, dict[str, Any]],
    trips: dict[str, dict[str, Any]],
    stop_times: dict[str, list[str]],
    stops: dict[str, dict[str, Any]],
) -> dict[str, set[str]]:
    """Map route_id -> set of stop_ids that appear on that route."""
    route_stops: dict[str, set[str]] = defaultdict(set)
    for trip in trips.values():
        route_id = trip.get("route_id")
        trip_id = trip.get("trip_id")
        if route_id and trip_id and trip_id in stop_times:
            for stop_id in stop_times[trip_id]:
                route_stops[route_id].add(stop_id)
    return route_stops


def get_route_shape(
    routes: dict[str, dict[str, Any]],
    trips: dict[str, dict[str, Any]],
    shapes: dict[str, list[tuple[float, float]]],
) -> dict[str, list[tuple[float, float]]]:
    """Map route_id -> shape coordinates (picking one representative shape per route)."""
    route_shapes: dict[str, str] = {}
    for trip in trips.values():
        route_id = trip.get("route_id")
        shape_id = trip.get("shape_id")
        if route_id and shape_id and route_id not in route_shapes:
            route_shapes[route_id] = shape_id

    result = {}
    for route_id, shape_id in route_shapes.items():
        if shape_id in shapes:
            result[route_id] = shapes[shape_id]
    return result


def create_stations_geojson(
    routes: dict[str, dict[str, Any]],
    stops: dict[str, dict[str, Any]],
    route_stops: dict[str, set[str]],
    route_type: int,
) -> dict[str, Any]:
    """Create a GeoJSON FeatureCollection for stations of a specific route type."""
    # Filter routes by type
    filtered_routes = {k: v for k, v in routes.items() if v.get("route_type") == route_type}

    # Get all stops for these routes
    stop_ids: set[str] = set()
    for route_id in filtered_routes:
        stop_ids.update(route_stops.get(route_id, set()))

    # Map stop to routes
    stop_to_routes: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for route_id, stop_set in route_stops.items():
        if route_id in filtered_routes:
            route = filtered_routes[route_id]
            for stop_id in stop_set:
                stop_to_routes[stop_id].append(route)

    features = []
    for stop_id in stop_ids:
        stop = stops.get(stop_id)
        if not stop or stop.get("lat") is None or stop.get("lon") is None:
            continue

        # Skip entrances and parent stations for station layer
        if stop.get("location_type") != LOCATION_TYPE_STOP:
            continue

        # Get routes serving this stop
        serving_routes = stop_to_routes.get(stop_id, [])
        lines = sorted(set(r["short_name"] for r in serving_routes if r.get("short_name")))
        colors = [r.get("color", "888888") for r in serving_routes if r.get("short_name")]

        # Use first line's color as primary color
        primary_color = colors[0] if colors else "888888"

        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [stop["lon"], stop["lat"]],
            },
            "properties": {
                "id": stop_id,
                "name": stop.get("name"),
                "stop_code": stop.get("stop_code"),
                "lines": lines,
                "primary_color": f"#{primary_color}",
                "colors": [f"#{c}" for c in colors],
            },
        }
        features.append(feature)

    return {
        "type": "FeatureCollection",
        "features": features,
    }


def create_lines_geojson(
    routes: dict[str, dict[str, Any]],
    route_shapes: dict[str, list[tuple[float, float]]],
    route_type: int,
) -> dict[str, dict[str, Any]]:
    """Create GeoJSON files for each line of a specific route type."""
    result = {}

    # Filter routes by type
    filtered_routes = {k: v for k, v in routes.items() if v.get("route_type") == route_type}

    for route_id, route in filtered_routes.items():
        if route_id not in route_shapes:
            continue

        coordinates = route_shapes[route_id]
        if not coordinates:
            continue

        short_name = route.get("short_name", route_id)
        color = route.get("color", "888888")

        feature_collection = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": coordinates,
                    },
                    "properties": {
                        "route_id": route_id,
                        "line_code": short_name,
                        "name": route.get("long_name"),
                        "color": f"#{color}",
                        "text_color": f"#{route.get('text_color', 'FFFFFF')}",
                    },
                }
            ],
        }
        result[short_name] = feature_collection

    return result


def create_manifest(
    metro_stations: bool,
    metro_lines: list[str],
    bus_stops: bool,
    bus_routes: list[str],
) -> dict[str, Any]:
    """Create a manifest.json for the TMB data."""
    files = []

    if metro_stations:
        files.append({
            "type": "metro_stations",
            "path": "metro/stations.geojson",
        })

    for line in metro_lines:
        files.append({
            "type": "metro_line",
            "line_code": line,
            "path": f"metro/lines/{line}.geojson",
        })

    if bus_stops:
        files.append({
            "type": "bus_stops",
            "path": "bus/stops.geojson",
        })

    for route in bus_routes:
        files.append({
            "type": "bus_route",
            "route_code": route,
            "path": f"bus/routes/{route}.geojson",
        })

    return {
        "network": "tmb",
        "generated_at": None,  # Will be filled at runtime
        "files": files,
    }


def main() -> None:
    args = parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    gtfs_path = Path(args.gtfs_zip)
    output_dir = Path(args.output_dir)

    if not gtfs_path.exists():
        raise SystemExit(f"GTFS zip not found: {gtfs_path}")

    # Create output directories
    metro_dir = output_dir / "metro"
    metro_lines_dir = metro_dir / "lines"
    bus_dir = output_dir / "bus"
    bus_routes_dir = bus_dir / "routes"

    metro_dir.mkdir(parents=True, exist_ok=True)
    metro_lines_dir.mkdir(parents=True, exist_ok=True)
    if not args.metro_only:
        bus_dir.mkdir(parents=True, exist_ok=True)
        bus_routes_dir.mkdir(parents=True, exist_ok=True)

    LOGGER.info("Loading GTFS data from %s", gtfs_path)
    with zipfile.ZipFile(gtfs_path) as zf:
        routes = load_routes(zf)
        stops = load_stops(zf)
        trips = load_trips(zf)
        shapes = load_shapes(zf)
        stop_times = load_stop_times(zf)

    LOGGER.info("Loaded %d routes, %d stops, %d trips, %d shapes",
                len(routes), len(stops), len(trips), len(shapes))

    # Compute derived data
    route_stops = get_route_stops(routes, trips, stop_times, stops)
    route_shapes = get_route_shape(routes, trips, shapes)

    # Export Metro stations
    metro_stations = create_stations_geojson(routes, stops, route_stops, ROUTE_TYPE_METRO)
    metro_stations_path = metro_dir / "stations.geojson"
    with open(metro_stations_path, "w", encoding="utf-8") as f:
        json.dump(metro_stations, f, ensure_ascii=False, indent=2)
    LOGGER.info("Exported %d Metro stations to %s", len(metro_stations["features"]), metro_stations_path)

    # Export Metro lines
    metro_lines = create_lines_geojson(routes, route_shapes, ROUTE_TYPE_METRO)
    for line_code, geojson in metro_lines.items():
        line_path = metro_lines_dir / f"{line_code}.geojson"
        with open(line_path, "w", encoding="utf-8") as f:
            json.dump(geojson, f, ensure_ascii=False, indent=2)
    LOGGER.info("Exported %d Metro lines to %s", len(metro_lines), metro_lines_dir)

    # Export Funicular as part of Metro
    funicular_stations = create_stations_geojson(routes, stops, route_stops, ROUTE_TYPE_FUNICULAR)
    funicular_lines = create_lines_geojson(routes, route_shapes, ROUTE_TYPE_FUNICULAR)

    if funicular_stations["features"]:
        funicular_path = metro_dir / "funicular_stations.geojson"
        with open(funicular_path, "w", encoding="utf-8") as f:
            json.dump(funicular_stations, f, ensure_ascii=False, indent=2)
        LOGGER.info("Exported %d Funicular stations", len(funicular_stations["features"]))

    for line_code, geojson in funicular_lines.items():
        line_path = metro_lines_dir / f"{line_code}.geojson"
        with open(line_path, "w", encoding="utf-8") as f:
            json.dump(geojson, f, ensure_ascii=False, indent=2)
    LOGGER.info("Exported %d Funicular lines", len(funicular_lines))

    bus_route_codes = []
    if not args.metro_only:
        # Export Bus stops
        bus_stops = create_stations_geojson(routes, stops, route_stops, ROUTE_TYPE_BUS)
        bus_stops_path = bus_dir / "stops.geojson"
        with open(bus_stops_path, "w", encoding="utf-8") as f:
            json.dump(bus_stops, f, ensure_ascii=False, indent=2)
        LOGGER.info("Exported %d Bus stops to %s", len(bus_stops["features"]), bus_stops_path)

        # Export Bus routes
        bus_routes = create_lines_geojson(routes, route_shapes, ROUTE_TYPE_BUS)
        for route_code, geojson in bus_routes.items():
            route_path = bus_routes_dir / f"{route_code}.geojson"
            with open(route_path, "w", encoding="utf-8") as f:
                json.dump(geojson, f, ensure_ascii=False, indent=2)
        bus_route_codes = list(bus_routes.keys())
        LOGGER.info("Exported %d Bus routes to %s", len(bus_routes), bus_routes_dir)

    # Create manifest
    all_metro_lines = list(metro_lines.keys()) + list(funicular_lines.keys())
    manifest = create_manifest(
        metro_stations=True,
        metro_lines=all_metro_lines,
        bus_stops=not args.metro_only,
        bus_routes=bus_route_codes,
    )

    from datetime import datetime, timezone
    manifest["generated_at"] = datetime.now(timezone.utc).isoformat()

    manifest_path = output_dir / "manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    LOGGER.info("Exported manifest to %s", manifest_path)

    LOGGER.info("TMB GeoJSON export complete!")


if __name__ == "__main__":
    main()
