/**
 * Station Marker Positioning Utilities
 * Feature: 004-station-visualization
 *
 * Provides radial offset positioning for overlapping station markers.
 * Uses polar coordinates to distribute stations evenly around their
 * geographic center when they would overlap on screen.
 */

import type { Station } from '../../types/rodalies';
import type { Map as MapboxMap } from 'mapbox-gl';

export interface StationOffset {
  stationId: string;
  offsetX: number; // Pixels east (+) or west (-)
  offsetY: number; // Pixels south (+) or north (-)
}

interface ProjectedStation {
  station: Station;
  point: { x: number; y: number };
}

// Overlap detection threshold (pixels)
const OVERLAP_THRESHOLD_PX = 20;

// Base radius for radial offset (pixels)
const OFFSET_RADIUS_BASE = 10;

/**
 * Calculate radial offsets for overlapping station markers
 *
 * Algorithm:
 * 1. Project all station coordinates to screen pixels
 * 2. Detect overlapping stations (< 20px separation)
 * 3. Group overlapping stations by proximity
 * 4. Compute radial offsets for each group using polar coordinates
 * 5. Return offsets in pixels
 *
 * @param stations - Array of stations to position
 * @param map - Mapbox GL map instance (for pixel projection)
 * @returns Array of station offsets
 *
 * Acceptance Criteria:
 * - FR-012: Prevent overlapping via radial offset
 * - SC-007: Zero overlap at any zoom level
 *
 * Tasks: T011
 */
export function calculateRadialOffsets(
  stations: Station[],
  map: MapboxMap
): StationOffset[] {
  // 1. Project all stations to screen pixels
  const projected: ProjectedStation[] = stations.map(s => ({
    station: s,
    point: map.project(s.geometry.coordinates as [number, number]),
  }));

  // 2. Detect overlapping groups
  const groups = clusterByProximity(projected, OVERLAP_THRESHOLD_PX);

  // 3. Compute radial offsets for each group
  return groups.flatMap(group => {
    if (group.length === 1) {
      // Single station: no offset needed
      return [{ stationId: group[0].station.id, offsetX: 0, offsetY: 0 }];
    }

    // Multiple overlapping stations: distribute radially
    const radius = OFFSET_RADIUS_BASE + group.length * 2;
    return group.map((item, index) => {
      // Evenly distribute around circle (0 to 2π)
      const angle = (index / group.length) * 2 * Math.PI;
      return {
        stationId: item.station.id,
        offsetX: Math.cos(angle) * radius,
        offsetY: Math.sin(angle) * radius,
      };
    });
  });
}

/**
 * Cluster stations by proximity
 *
 * Uses simple greedy clustering:
 * - Start with first unvisited station
 * - Find all unvisited stations within threshold
 * - Add them to cluster and mark visited
 * - Repeat until all stations visited
 *
 * @param projected - Stations with screen coordinates
 * @param threshold - Distance threshold in pixels
 * @returns Array of station clusters
 *
 * Tasks: T012
 */
export function clusterByProximity(
  projected: ProjectedStation[],
  threshold: number
): ProjectedStation[][] {
  const clusters: ProjectedStation[][] = [];
  const visited = new Set<string>();

  projected.forEach(item => {
    if (visited.has(item.station.id)) return;

    const cluster: ProjectedStation[] = [item];
    visited.add(item.station.id);

    // Find all stations within threshold of current station
    projected.forEach(other => {
      if (visited.has(other.station.id)) return;

      const dx = item.point.x - other.point.x;
      const dy = item.point.y - other.point.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < threshold) {
        cluster.push(other);
        visited.add(other.station.id);
      }
    });

    clusters.push(cluster);
  });

  return clusters;
}
