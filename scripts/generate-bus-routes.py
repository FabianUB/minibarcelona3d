#!/usr/bin/env python3
"""
Generate bus route GeoJSON files from GTFS shapes.txt

This script:
1. Reads GTFS routes.txt to get route_id → route_short_name mapping
2. Reads GTFS trips.txt to get route_id → shape_id mapping
3. Reads GTFS shapes.txt to build route geometries
4. Outputs individual GeoJSON files for each bus route
"""

import csv
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

def read_csv(filepath):
    """Read a CSV file and return list of dicts"""
    with open(filepath, 'r', encoding='utf-8-sig') as f:
        return list(csv.DictReader(f))

def main():
    if len(sys.argv) < 3:
        print("Usage: python generate-bus-routes.py <gtfs_dir> <output_dir>")
        sys.exit(1)

    gtfs_dir = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Reading GTFS from: {gtfs_dir}")
    print(f"Output directory: {output_dir}")

    # 1. Read routes.txt - get bus routes (route_type=3)
    routes_data = read_csv(gtfs_dir / 'routes.txt')
    bus_routes = {}
    for route in routes_data:
        if route.get('route_type') == '3':  # Bus
            route_id = route['route_id']
            bus_routes[route_id] = {
                'route_id': route_id,
                'route_short_name': route.get('route_short_name', ''),
                'route_long_name': route.get('route_long_name', ''),
                'route_color': route.get('route_color', 'FF0000'),
                'route_text_color': route.get('route_text_color', 'FFFFFF'),
            }
    print(f"Found {len(bus_routes)} bus routes")

    # 2. Read trips.txt - get shape_id for each route
    trips_data = read_csv(gtfs_dir / 'trips.txt')
    route_shapes = defaultdict(set)
    for trip in trips_data:
        route_id = trip.get('route_id')
        shape_id = trip.get('shape_id')
        if route_id in bus_routes and shape_id:
            route_shapes[route_id].add(shape_id)

    print(f"Found shapes for {len(route_shapes)} routes")

    # 3. Read shapes.txt - build coordinate arrays
    print("Reading shapes.txt...")
    shapes_data = read_csv(gtfs_dir / 'shapes.txt')

    # Group by shape_id
    shape_points = defaultdict(list)
    for point in shapes_data:
        shape_id = point['shape_id']
        try:
            lat = float(point['shape_pt_lat'])
            lon = float(point['shape_pt_lon'])
            seq = int(point['shape_pt_sequence'])
            shape_points[shape_id].append((seq, lon, lat))
        except (ValueError, KeyError) as e:
            continue

    print(f"Loaded {len(shape_points)} shapes")

    # Sort points by sequence
    for shape_id in shape_points:
        shape_points[shape_id].sort(key=lambda x: x[0])

    # 4. Generate GeoJSON for each bus route
    generated = 0
    for route_id, route_info in bus_routes.items():
        if route_id not in route_shapes:
            continue

        # Get all shapes for this route and merge coordinates
        all_coords = []
        for shape_id in route_shapes[route_id]:
            if shape_id in shape_points:
                coords = [[pt[1], pt[2]] for pt in shape_points[shape_id]]
                if coords:
                    all_coords.extend(coords)
                    break  # Use first shape found

        if not all_coords:
            continue

        # Create GeoJSON FeatureCollection
        geojson = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "properties": {
                    "route_id": route_info['route_id'],
                    "line_code": route_info['route_short_name'],
                    "name": route_info['route_long_name'],
                    "color": f"#{route_info['route_color']}",
                    "text_color": f"#{route_info['route_text_color']}"
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": all_coords
                }
            }]
        }

        # Write to file
        short_name = route_info['route_short_name']
        if not short_name:
            continue

        output_file = output_dir / f"{short_name}.geojson"
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(geojson, f, indent=2)

        generated += 1

    print(f"Generated {generated} route GeoJSON files")

    # 5. Update manifest
    print("\nUpdating manifest...")
    manifest_path = output_dir.parent / 'manifest.json'
    if manifest_path.exists():
        with open(manifest_path, 'r') as f:
            manifest = json.load(f)
    else:
        manifest = {'files': []}

    # Remove old bus_route entries
    manifest['files'] = [f for f in manifest['files'] if f.get('type') != 'bus_route']

    # Add new entries
    for route_id, route_info in bus_routes.items():
        short_name = route_info['route_short_name']
        if not short_name:
            continue
        geojson_path = output_dir / f"{short_name}.geojson"
        if geojson_path.exists():
            manifest['files'].append({
                'type': 'bus_route',
                'path': f"bus/routes/{short_name}.geojson",
                'route_code': short_name,
                'route_id': route_id,
                'name': route_info['route_long_name'],
                'color': f"#{route_info['route_color']}"
            })

    # Sort by route_code
    manifest['files'].sort(key=lambda x: (x.get('type', ''), x.get('route_code', '')))

    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)

    print(f"Updated manifest with {len([f for f in manifest['files'] if f.get('type') == 'bus_route'])} bus routes")
    print("Done!")

if __name__ == '__main__':
    main()
