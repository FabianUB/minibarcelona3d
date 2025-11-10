#!/usr/bin/env python3
"""
Extract Rodalies de Catalunya routes from the Renfe GTFS static bundle and
export them to the map-facing data model described in the project brief.

Outputs:
    data/rodalies/
        manifest.json
        RodaliesLine.json
        LineGeometry.geojson
        LegendEntry.json
        MapViewport.json
        MapUIState.json
        Station.geojson
        lines/<line_id>.geojson
"""

from __future__ import annotations

import csv
import datetime as dt
import hashlib
import json
import os
from collections import Counter, defaultdict
from dataclasses import dataclass
from io import TextIOWrapper
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Set, Tuple
from zipfile import ZipFile

BASE_DIR = Path(__file__).resolve().parent.parent
GTFS_ZIP = BASE_DIR / "data" / "static" / "fomento_transit.zip"
OUTPUT_DIR = BASE_DIR / "data" / "rodalies"
LINES_DIR = OUTPUT_DIR / "lines"

CATALONIA_ROUTE_PREFIX = "51"
LINE_ID_PREFIX = "R"

RODALIES_LINE_FILE = OUTPUT_DIR / "RodaliesLine.json"
LINE_GEOMETRY_FILE = OUTPUT_DIR / "LineGeometry.geojson"
LEGEND_ENTRY_FILE = OUTPUT_DIR / "LegendEntry.json"
MAP_VIEWPORT_FILE = OUTPUT_DIR / "MapViewport.json"
MAP_UI_STATE_FILE = OUTPUT_DIR / "MapUIState.json"
STATION_FILE = OUTPUT_DIR / "Station.geojson"

DEFAULT_ORDER = [
    "R1",
    "R2",
    "R2N",
    "R2S",
    "R3",
    "R3a",
    "R4",
    "R7",
    "R8",
    "RG1",
    "RL3",
    "RL4",
    "RT2",
    "R11",
    "R14",
    "R15",
    "R16",
    "R17",
]


@dataclass
class LineMeta:
    line_id: str
    name: str
    short_code: str
    brand_color: str
    default_pattern: str
    high_contrast_pattern: str
    order: int
    route_ids: Sequence[str]


@dataclass
class LineGeometry:
    line_id: str
    coordinates: List[List[Tuple[float, float]]]
    bbox: Tuple[float, float, float, float]
    last_verified_at: str


@dataclass
class StationRecord:
    station_id: str
    name: str
    code: str
    latitude: float
    longitude: float
    lines: List[str]


def _dict_reader(fh):
    reader = csv.DictReader(TextIOWrapper(fh, "utf-8-sig"))
    reader.fieldnames = [name.strip() for name in reader.fieldnames or []]
    for row in reader:
        yield {k.strip(): v for k, v in row.items()}


def read_routes(zip_file: ZipFile) -> Dict[str, Dict[str, List[dict]]]:
    routes_by_line: Dict[str, Dict[str, List[dict]]] = defaultdict(
        lambda: {"rows": [], "route_ids": []}
    )

    with zip_file.open("routes.txt") as fh:
        for row in _dict_reader(fh):
            route_id = row["route_id"].strip()
            if not route_id.startswith(CATALONIA_ROUTE_PREFIX):
                continue

            short_name = row["route_short_name"].strip()
            if not short_name.startswith(LINE_ID_PREFIX):
                continue

            routes_by_line[short_name]["rows"].append(row)
            routes_by_line[short_name]["route_ids"].append(route_id)

    return routes_by_line


def select_name(names: Iterable[str]) -> str:
    options = [
        " ".join(name.split())
        for name in names
        if name and name != "-" and name.strip()
    ]
    if not options:
        return ""

    # Prefer names that include a dash separator, then the longest entry.
    options.sort(key=lambda n: ((" - " not in n), -len(n)))
    selected = options[0]
    if " -" in selected or "- " in selected:
        selected = selected.replace(" -", " - ").replace("- ", " - ")
        selected = " ".join(selected.split())
    return selected


def select_brand_color(colors: Iterable[str]) -> str:
    color_list = [c.upper() for c in colors if c]
    if not color_list:
        return "000000"
    most_common = Counter(color_list).most_common(1)
    return most_common[0][0]


def build_line_meta(routes_by_line: Dict[str, Dict[str, List[dict]]]) -> Dict[str, LineMeta]:
    metas: Dict[str, LineMeta] = {}

    for short_code, payload in routes_by_line.items():
        rows = payload["rows"]
        if not rows:
            continue

        name = select_name(row["route_long_name"] for row in rows)
        brand_color = select_brand_color(row["route_color"] for row in rows)

        order = DEFAULT_ORDER.index(short_code) if short_code in DEFAULT_ORDER else len(DEFAULT_ORDER)

        metas[short_code] = LineMeta(
            line_id=short_code,
            name=name or short_code,
            short_code=short_code,
            brand_color=brand_color,
            default_pattern=f"solid-{short_code.lower()}",
            high_contrast_pattern=f"hatched-{short_code.lower()}",
            order=order,
            route_ids=sorted(set(payload["route_ids"])),
        )

    # Ensure unlisted lines are appended in deterministic order
    next_order = len(DEFAULT_ORDER)
    for short_code in sorted(metas):
        if short_code not in DEFAULT_ORDER:
            metas[short_code].order = next_order
            next_order += 1

    return metas


def read_trip_shapes(zip_file: ZipFile, meta_by_line: Dict[str, LineMeta]) -> Dict[str, set]:
    route_to_line = {}
    for meta in meta_by_line.values():
        for route_id in meta.route_ids:
            route_to_line[route_id] = meta.line_id

    shape_ids_for_line: Dict[str, set] = defaultdict(set)

    with zip_file.open("trips.txt") as fh:
        for row in _dict_reader(fh):
            route_id = row.get("route_id", "").strip()
            if route_id not in route_to_line:
                continue
            shape_id = row.get("shape_id", "").strip()
            if not shape_id:
                continue
            shape_ids_for_line[route_to_line[route_id]].add(shape_id)

    return shape_ids_for_line


def read_shapes(
    zip_file: ZipFile, shape_ids: set
) -> Dict[str, List[Tuple[int, float, float]]]:
    shapes: Dict[str, List[Tuple[int, float, float]]] = defaultdict(list)
    with zip_file.open("shapes.txt") as fh:
        for row in _dict_reader(fh):
            sid = row.get("shape_id", "").strip()
            if sid not in shape_ids:
                continue
            seq = int(row["shape_pt_sequence"])
            lat = float(row["shape_pt_lat"])
            lon = float(row["shape_pt_lon"])
            shapes[sid].append((seq, lon, lat))
    for sid, points in shapes.items():
        points.sort()
    return shapes


def collect_line_stop_data(
    zip_file: ZipFile, meta_by_line: Dict[str, LineMeta]
) -> Tuple[Dict[str, Set[str]], Dict[str, List[Tuple[int, str]]]]:
    route_to_line = {}
    for meta in meta_by_line.values():
        for route_id in meta.route_ids:
            route_to_line[route_id] = meta.line_id

    trip_to_line: Dict[str, str] = {}
    with zip_file.open("trips.txt") as fh:
        for row in _dict_reader(fh):
            route_id = row.get("route_id", "").strip()
            if route_id not in route_to_line:
                continue
            trip_to_line[row["trip_id"].strip()] = route_to_line[route_id]

    stop_to_lines: Dict[str, Set[str]] = defaultdict(set)
    sample_sequences: Dict[str, List[Tuple[int, str]]] = defaultdict(list)
    representative_trip: Dict[str, str] = {}
    with zip_file.open("stop_times.txt") as fh:
        for row in _dict_reader(fh):
            trip_id = row.get("trip_id", "").strip()
            line_id = trip_to_line.get(trip_id)
            if not line_id:
                continue
            stop_id = row.get("stop_id", "").strip()
            if not stop_id:
                continue
            stop_to_lines[stop_id].add(line_id)
            if line_id not in representative_trip:
                representative_trip[line_id] = trip_id
            if trip_id == representative_trip[line_id]:
                try:
                    sequence = int(row.get("stop_sequence", "").strip())
                except ValueError:
                    continue
                sample_sequences[line_id].append((sequence, stop_id))

    for line_id in sample_sequences:
        sample_sequences[line_id].sort()

    return stop_to_lines, sample_sequences


def read_station_details(
    zip_file: ZipFile, stop_ids: Set[str]
) -> Dict[str, Dict[str, object]]:
    stations: Dict[str, Dict[str, object]] = {}
    if not stop_ids:
        return stations
    with zip_file.open("stops.txt") as fh:
        for row in _dict_reader(fh):
            stop_id = row.get("stop_id", "").strip()
            if stop_id not in stop_ids:
                continue
            stations[stop_id] = {
                "name": row.get("stop_name", "").strip(),
                "code": row.get("stop_code", "").strip(),
                "lat": float(row["stop_lat"]),
                "lon": float(row["stop_lon"]),
            }
    return stations


def build_station_records(
    station_details: Dict[str, Dict[str, object]],
    stop_to_lines: Dict[str, Set[str]],
) -> List[StationRecord]:
    stations: List[StationRecord] = []
    for stop_id, details in station_details.items():
        lines = sorted(stop_to_lines.get(stop_id, []))
        stations.append(
            StationRecord(
                station_id=stop_id,
                name=details.get("name") or stop_id,
                code=details.get("code") or "",
                latitude=details["lat"],
                longitude=details["lon"],
                lines=lines,
            )
        )
    stations.sort(key=lambda s: (s.name, s.station_id))
    return stations


def build_line_geometries(
    meta_by_line: Dict[str, LineMeta],
    shapes_by_id: Dict[str, List[Tuple[int, float, float]]],
    shape_ids_for_line: Dict[str, set],
    sample_sequences: Dict[str, List[Tuple[int, str]]],
    station_details: Dict[str, Dict[str, object]],
    verified_at: str,
) -> Dict[str, LineGeometry]:
    geometries: Dict[str, LineGeometry] = {}
    for line_id, meta in meta_by_line.items():
        coords: List[List[Tuple[float, float]]] = []
        min_lon = min_lat = float("inf")
        max_lon = max_lat = float("-inf")

        for shape_id in sorted(shape_ids_for_line.get(line_id, [])):
            points = shapes_by_id.get(shape_id)
            if not points or len(points) < 2:
                continue
            line_coords = [(lon, lat) for _, lon, lat in points]
            coords.append(line_coords)
            for lon, lat in line_coords:
                if lon < min_lon:
                    min_lon = lon
                if lon > max_lon:
                    max_lon = lon
                if lat < min_lat:
                    min_lat = lat
                if lat > max_lat:
                    max_lat = lat

        if not coords:
            continue

        bbox = (min_lon, min_lat, max_lon, max_lat)
        geometries[line_id] = LineGeometry(
            line_id=line_id,
            coordinates=coords,
            bbox=bbox,
            last_verified_at=verified_at,
        )

    # Fallback: derive polylines from stop sequences where shapes are missing.
    for line_id, seq in sample_sequences.items():
        if line_id in geometries:
            continue
        ordered = []
        for _, stop_id in seq:
            details = station_details.get(stop_id)
            if not details:
                continue
            ordered.append((details["lon"], details["lat"]))
        if len(ordered) < 2:
            continue
        min_lon = min(lon for lon, _ in ordered)
        max_lon = max(lon for lon, _ in ordered)
        min_lat = min(lat for _, lat in ordered)
        max_lat = max(lat for _, lat in ordered)
        geometries[line_id] = LineGeometry(
            line_id=line_id,
            coordinates=[ordered],
            bbox=(min_lon, min_lat, max_lon, max_lat),
            last_verified_at=verified_at,
        )

    return geometries


def ensure_directories() -> None:
    LINES_DIR.mkdir(parents=True, exist_ok=True)


def write_geojson_feature(path: Path, geometry: LineGeometry, meta: LineMeta) -> None:
    feature = {
        "type": "Feature",
        "id": meta.line_id,
        "properties": {
            "id": meta.line_id,
            "name": meta.name,
            "short_code": meta.short_code,
            "brand_color": meta.brand_color,
            "default_pattern": meta.default_pattern,
            "high_contrast_pattern": meta.high_contrast_pattern,
            "order": meta.order,
            "last_verified_at": geometry.last_verified_at,
        },
        "geometry": {
            "type": "MultiLineString" if len(geometry.coordinates) > 1 else "LineString",
            "coordinates": geometry.coordinates
            if len(geometry.coordinates) > 1
            else geometry.coordinates[0],
        },
    }
    with path.open("w", encoding="utf-8") as fh:
        json.dump(feature, fh, ensure_ascii=False, indent=2)


def write_master_geojson(path: Path, geometries: Dict[str, LineGeometry], meta_by_line: Dict[str, LineMeta]) -> None:
    features = []
    for line_id, geom in sorted(geometries.items(), key=lambda item: meta_by_line[item[0]].order):
        meta = meta_by_line[line_id]
        geom_type = "MultiLineString" if len(geom.coordinates) > 1 else "LineString"
        coords = geom.coordinates if geom_type == "MultiLineString" else geom.coordinates[0]
        features.append(
            {
                "type": "Feature",
                "id": line_id,
                "properties": {
                    "id": line_id,
                    "name": meta.name,
                    "short_code": meta.short_code,
                    "brand_color": meta.brand_color,
                    "default_pattern": meta.default_pattern,
                    "high_contrast_pattern": meta.high_contrast_pattern,
                    "order": meta.order,
                    "bbox": geom.bbox,
                    "last_verified_at": geom.last_verified_at,
                },
                "geometry": {"type": geom_type, "coordinates": coords},
            }
        )

    feature_collection = {"type": "FeatureCollection", "features": features}
    with path.open("w", encoding="utf-8") as fh:
        json.dump(feature_collection, fh, ensure_ascii=False, indent=2)


def compute_viewport(geometries: Dict[str, LineGeometry]) -> Dict[str, object]:
    min_lon = min_lat = float("inf")
    max_lon = max_lat = float("-inf")

    for geom in geometries.values():
        lon0, lat0, lon1, lat1 = geom.bbox
        min_lon = min(min_lon, lon0)
        min_lat = min(min_lat, lat0)
        max_lon = max(max_lon, lon1)
        max_lat = max(max_lat, lat1)

    center = {
        "lat": round((min_lat + max_lat) / 2, 6),
        "lng": round((min_lon + max_lon) / 2, 6),
    }

    # Conservative defaults to contain the full network
    max_bounds = [
        [round(min_lon - 0.2, 6), round(min_lat - 0.2, 6)],
        [round(max_lon + 0.2, 6), round(max_lat + 0.2, 6)],
    ]

    padding = {"top": 48, "right": 24, "bottom": 48, "left": 24}

    return {
        "center": center,
        "zoom": 8.2,
        "max_bounds": max_bounds,
        "padding": padding,
    }


def write_stations_geojson(path: Path, stations: Sequence[StationRecord]) -> None:
    features = []
    for station in stations:
        features.append(
            {
                "type": "Feature",
                "id": station.station_id,
                "properties": {
                    "id": station.station_id,
                    "name": station.name,
                    "code": station.code or None,
                    "lines": station.lines,
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [station.longitude, station.latitude],
                },
            }
        )

    with path.open("w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "features": features}, fh, ensure_ascii=False, indent=2)


def write_manifest(
    path: Path,
    geometries: Dict[str, LineGeometry],
    meta_by_line: Dict[str, LineMeta],
    stations_geojson: Path,
    viewport: Dict[str, object],
) -> None:
    lines_manifest = []
    for line_id, geom in sorted(geometries.items(), key=lambda item: meta_by_line[item[0]].order):
        rel_path = Path("lines") / f"{line_id}.geojson"
        abs_path = OUTPUT_DIR / rel_path
        digest = hashlib.sha256(abs_path.read_bytes()).hexdigest()
        lines_manifest.append(
            {
                "id": line_id,
                "checksum": digest,
                "path": str(rel_path).replace(os.sep, "/"),
            }
        )

    stations_entry = None
    if stations_geojson.exists():
        stations_entry = {
            "path": stations_geojson.relative_to(OUTPUT_DIR).as_posix(),
            "checksum": hashlib.sha256(stations_geojson.read_bytes()).hexdigest(),
        }

    payload = {
        "lines": lines_manifest,
        "stations": stations_entry,
        "viewport": viewport,
        "updated_at": dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "rodalies_lines_path": RODALIES_LINE_FILE.relative_to(OUTPUT_DIR).as_posix(),
        "legend_entries_path": LEGEND_ENTRY_FILE.relative_to(OUTPUT_DIR).as_posix(),
        "line_geometries_path": LINE_GEOMETRY_FILE.relative_to(OUTPUT_DIR).as_posix(),
        "map_viewport_path": MAP_VIEWPORT_FILE.relative_to(OUTPUT_DIR).as_posix(),
        "map_ui_state_path": MAP_UI_STATE_FILE.relative_to(OUTPUT_DIR).as_posix(),
    }

    with path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)


def write_rodalies_lines(path: Path, meta_by_line: Dict[str, LineMeta]) -> List[dict]:
    lines_payload = []
    for _, meta in sorted(meta_by_line.items(), key=lambda item: item[1].order):
        lines_payload.append(
            {
                "id": meta.line_id,
                "name": meta.name,
                "short_code": meta.short_code,
                "brand_color": meta.brand_color,
                "default_pattern": meta.default_pattern,
                "high_contrast_pattern": meta.high_contrast_pattern,
                "order": meta.order,
            }
        )
    with path.open("w", encoding="utf-8") as fh:
        json.dump(lines_payload, fh, ensure_ascii=False, indent=2)
    return lines_payload


def write_line_geometries(path: Path, geometries: Dict[str, LineGeometry], meta_by_line: Dict[str, LineMeta]) -> None:
    write_master_geojson(path, geometries, meta_by_line)


def write_legend_entries(path: Path, lines_payload: Sequence[dict]) -> None:
    legend_entries = []
    for line in lines_payload:
        label = f"{line['short_code']} - {line['name']}"
        legend_entries.append(
            {
                "line_id": line["id"],
                "label": label,
                "theme_tokens": {
                    "standard": line["default_pattern"],
                    "high_contrast": line["high_contrast_pattern"],
                },
                "is_highlighted": False,
            }
        )
    with path.open("w", encoding="utf-8") as fh:
        json.dump(legend_entries, fh, ensure_ascii=False, indent=2)


def write_map_viewport(path: Path, viewport: Dict[str, object]) -> None:
    with path.open("w", encoding="utf-8") as fh:
        json.dump(viewport, fh, ensure_ascii=False, indent=2)


def write_map_ui_state(path: Path) -> None:
    map_ui_state = {
        "selectedLineId": None,
        "isHighContrast": False,
        "isLegendOpen": False,
    }
    with path.open("w", encoding="utf-8") as fh:
        json.dump(map_ui_state, fh, ensure_ascii=False, indent=2)


def main() -> None:
    if not GTFS_ZIP.exists():
        raise SystemExit(f"Missing GTFS bundle at {GTFS_ZIP}")

    ensure_directories()

    legacy_files = [
        OUTPUT_DIR / "rodalies-map.json",
        OUTPUT_DIR / "rodalies-lines.geojson",
        OUTPUT_DIR / "rodalies-stations.geojson",
    ]
    for legacy in legacy_files:
        if legacy.exists():
            legacy.unlink()

    with ZipFile(GTFS_ZIP) as zip_file:
        routes_by_line = read_routes(zip_file)
        meta_by_line = build_line_meta(routes_by_line)

        verified_at = dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"

        shape_ids_for_line = read_trip_shapes(zip_file, meta_by_line)
        all_shape_ids = (
            set().union(*shape_ids_for_line.values()) if shape_ids_for_line else set()
        )
        shapes_by_id = read_shapes(zip_file, all_shape_ids)
        stop_to_lines, sample_sequences = collect_line_stop_data(zip_file, meta_by_line)
        all_stop_ids = set(stop_to_lines.keys())
        station_details = read_station_details(zip_file, all_stop_ids)
        stations = build_station_records(station_details, stop_to_lines)

        geometries = build_line_geometries(
            meta_by_line,
            shapes_by_id,
            shape_ids_for_line,
            sample_sequences,
            station_details,
            verified_at,
        )

    if not geometries:
        raise SystemExit("No Rodalies geometries were produced.")

    output_meta = {line_id: meta_by_line[line_id] for line_id in geometries}

    for line_id in sorted(geometries, key=lambda lid: output_meta[lid].order):
        geom = geometries[line_id]
        write_geojson_feature(LINES_DIR / f"{line_id}.geojson", geom, output_meta[line_id])

    write_line_geometries(LINE_GEOMETRY_FILE, geometries, output_meta)

    viewport = compute_viewport(geometries)

    write_map_viewport(MAP_VIEWPORT_FILE, viewport)

    write_map_ui_state(MAP_UI_STATE_FILE)

    stations_geojson_path = STATION_FILE
    write_stations_geojson(stations_geojson_path, stations)

    lines_payload = write_rodalies_lines(RODALIES_LINE_FILE, output_meta)
    write_legend_entries(LEGEND_ENTRY_FILE, lines_payload)

    write_manifest(OUTPUT_DIR / "manifest.json", geometries, output_meta, stations_geojson_path, viewport)

    print(f"Wrote Rodalies assets to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
