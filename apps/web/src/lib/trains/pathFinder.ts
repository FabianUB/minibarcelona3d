/**
 * Path finder for railway segments between stations
 *
 * Extracts the portion of a railway line between two stations,
 * used for interpolating train positions along the track.
 *
 * Phase 4, Task T022
 */

import type { Station } from '../../types/rodalies';
import type { PreprocessedRailwayLine } from './geometry';
import { snapTrainToRailway } from './geometry';

/**
 * Result of path finding between stations
 */
export interface PathSegment extends PreprocessedRailwayLine {
  /** Start station ID */
  fromStationId: string;
  /** End station ID */
  toStationId: string;
  /** Whether the path is reversed (going backward along the line) */
  isReversed: boolean;
}

/**
 * Find the railway path segment between two stations
 *
 * Snaps both stations to the railway line and extracts the segment
 * between them. Returns null if either station can't be snapped or
 * they're not on the same line.
 *
 * @param fromStationId - Starting station ID
 * @param toStationId - Ending station ID
 * @param railway - Preprocessed railway line geometry
 * @param stations - Map of station data
 * @param maxSnapDistance - Maximum distance to snap stations to line (meters)
 * @returns Path segment or null if not found
 */
export function getPathBetweenStations(
  fromStationId: string,
  toStationId: string,
  railway: PreprocessedRailwayLine,
  stations: Map<string, Station>,
  maxSnapDistance: number = 500
): PathSegment | null {
  // Get station data
  const fromStation = stations.get(fromStationId);
  const toStation = stations.get(toStationId);

  if (!fromStation || !toStation) {
    return null;
  }

  // Get station coordinates
  const fromCoords: [number, number] = [
    fromStation.geometry.coordinates[0],
    fromStation.geometry.coordinates[1],
  ];
  const toCoords: [number, number] = [
    toStation.geometry.coordinates[0],
    toStation.geometry.coordinates[1],
  ];

  // Snap stations to railway
  const fromSnap = snapTrainToRailway(fromCoords, railway, maxSnapDistance);
  const toSnap = snapTrainToRailway(toCoords, railway, maxSnapDistance);

  if (!fromSnap || !toSnap) {
    return null;
  }

  // Determine direction (are we going forward or backward along the line?)
  const isReversed = toSnap.distance < fromSnap.distance;

  // Get the segment distances
  const startDistance = Math.min(fromSnap.distance, toSnap.distance);
  const endDistance = Math.max(fromSnap.distance, toSnap.distance);

  // Extract the segment from the preprocessed line
  const segmentCoordinates: [number, number][] = [];
  const segmentDistances: number[] = [];
  const segmentBearings: number[] = [];

  // Find start and end indices
  let startIndex = 0;
  let endIndex = railway.coordinates.length - 1;

  for (let i = 0; i < railway.cumulativeDistances.length; i++) {
    if (railway.cumulativeDistances[i] >= startDistance && startIndex === 0) {
      startIndex = Math.max(0, i - 1);
    }
    if (railway.cumulativeDistances[i] >= endDistance) {
      endIndex = i;
      break;
    }
  }

  // Add interpolated start point
  const startPoint = interpolatePointAtDistance(railway, startDistance);
  if (startPoint) {
    segmentCoordinates.push(startPoint.position);
    segmentDistances.push(0);
    segmentBearings.push(startPoint.bearing);
  }

  // Add intermediate points
  for (let i = startIndex + 1; i < endIndex; i++) {
    if (railway.cumulativeDistances[i] > startDistance && railway.cumulativeDistances[i] < endDistance) {
      segmentCoordinates.push(railway.coordinates[i]);
      segmentDistances.push(railway.cumulativeDistances[i] - startDistance);
      segmentBearings.push(railway.segmentBearings[Math.min(i, railway.segmentBearings.length - 1)]);
    }
  }

  // Add interpolated end point
  const endPoint = interpolatePointAtDistance(railway, endDistance);
  if (endPoint) {
    segmentCoordinates.push(endPoint.position);
    segmentDistances.push(endDistance - startDistance);
    segmentBearings.push(endPoint.bearing);
  }

  if (segmentCoordinates.length < 2) {
    // Not enough points for a valid segment - use direct line
    return {
      lineId: railway.lineId,
      coordinates: [fromCoords, toCoords],
      cumulativeDistances: [0, endDistance - startDistance],
      segmentBearings: [fromSnap.bearing],
      totalLength: endDistance - startDistance,
      fromStationId,
      toStationId,
      isReversed,
    };
  }

  // If reversed, reverse the segment
  if (isReversed) {
    segmentCoordinates.reverse();
    segmentBearings.reverse();
    // Recalculate distances from new start
    const totalLen = segmentDistances[segmentDistances.length - 1];
    const reversedDistances = segmentDistances.map((d) => totalLen - d).reverse();
    segmentDistances.length = 0;
    segmentDistances.push(...reversedDistances);
    // Reverse bearings (add 180 degrees)
    for (let i = 0; i < segmentBearings.length; i++) {
      segmentBearings[i] = (segmentBearings[i] + 180) % 360;
    }
  }

  return {
    lineId: railway.lineId,
    coordinates: segmentCoordinates,
    cumulativeDistances: segmentDistances,
    segmentBearings: segmentBearings,
    totalLength: endDistance - startDistance,
    fromStationId,
    toStationId,
    isReversed,
  };
}

/**
 * Interpolate a point at a specific distance along the railway
 */
function interpolatePointAtDistance(
  railway: PreprocessedRailwayLine,
  targetDistance: number
): { position: [number, number]; bearing: number } | null {
  if (targetDistance <= 0) {
    return {
      position: railway.coordinates[0],
      bearing: railway.segmentBearings[0],
    };
  }

  if (targetDistance >= railway.totalLength) {
    return {
      position: railway.coordinates[railway.coordinates.length - 1],
      bearing: railway.segmentBearings[railway.segmentBearings.length - 1],
    };
  }

  // Find the segment containing the target distance
  for (let i = 1; i < railway.cumulativeDistances.length; i++) {
    if (railway.cumulativeDistances[i] >= targetDistance) {
      const prevDist = railway.cumulativeDistances[i - 1];
      const segmentLength = railway.cumulativeDistances[i] - prevDist;

      if (segmentLength === 0) {
        return {
          position: railway.coordinates[i],
          bearing: railway.segmentBearings[Math.min(i, railway.segmentBearings.length - 1)],
        };
      }

      const t = (targetDistance - prevDist) / segmentLength;

      const p1 = railway.coordinates[i - 1];
      const p2 = railway.coordinates[i];

      return {
        position: [
          p1[0] + (p2[0] - p1[0]) * t,
          p1[1] + (p2[1] - p1[1]) * t,
        ],
        bearing: railway.segmentBearings[Math.min(i - 1, railway.segmentBearings.length - 1)],
      };
    }
  }

  return null;
}

/**
 * Check if a station is on a railway line
 *
 * @param stationId - Station ID to check
 * @param railway - Preprocessed railway line
 * @param stations - Map of station data
 * @param maxDistance - Maximum snap distance (meters)
 * @returns True if station is on the line
 */
export function isStationOnLine(
  stationId: string,
  railway: PreprocessedRailwayLine,
  stations: Map<string, Station>,
  maxDistance: number = 500
): boolean {
  const station = stations.get(stationId);
  if (!station) return false;

  const coords: [number, number] = [
    station.geometry.coordinates[0],
    station.geometry.coordinates[1],
  ];

  const snap = snapTrainToRailway(coords, railway, maxDistance);
  return snap !== null;
}

/**
 * Get distance along railway from start to a station
 *
 * @param stationId - Station ID
 * @param railway - Preprocessed railway line
 * @param stations - Map of station data
 * @returns Distance in meters or null if station not on line
 */
export function getStationDistanceOnLine(
  stationId: string,
  railway: PreprocessedRailwayLine,
  stations: Map<string, Station>
): number | null {
  const station = stations.get(stationId);
  if (!station) return null;

  const coords: [number, number] = [
    station.geometry.coordinates[0],
    station.geometry.coordinates[1],
  ];

  const snap = snapTrainToRailway(coords, railway, 500);
  return snap ? snap.distance : null;
}
