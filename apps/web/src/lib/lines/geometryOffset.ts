import type { LngLat } from '../../types/rodalies';

/**
 * Utility functions for offsetting line geometry perpendicular to line bearing
 * Used for visual separation of overlapping railway lines at high zoom levels
 */

/**
 * Calculate bearing (angle) between two points in degrees
 * Returns angle from North (0°) clockwise (0-360°)
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
 * Offset a coordinate perpendicular to a given bearing
 * Positive offset = right side, negative offset = left side
 *
 * @param coord - Original coordinate [lng, lat]
 * @param bearing - Direction in degrees (0-360)
 * @param offsetMeters - Distance to offset in meters
 */
function offsetCoordinate(
  coord: LngLat,
  bearing: number,
  offsetMeters: number
): LngLat {
  const [lng, lat] = coord;

  // Earth radius in meters
  const EARTH_RADIUS = 6378137;

  // Convert to radians
  const latRad = (lat * Math.PI) / 180;
  const bearingRad = (bearing * Math.PI) / 180;

  // Calculate perpendicular bearing (add 90° to go right)
  const perpBearingRad = bearingRad + Math.PI / 2;

  // Calculate offset in radians
  const angularDistance = offsetMeters / EARTH_RADIUS;

  // Calculate new position using spherical geometry
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
 * Offset an entire LineString geometry perpendicular to its direction
 *
 * @param coordinates - Array of [lng, lat] coordinates
 * @param offsetMeters - Distance to offset in meters (positive = right, negative = left)
 * @returns New array of offset coordinates
 */
export function offsetLineString(
  coordinates: LngLat[],
  offsetMeters: number
): LngLat[] {
  if (coordinates.length < 2) {
    return coordinates;
  }

  const offsetCoords: LngLat[] = [];

  for (let i = 0; i < coordinates.length; i++) {
    const current = coordinates[i];

    let bearing: number;

    if (i === 0) {
      // First point: use bearing to next point
      bearing = calculateBearing(current, coordinates[i + 1]);
    } else if (i === coordinates.length - 1) {
      // Last point: use bearing from previous point
      bearing = calculateBearing(coordinates[i - 1], current);
    } else {
      // Middle points: average bearing from previous and to next
      const bearingFrom = calculateBearing(coordinates[i - 1], current);
      const bearingTo = calculateBearing(current, coordinates[i + 1]);

      // Average angles (handle 360° wraparound)
      let diff = bearingTo - bearingFrom;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      bearing = (bearingFrom + diff / 2 + 360) % 360;
    }

    offsetCoords.push(offsetCoordinate(current, bearing, offsetMeters));
  }

  return offsetCoords;
}

/**
 * Offset a MultiLineString geometry
 */
export function offsetMultiLineString(
  coordinates: LngLat[][],
  offsetMeters: number
): LngLat[][] {
  return coordinates.map((lineString) => offsetLineString(lineString, offsetMeters));
}
