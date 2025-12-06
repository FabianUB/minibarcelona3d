/**
 * Track Alignment Utilities for Station Markers
 * Feature: 004-station-visualization
 *
 * Calculate track bearings at station positions to align elliptical markers
 * along the railway line direction.
 */

import type { Station, LineGeometryCollection } from '../../types/rodalies';
import { calculateBearing } from '../trains/geometry';

/**
 * Result of track bearing calculation for a station
 */
export interface StationTrackAlignment {
  /** Station ID */
  stationId: string;

  /** Track bearing in degrees (0-360, where 0 is North, 90 is East) */
  bearing: number;

  /** Line ID this bearing was calculated from (dominant line for multi-line stations) */
  lineId: string;
}

/**
 * Calculate the track bearing at a station position
 *
 * Finds the nearest line segment on the railway geometry and calculates
 * the bearing (direction) of that segment. For multi-line stations,
 * uses the dominant (first) line.
 *
 * @param station - Station with position
 * @param lineGeometry - Railway line geometry collection to search
 * @returns Track bearing in degrees, or null if no nearby track found
 */
export function calculateStationTrackBearing(
  station: Station,
  lineGeometry: LineGeometryCollection
): StationTrackAlignment | null {
  const stationLng = station.geometry.coordinates[0];
  const stationLat = station.geometry.coordinates[1];

  // Get the dominant line (first line in the station's line list)
  const dominantLineId = station.lines[0];
  if (!dominantLineId) {
    return null;
  }

  // Find the feature for the dominant line
  const lineFeature = lineGeometry.features.find(
    (feature) => feature.properties.id === dominantLineId
  );

  if (!lineFeature) {
    return null;
  }

  // Get coordinates from the geometry
  let coordinates: [number, number][] = [];
  if (lineFeature.geometry.type === 'LineString') {
    coordinates = lineFeature.geometry.coordinates;
  } else if (lineFeature.geometry.type === 'MultiLineString') {
    // For MultiLineString, use the first linestring
    coordinates = lineFeature.geometry.coordinates[0] || [];
  }

  if (coordinates.length < 2) {
    return null;
  }

  // Find the closest segment on the line to the station
  let minDistance = Infinity;
  let closestSegmentIndex = -1;

  for (let i = 0; i < coordinates.length - 1; i++) {
    const [lng1, lat1] = coordinates[i];
    const [lng2, lat2] = coordinates[i + 1];

    // Calculate distance from station to this segment's midpoint
    const midLng = (lng1 + lng2) / 2;
    const midLat = (lat1 + lat2) / 2;

    const dx = stationLng - midLng;
    const dy = stationLat - midLat;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < minDistance) {
      minDistance = distance;
      closestSegmentIndex = i;
    }
  }

  if (closestSegmentIndex === -1) {
    return null;
  }

  // Calculate bearing of the closest segment
  const [lng1, lat1] = coordinates[closestSegmentIndex];
  const [lng2, lat2] = coordinates[closestSegmentIndex + 1];

  const bearing = calculateBearing(lat1, lng1, lat2, lng2);

  return {
    stationId: station.id,
    bearing,
    lineId: dominantLineId,
  };
}

/**
 * Calculate track bearings for all stations
 *
 * Processes a list of stations and calculates the track bearing for each one
 * based on the nearest railway line segment.
 *
 * @param stations - List of stations to process
 * @param lineGeometry - Railway line geometry collection
 * @returns Map of station ID to track alignment data
 */
export function calculateStationTrackAlignments(
  stations: Station[],
  lineGeometry: LineGeometryCollection
): Map<string, StationTrackAlignment> {
  const alignments = new Map<string, StationTrackAlignment>();

  for (const station of stations) {
    const alignment = calculateStationTrackBearing(station, lineGeometry);
    if (alignment) {
      alignments.set(station.id, alignment);
    }
  }

  return alignments;
}
