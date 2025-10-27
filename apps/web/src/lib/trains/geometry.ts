import type { RodaliesLineGeometry } from '../../types/rodalies';

/**
 * Geometry utilities for train positioning and orientation
 *
 * Functions for calculating bearings and interpolating positions
 * for smooth 3D train visualization.
 *
 * Related tasks: T041, T042
 */

/**
 * Calculate bearing from one geographic point to another using Haversine formula
 *
 * @param lat1 - Starting latitude in degrees
 * @param lng1 - Starting longitude in degrees
 * @param lat2 - Ending latitude in degrees
 * @param lng2 - Ending longitude in degrees
 * @returns Bearing in degrees (0-360, where 0 is North, 90 is East)
 *
 * Task: T041
 *
 * Formula uses spherical trigonometry:
 * - Convert lat/lng to radians
 * - Calculate y = sin(Δλ) * cos(φ2)
 * - Calculate x = cos(φ1) * sin(φ2) - sin(φ1) * cos(φ2) * cos(Δλ)
 * - Bearing θ = atan2(y, x)
 * - Normalize to [0, 360)
 */
export function calculateBearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  // Convert degrees to radians
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;

  // Calculate bearing using Haversine formula
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

  const θ = Math.atan2(y, x);

  // Convert from radians to degrees and normalize to [0, 360)
  return ((θ * 180) / Math.PI + 360) % 360;
}

/**
 * Position coordinates as [longitude, latitude]
 * Follows Mapbox GL JS convention
 */
export type Position = [number, number];

/**
 * Interpolate position between two points with smooth easing
 *
 * Uses linear interpolation (lerp) with optional easing function
 * for smooth train movement between position updates.
 *
 * @param start - Starting position [lng, lat]
 * @param end - Ending position [lng, lat]
 * @param t - Interpolation factor (0.0 to 1.0)
 * @returns Interpolated position [lng, lat]
 *
 * Task: T042
 *
 * Linear interpolation formula:
 * - position = start + t * (end - start)
 * - t = 0.0 returns start position
 * - t = 1.0 returns end position
 * - t = 0.5 returns midpoint
 *
 * For smooth animation, t should increase gradually over time:
 * - elapsed = (now - lastUpdate) / updateInterval
 * - t = Math.min(elapsed, 1.0)
 */
export function interpolatePosition(start: Position, end: Position, t: number): Position {
  // Clamp t to [0, 1] range
  const factor = Math.max(0, Math.min(1, t));

  // Linear interpolation for longitude and latitude
  const lng = start[0] + factor * (end[0] - start[0]);
  const lat = start[1] + factor * (end[1] - start[1]);

  return [lng, lat];
}

/**
 * Easing function for smooth interpolation (ease-in-out cubic)
 *
 * Provides smooth acceleration and deceleration for train movement.
 * Use this to transform linear t before passing to interpolatePosition.
 *
 * @param t - Linear interpolation factor (0.0 to 1.0)
 * @returns Eased interpolation factor (0.0 to 1.0)
 *
 * Cubic ease-in-out formula:
 * - t < 0.5: 4t³
 * - t >= 0.5: 1 - (-2t + 2)³ / 2
 */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Calculate interpolated position with easing
 *
 * Convenience function that combines interpolation with easing
 * for smoother visual movement.
 *
 * @param start - Starting position [lng, lat]
 * @param end - Ending position [lng, lat]
 * @param t - Linear interpolation factor (0.0 to 1.0)
 * @returns Smoothly interpolated position [lng, lat]
 */
export function interpolatePositionSmooth(start: Position, end: Position, t: number): Position {
  const easedT = easeInOutCubic(t);
  return interpolatePosition(start, end, easedT);
}

const EARTH_RADIUS_METERS = 6_371_000;

interface CartesianPoint {
  x: number;
  y: number;
}

export interface RailwaySegment {
  start: Position;
  end: Position;
  startDistance: number;
  endDistance: number;
  bearing: number;
}

export interface PreprocessedRailwayLine {
  segments: RailwaySegment[];
  totalLength: number;
}

export interface RailwaySnapResult {
  position: Position;
  bearing: number;
  distance: number;
  metersAway: number;
}

function toCartesian(point: Position, origin: Position, originLatRad: number): CartesianPoint {
  const deltaLngRad = ((point[0] - origin[0]) * Math.PI) / 180;
  const deltaLatRad = ((point[1] - origin[1]) * Math.PI) / 180;

  return {
    x: EARTH_RADIUS_METERS * deltaLngRad * Math.cos(originLatRad),
    y: EARTH_RADIUS_METERS * deltaLatRad,
  };
}

function toLngLat(cart: CartesianPoint, origin: Position, originLatRad: number): Position {
  const lng = origin[0] + (cart.x / (EARTH_RADIUS_METERS * Math.cos(originLatRad))) * (180 / Math.PI);
  const lat = origin[1] + (cart.y / EARTH_RADIUS_METERS) * (180 / Math.PI);
  return [lng, lat];
}

function distanceBetween(a: Position, b: Position): number {
  const φ1 = (a[1] * Math.PI) / 180;
  const φ2 = (b[1] * Math.PI) / 180;
  const Δφ = φ2 - φ1;
  const Δλ = ((b[0] - a[0]) * Math.PI) / 180;

  const sinΔφ = Math.sin(Δφ / 2);
  const sinΔλ = Math.sin(Δλ / 2);

  const h =
    sinΔφ * sinΔφ +
    Math.cos(φ1) * Math.cos(φ2) * sinΔλ * sinΔλ;

  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_METERS * c;
}

function flattenLineGeometry(geometry: RodaliesLineGeometry): Position[][] {
  if (geometry.type === 'LineString') {
    return [geometry.coordinates];
  }

  if (geometry.type === 'MultiLineString') {
    return geometry.coordinates;
  }

  return [];
}

export function preprocessRailwayLine(geometry: RodaliesLineGeometry): PreprocessedRailwayLine | null {
  const lines = flattenLineGeometry(geometry);
  const segments: RailwaySegment[] = [];
  let totalLength = 0;

  for (const line of lines) {
    if (!line || line.length < 2) {
      continue;
    }

    for (let i = 0; i < line.length - 1; i += 1) {
      const start = line[i];
      const end = line[i + 1];
      if (!start || !end) {
        continue;
      }

      const distance = distanceBetween(start, end);
      if (!Number.isFinite(distance) || distance === 0) {
        continue;
      }

      const startDistance = totalLength;
      totalLength += distance;
      const endDistance = totalLength;

      const bearing = calculateBearing(start[1], start[0], end[1], end[0]);

      segments.push({
        start,
        end,
        startDistance,
        endDistance,
        bearing,
      });
    }
  }

  if (segments.length === 0) {
    return null;
  }

  return {
    segments,
    totalLength,
  };
}

export function snapTrainToRailway(
  position: Position,
  railway: PreprocessedRailwayLine,
  maxDistanceMeters = 200
): RailwaySnapResult | null {
  if (!railway.segments.length) {
    return null;
  }

  const originLatRad = (position[1] * Math.PI) / 180;

  let closest: RailwaySnapResult | null = null;

  for (const segment of railway.segments) {
    const startCartesian = toCartesian(segment.start, position, originLatRad);
    const endCartesian = toCartesian(segment.end, position, originLatRad);
    const pointCartesian = { x: 0, y: 0 }; // position projected to itself as origin

    const segmentVector = {
      x: endCartesian.x - startCartesian.x,
      y: endCartesian.y - startCartesian.y,
    };
    const segmentLengthSq = segmentVector.x * segmentVector.x + segmentVector.y * segmentVector.y;
    if (segmentLengthSq === 0) {
      continue;
    }

    const startToPoint = {
      x: pointCartesian.x - startCartesian.x,
      y: pointCartesian.y - startCartesian.y,
    };
    const projection = (startToPoint.x * segmentVector.x + startToPoint.y * segmentVector.y) / segmentLengthSq;
    const clampedProjection = Math.max(0, Math.min(1, projection));

    const closestCartesian = {
      x: startCartesian.x + segmentVector.x * clampedProjection,
      y: startCartesian.y + segmentVector.y * clampedProjection,
    };

    const deltaX = closestCartesian.x - pointCartesian.x;
    const deltaY = closestCartesian.y - pointCartesian.y;
    const distanceMeters = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    if (distanceMeters > maxDistanceMeters) {
      continue;
    }

    if (!closest || distanceMeters < closest.metersAway) {
      const snappedLngLat = toLngLat(closestCartesian, position, originLatRad);
      const alongDistance =
        segment.startDistance + (segment.endDistance - segment.startDistance) * clampedProjection;

      closest = {
        position: snappedLngLat,
        bearing: segment.bearing,
        distance: alongDistance,
        metersAway: distanceMeters,
      };
    }
  }

  return closest;
}

export function sampleRailwayPosition(
  railway: PreprocessedRailwayLine,
  distance: number
): { position: Position; bearing: number } {
  if (railway.segments.length === 0) {
    return {
      position: [0, 0],
      bearing: 0,
    };
  }

  const clampedDistance = Math.max(0, Math.min(distance, railway.totalLength));

  for (const segment of railway.segments) {
    if (clampedDistance <= segment.endDistance) {
      const segmentLength = segment.endDistance - segment.startDistance;
      const t =
        segmentLength === 0
          ? 0
          : (clampedDistance - segment.startDistance) / segmentLength;

      const lng = segment.start[0] + (segment.end[0] - segment.start[0]) * t;
      const lat = segment.start[1] + (segment.end[1] - segment.start[1]) * t;

      return {
        position: [lng, lat],
        bearing: segment.bearing,
      };
    }
  }

  const last = railway.segments[railway.segments.length - 1];
  return {
    position: last.end,
    bearing: last.bearing,
  };
}
