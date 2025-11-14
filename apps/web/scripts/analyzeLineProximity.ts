/**
 * Proximity analysis script for railway line geometries
 *
 * This script analyzes LineGeometry.geojson to detect where multiple lines
 * run close together (within a threshold distance). It outputs a configuration
 * file that specifies which line segments should be rendered with offsets.
 *
 * Output format:
 * {
 *   "segments": [
 *     {
 *       "lines": ["R1", "R2", "R3"],  // Lines that overlap in this segment
 *       "coordinateRanges": {
 *         "R1": { start: 10, end: 25 }, // Coordinate indices for each line
 *         "R2": { start: 5, end: 18 },
 *         "R3": { start: 12, end: 30 }
 *       },
 *       "center": [2.1234, 41.3851],   // Approximate center of segment
 *       "offsetPattern": [-2, 0, 2]     // Pixel offsets for each line
 *     }
 *   ]
 * }
 *
 * Usage: npx tsx scripts/analyzeLineProximity.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const INPUT_FILE = path.join(__dirname, '../public/rodalies_data/LineGeometry.geojson');
const OUTPUT_FILE = path.join(__dirname, '../public/rodalies_data/LineProximity.json');
const PROXIMITY_THRESHOLD_METERS = 100; // Lines within 100m are considered "close"
const MIN_SEGMENT_LENGTH = 3; // Minimum number of consecutive close coordinates

// Types
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

interface ProximitySegment {
  lines: string[]; // Line IDs that overlap
  coordinateRanges: Record<string, { start: number; end: number }>; // Coordinate indices
  center: LngLat; // Approximate center
  offsetPattern: number[]; // Pixel offsets for each line
}

interface ProximityConfig {
  threshold: number; // Distance threshold used
  minSegmentLength: number; // Minimum segment length used
  generatedAt: string; // ISO timestamp
  segments: ProximitySegment[];
}

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
 * Find the minimum distance from a coordinate to any point on a line
 */
function minDistanceToLine(coord: LngLat, lineCoords: LngLat[]): number {
  let minDist = Infinity;

  for (const lineCoord of lineCoords) {
    const dist = haversineDistance(coord, lineCoord);
    if (dist < minDist) {
      minDist = dist;
    }
  }

  return minDist;
}

/**
 * Check which other lines are close to a specific coordinate
 */
function findCloseLinesAt(
  coord: LngLat,
  currentLineId: string,
  allLines: Map<string, LngLat[]>,
  threshold: number
): string[] {
  const closeLines: string[] = [];

  for (const [lineId, lineCoords] of allLines) {
    if (lineId === currentLineId) continue;

    const distance = minDistanceToLine(coord, lineCoords);
    if (distance < threshold) {
      closeLines.push(lineId);
    }
  }

  return closeLines;
}

/**
 * Find coordinate ranges for a line that are close to other specific lines
 */
function findCoordinateRanges(
  lineId: string,
  targetLines: string[],
  lineCoords: LngLat[],
  allLines: Map<string, LngLat[]>,
  threshold: number
): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let currentRange: { start: number; end: number } | null = null;

  for (let i = 0; i < lineCoords.length; i++) {
    const coord = lineCoords[i];
    const closeLines = findCloseLinesAt(coord, lineId, allLines, threshold);

    // Check if this coordinate is close to at least one of the target lines
    const isCloseToTarget = targetLines.some(targetId => closeLines.includes(targetId));

    if (isCloseToTarget) {
      if (currentRange === null) {
        // Start new range
        currentRange = { start: i, end: i };
      } else {
        // Extend current range
        currentRange.end = i;
      }
    } else {
      if (currentRange !== null) {
        // End current range
        ranges.push(currentRange);
        currentRange = null;
      }
    }
  }

  // Close final range if needed
  if (currentRange !== null) {
    ranges.push(currentRange);
  }

  return ranges;
}

/**
 * Calculate center coordinate from a set of coordinates
 */
function calculateCenter(coords: LngLat[]): LngLat {
  if (coords.length === 0) return [0, 0];

  const sum = coords.reduce(
    (acc, coord) => {
      acc[0] += coord[0];
      acc[1] += coord[1];
      return acc;
    },
    [0, 0] as [number, number]
  );

  return [sum[0] / coords.length, sum[1] / coords.length];
}

/**
 * Generate balanced offset pattern for N lines
 * Examples:
 *   2 lines: [-1.5, 1.5]
 *   3 lines: [-2.5, 0, 2.5]
 *   4 lines: [-3, -1, 1, 3]
 *   5 lines: [-4, -2, 0, 2, 4]
 */
function generateOffsetPattern(lineCount: number): number[] {
  if (lineCount === 1) return [0];

  const offsets: number[] = [];
  const isEven = lineCount % 2 === 0;

  if (isEven) {
    // Even: symmetric around 0 without a center line
    const halfCount = lineCount / 2;
    for (let i = 0; i < lineCount; i++) {
      const offset = (i - halfCount + 0.5) * 2;
      offsets.push(offset);
    }
  } else {
    // Odd: symmetric around 0 with center line at 0
    const halfCount = Math.floor(lineCount / 2);
    for (let i = 0; i < lineCount; i++) {
      const offset = (i - halfCount) * 2.5;
      offsets.push(offset);
    }
  }

  return offsets;
}

/**
 * Merge overlapping coordinate ranges for a single line
 */
function mergeRanges(ranges: { start: number; end: number }[]): { start: number; end: number }[] {
  if (ranges.length === 0) return [];

  // Sort by start index
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];

    if (current.start <= last.end + 1) {
      // Overlapping or adjacent, merge
      last.end = Math.max(last.end, current.end);
    } else {
      // Non-overlapping, add new range
      merged.push(current);
    }
  }

  return merged;
}

/**
 * Main analysis function
 */
async function analyzeLineProximity() {
  console.log('🔍 Analyzing railway line proximity...\n');

  // Load line geometry
  console.log(`📖 Reading: ${INPUT_FILE}`);
  const data = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8')) as FeatureCollection;
  console.log(`   Found ${data.features.length} lines\n`);

  // Build map of all line coordinates
  const allLines = new Map<string, LngLat[]>();
  for (const feature of data.features) {
    allLines.set(feature.properties.id, feature.geometry.coordinates);
  }

  // Find all unique groups of lines that are close together
  const proximityGroups = new Map<string, Set<string>>(); // Key: sorted line IDs, Value: set of lines

  console.log('🔍 Detecting proximity groups...');
  for (const [lineId, lineCoords] of allLines) {
    for (const coord of lineCoords) {
      const closeLines = findCloseLinesAt(coord, lineId, allLines, PROXIMITY_THRESHOLD_METERS);

      if (closeLines.length > 0) {
        // Create a group with current line + close lines
        const group = [lineId, ...closeLines].sort();
        const groupKey = group.join(',');

        if (!proximityGroups.has(groupKey)) {
          proximityGroups.set(groupKey, new Set(group));
        }
      }
    }
  }

  console.log(`   Found ${proximityGroups.size} proximity groups\n`);

  // For each group, find the coordinate ranges
  const segments: ProximitySegment[] = [];

  for (const [, lineSet] of proximityGroups) {
    const lines = Array.from(lineSet).sort();
    console.log(`📍 Processing group: ${lines.join(', ')}`);

    // For each line in the group, find ranges where it's close to other lines in the group
    const coordinateRanges: Record<string, { start: number; end: number }[]> = {};

    for (const lineId of lines) {
      const lineCoords = allLines.get(lineId)!;
      const otherLines = lines.filter(id => id !== lineId);

      const ranges = findCoordinateRanges(
        lineId,
        otherLines,
        lineCoords,
        allLines,
        PROXIMITY_THRESHOLD_METERS
      );

      coordinateRanges[lineId] = mergeRanges(ranges);
    }

    // Filter out ranges that are too short
    const filteredRanges: Record<string, { start: number; end: number }[]> = {};
    for (const [lineId, ranges] of Object.entries(coordinateRanges)) {
      const longRanges = ranges.filter(
        range => range.end - range.start + 1 >= MIN_SEGMENT_LENGTH
      );
      if (longRanges.length > 0) {
        filteredRanges[lineId] = longRanges;
      }
    }

    // Skip groups with no significant overlaps
    if (Object.keys(filteredRanges).length < 2) {
      console.log(`   ⏭️  Skipped (insufficient overlap)\n`);
      continue;
    }

    // For simplicity, take the first range of each line and create a segment
    // In reality, lines might overlap in multiple disconnected sections
    for (let rangeIndex = 0; rangeIndex < 10; rangeIndex++) {
      const segmentRanges: Record<string, { start: number; end: number }> = {};
      const segmentLines: string[] = [];

      for (const lineId of lines) {
        const ranges = filteredRanges[lineId];
        if (ranges && ranges[rangeIndex]) {
          segmentRanges[lineId] = ranges[rangeIndex];
          segmentLines.push(lineId);
        }
      }

      if (segmentLines.length < 2) break; // No more overlapping segments

      // Calculate approximate center
      const allCoords: LngLat[] = [];
      for (const lineId of segmentLines) {
        const lineCoords = allLines.get(lineId)!;
        const range = segmentRanges[lineId];
        const segmentCoords = lineCoords.slice(range.start, range.end + 1);
        allCoords.push(...segmentCoords);
      }
      const center = calculateCenter(allCoords);

      // Generate offset pattern
      const offsetPattern = generateOffsetPattern(segmentLines.length);

      segments.push({
        lines: segmentLines,
        coordinateRanges: segmentRanges,
        center,
        offsetPattern,
      });

      console.log(`   ✅ Segment ${rangeIndex + 1}: ${segmentLines.join(', ')}`);
      console.log(`      Offsets: ${offsetPattern.join(', ')}`);
    }

    console.log();
  }

  // Generate output
  const config: ProximityConfig = {
    threshold: PROXIMITY_THRESHOLD_METERS,
    minSegmentLength: MIN_SEGMENT_LENGTH,
    generatedAt: new Date().toISOString(),
    segments,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(config, null, 2));
  console.log(`✅ Saved: ${OUTPUT_FILE}`);
  console.log(`   Total segments: ${segments.length}`);
  console.log('\n✨ Analysis complete!');
}

// Run the script
analyzeLineProximity().catch((err) => {
  console.error('❌ Error during analysis:', err);
  process.exit(1);
});
