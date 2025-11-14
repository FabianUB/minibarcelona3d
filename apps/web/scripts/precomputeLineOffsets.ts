/**
 * Pre-computation script for proximity-based line offsets
 *
 * This script analyzes railway line geometries and generates offset versions
 * where lines are close together (subway-map style). Lines only get offset
 * when they're geographically close to other lines, creating a cleaner look.
 *
 * Usage: npx tsx scripts/precomputeLineOffsets.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Types matching our application
interface LngLat {
  0: number; // longitude
  1: number; // latitude
}

interface LineStringGeometry {
  type: 'LineString';
  coordinates: LngLat[];
}

interface Feature {
  type: 'Feature';
  geometry: LineStringGeometry;
  properties: {
    id: string;
    name: string;
    brand_color?: string;
    [key: string]: unknown;
  };
}

interface FeatureCollection {
  type: 'FeatureCollection';
  features: Feature[];
}

// Configuration
const INPUT_FILE = path.join(__dirname, '../public/rodalies_data/LineGeometry.geojson');
const OUTPUT_DIR = path.join(__dirname, '../public/rodalies_data');
const ZOOM_BUCKETS = [
  { name: 'zoom-low', minZoom: 0, maxZoom: 15, offsetMultiplier: 30 }, // meters
  { name: 'zoom-high', minZoom: 15, maxZoom: 100, offsetMultiplier: 10 }, // meters
];

// Line grouping (same as LineOffsetManager)
const LINE_GROUPS = new Map<string, number>([
  ['R1', -2],
  ['R2', -1],
  ['R3', 0],
  ['R4', 1],
  ['R7', 2],
  ['R8', -1],
  ['R11', 0],
  ['R12', 1],
]);

/**
 * Calculate Haversine distance between two coordinates (in meters)
 */
function haversineDistance(coord1: LngLat, coord2: LngLat): number {
  const R = 6371000; // Earth radius in meters
  const lat1 = (coord1[1] * Math.PI) / 180;
  const lat2 = (coord2[1] * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLng = ((coord2[0] - coord1[0]) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Find the closest point on another line to a given coordinate
 */
function findClosestDistanceToLine(
  coord: LngLat,
  lineCoords: LngLat[]
): number {
  let minDistance = Infinity;

  for (const otherCoord of lineCoords) {
    const distance = haversineDistance(coord, otherCoord);
    if (distance < minDistance) {
      minDistance = distance;
    }
  }

  return minDistance;
}

/**
 * Detect if a coordinate is "close" to any other line
 * Returns true if within proximity threshold of another line
 */
function isCoordinateCloseToOtherLines(
  coord: LngLat,
  currentLineId: string,
  allLines: Map<string, LngLat[]>,
  proximityThreshold: number
): boolean {
  for (const [lineId, lineCoords] of allLines) {
    if (lineId === currentLineId) continue; // Skip self

    const distance = findClosestDistanceToLine(coord, lineCoords);
    if (distance < proximityThreshold) {
      return true; // This coordinate is close to another line
    }
  }

  return false;
}

/**
 * Calculate bearing between two points
 */
function calculateBearing(from: LngLat, to: LngLat): number {
  const [lon1, lat1] = from;
  const [lon2, lat2] = to;

  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const lat1Rad = (lat1 * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;

  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);

  const bearingRad = Math.atan2(y, x);
  const bearingDeg = (bearingRad * 180) / Math.PI;

  return (bearingDeg + 360) % 360;
}

/**
 * Offset a coordinate perpendicular to bearing
 */
function offsetCoordinate(
  coord: LngLat,
  bearing: number,
  offsetMeters: number
): LngLat {
  const [lng, lat] = coord;
  const EARTH_RADIUS = 6378137;

  const latRad = (lat * Math.PI) / 180;
  const bearingRad = (bearing * Math.PI) / 180;
  const perpBearingRad = bearingRad + Math.PI / 2;

  const angularDistance = offsetMeters / EARTH_RADIUS;

  const newLatRad = Math.asin(
    Math.sin(latRad) * Math.cos(angularDistance) +
      Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(perpBearingRad)
  );

  const newLngRad =
    (lng * Math.PI) / 180 +
    Math.atan2(
      Math.sin(perpBearingRad) * Math.sin(angularDistance) * Math.cos(latRad),
      Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(newLatRad)
    );

  return [(newLngRad * 180) / Math.PI, (newLatRad * 180) / Math.PI];
}

/**
 * Apply proximity-based offset to a line's coordinates
 */
function applyProximityBasedOffset(
  lineId: string,
  coordinates: LngLat[],
  allLines: Map<string, LngLat[]>,
  offsetMultiplier: number,
  proximityThreshold: number
): LngLat[] {
  const offsetIndex = LINE_GROUPS.get(lineId) ?? 0;
  if (offsetIndex === 0) {
    return coordinates; // Center line, no offset
  }

  const offsetCoords: LngLat[] = [];

  for (let i = 0; i < coordinates.length; i++) {
    const current = coordinates[i];

    // Check if this coordinate is close to other lines
    const isClose = isCoordinateCloseToOtherLines(
      current,
      lineId,
      allLines,
      proximityThreshold
    );

    if (!isClose) {
      // Not close to other lines, keep natural position
      offsetCoords.push(current);
      continue;
    }

    // Close to other lines, apply offset
    let bearing: number;

    if (i === 0) {
      bearing = calculateBearing(current, coordinates[i + 1]);
    } else if (i === coordinates.length - 1) {
      bearing = calculateBearing(coordinates[i - 1], current);
    } else {
      const bearingFrom = calculateBearing(coordinates[i - 1], current);
      const bearingTo = calculateBearing(current, coordinates[i + 1]);
      let diff = bearingTo - bearingFrom;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      bearing = (bearingFrom + diff / 2 + 360) % 360;
    }

    const offsetMeters = offsetMultiplier * offsetIndex;
    const offsetCoord = offsetCoordinate(current, bearing, offsetMeters);
    offsetCoords.push(offsetCoord);
  }

  return offsetCoords;
}

/**
 * Main pre-computation function
 */
async function precomputeLineOffsets() {
  console.log('🚂 Starting line offset pre-computation...\n');

  // Load input geometry
  console.log(`📖 Reading input: ${INPUT_FILE}`);
  const inputData = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8')) as FeatureCollection;
  console.log(`   Found ${inputData.features.length} lines\n`);

  // Build map of all line coordinates for proximity detection
  const allLinesMap = new Map<string, LngLat[]>();
  for (const feature of inputData.features) {
    const lineId = feature.properties.id;
    allLinesMap.set(lineId, feature.geometry.coordinates);
  }

  // Generate offset geometry for each zoom bucket
  for (const bucket of ZOOM_BUCKETS) {
    console.log(`🔧 Processing zoom bucket: ${bucket.name} (zoom ${bucket.minZoom}-${bucket.maxZoom})`);
    console.log(`   Offset multiplier: ${bucket.offsetMultiplier}m`);

    // Proximity threshold: lines are "close" if within this distance
    // Dynamic: increases with offset multiplier to handle different zoom levels
    const proximityThreshold = bucket.offsetMultiplier * 3;
    console.log(`   Proximity threshold: ${proximityThreshold}m`);

    const offsetFeatures: Feature[] = inputData.features.map((feature) => {
      const lineId = feature.properties.id;
      const originalCoords = feature.geometry.coordinates;

      const offsetCoords = applyProximityBasedOffset(
        lineId,
        originalCoords,
        allLinesMap,
        bucket.offsetMultiplier,
        proximityThreshold
      );

      return {
        ...feature,
        geometry: {
          type: 'LineString',
          coordinates: offsetCoords,
        },
      };
    });

    const outputCollection: FeatureCollection = {
      type: 'FeatureCollection',
      features: offsetFeatures,
    };

    // Save to file
    const outputFile = path.join(OUTPUT_DIR, `LineGeometry-offset-${bucket.name}.geojson`);
    fs.writeFileSync(outputFile, JSON.stringify(outputCollection, null, 2));
    console.log(`   ✅ Saved: ${outputFile}\n`);
  }

  console.log('✨ Pre-computation complete!');
  console.log('\nGenerated files:');
  for (const bucket of ZOOM_BUCKETS) {
    console.log(`  - LineGeometry-offset-${bucket.name}.geojson`);
  }
}

// Run the script
precomputeLineOffsets().catch((err) => {
  console.error('❌ Error during pre-computation:', err);
  process.exit(1);
});
