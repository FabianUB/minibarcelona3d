/**
 * Predictive position calculator for train visualization
 *
 * Calculates predicted train positions based on schedule data when GPS
 * updates are delayed or unavailable. Uses time-based interpolation
 * along railway lines with optional GPS blending.
 *
 * Phase 4, Tasks T020, T021, T023, T024
 */

import type { TrainPosition, TripDetails, StopTime } from '../../types/trains';
import type { Station } from '../../types/rodalies';
import type { PreprocessedRailwayLine } from './geometry';
import { sampleRailwayPosition, snapTrainToRailway } from './geometry';
import { getPathBetweenStations } from './pathFinder';

/**
 * Result of predictive position calculation
 */
export interface PredictedPosition {
  /** Predicted position as [longitude, latitude] */
  position: [number, number];
  /** Bearing at predicted position (degrees, 0-360) */
  bearing: number;
  /** Source of the position data */
  source: 'gps' | 'predicted' | 'blended';
  /** Confidence in the prediction (0-1) */
  confidence: number;
  /** Progress between previous and next stop (0-1) */
  progress: number;
  /** Debug info about the calculation */
  debug?: {
    previousStopId: string | null;
    nextStopId: string | null;
    scheduledProgress: number;
    gpsAge: number | null;
    blendWeight: number;
  };
}

/**
 * Progress calculation result
 */
export interface ProgressResult {
  /** Progress between stops (0 = at previous, 1 = at next) */
  progress: number;
  /** Previous stop info */
  previousStop: StopTime;
  /** Next stop info */
  nextStop: StopTime;
  /** Whether we're using predicted times (vs scheduled) */
  usingPredictedTimes: boolean;
}

/**
 * Configuration for predictive calculation
 */
export interface PredictiveConfig {
  /** Maximum GPS age before falling back to prediction (ms) */
  maxGpsAgeMs: number;
  /** Blend weight for GPS when fresh (0-1, higher = more GPS) */
  freshGpsWeight: number;
  /** Minimum confidence to use prediction */
  minConfidence: number;
  /** Whether to enable debug output */
  debug: boolean;
}

export const DEFAULT_PREDICTIVE_CONFIG: PredictiveConfig = {
  maxGpsAgeMs: 60000, // 60 seconds
  freshGpsWeight: 0.8, // 80% GPS, 20% predicted when GPS is fresh
  minConfidence: 0.3,
  debug: false,
};

/**
 * Parse time string (HH:MM:SS) to seconds since midnight
 */
export function parseTimeToSeconds(time: string | null): number | null {
  if (!time) return null;

  const parts = time.split(':');
  if (parts.length !== 3) return null;

  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const seconds = parseInt(parts[2], 10);

  if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) return null;

  // Handle times past midnight (e.g., 25:30:00 for 1:30 AM next day)
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Get current time as seconds since midnight (local time)
 */
export function getCurrentTimeSeconds(): number {
  const now = new Date();
  return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
}

/**
 * Calculate journey progress between two stops based on current time
 *
 * Task T021: Time-based progress calculation
 *
 * @param train - Current train position data
 * @param tripDetails - Full trip schedule
 * @param currentTimeSeconds - Current time in seconds since midnight
 * @returns Progress result or null if calculation not possible
 */
export function calculateProgress(
  train: TrainPosition,
  tripDetails: TripDetails,
  currentTimeSeconds: number
): ProgressResult | null {
  if (!train.nextStopId || tripDetails.stopTimes.length < 2) {
    return null;
  }

  // Find the next stop in the schedule
  const nextStopIndex = tripDetails.stopTimes.findIndex(
    (st) => st.stopId === train.nextStopId
  );

  if (nextStopIndex === -1 || nextStopIndex === 0) {
    // Next stop not found or is the first stop (no previous)
    return null;
  }

  const nextStop = tripDetails.stopTimes[nextStopIndex];
  const previousStop = tripDetails.stopTimes[nextStopIndex - 1];

  // Try to use predicted times first, fall back to scheduled
  let departureTime: number | null = null;
  let arrivalTime: number | null = null;
  let usingPredictedTimes = false;

  // Check for predicted times
  if (previousStop.predictedDepartureUtc) {
    const predictedDep = new Date(previousStop.predictedDepartureUtc);
    departureTime = predictedDep.getHours() * 3600 + predictedDep.getMinutes() * 60 + predictedDep.getSeconds();
    usingPredictedTimes = true;
  } else {
    departureTime = parseTimeToSeconds(previousStop.scheduledDeparture);
  }

  if (nextStop.predictedArrivalUtc) {
    const predictedArr = new Date(nextStop.predictedArrivalUtc);
    arrivalTime = predictedArr.getHours() * 3600 + predictedArr.getMinutes() * 60 + predictedArr.getSeconds();
    usingPredictedTimes = true;
  } else {
    arrivalTime = parseTimeToSeconds(nextStop.scheduledArrival);
  }

  if (departureTime === null || arrivalTime === null) {
    return null;
  }

  // Handle day wraparound (e.g., departure at 23:50, arrival at 00:10)
  if (arrivalTime < departureTime) {
    arrivalTime += 24 * 3600;
  }

  // Handle current time wraparound
  let adjustedCurrentTime = currentTimeSeconds;
  if (adjustedCurrentTime < departureTime - 12 * 3600) {
    // Current time is probably past midnight, add a day
    adjustedCurrentTime += 24 * 3600;
  }

  // Calculate progress (0-1)
  const totalDuration = arrivalTime - departureTime;
  if (totalDuration <= 0) {
    return null;
  }

  const elapsed = adjustedCurrentTime - departureTime;
  const progress = Math.max(0, Math.min(1, elapsed / totalDuration));

  return {
    progress,
    previousStop,
    nextStop,
    usingPredictedTimes,
  };
}

/**
 * Blend two positions together
 *
 * Task T023: GPS blending
 *
 * @param predicted - Predicted position [lng, lat]
 * @param gps - GPS position [lng, lat]
 * @param gpsWeight - Weight for GPS (0-1)
 * @returns Blended position [lng, lat]
 */
export function blendPositions(
  predicted: [number, number],
  gps: [number, number],
  gpsWeight: number
): [number, number] {
  const clampedWeight = Math.max(0, Math.min(1, gpsWeight));
  const predictedWeight = 1 - clampedWeight;

  return [
    predicted[0] * predictedWeight + gps[0] * clampedWeight,
    predicted[1] * predictedWeight + gps[1] * clampedWeight,
  ];
}

/**
 * Calculate GPS weight based on age
 *
 * Returns higher weight for fresher GPS data, tapering off to 0
 * as data approaches maxAge.
 *
 * @param gpsAgeMs - Age of GPS data in milliseconds
 * @param maxAgeMs - Maximum age before GPS is ignored
 * @param freshWeight - Weight when GPS is fresh
 * @returns GPS weight (0-1)
 */
export function calculateGpsWeight(
  gpsAgeMs: number,
  maxAgeMs: number,
  freshWeight: number
): number {
  if (gpsAgeMs <= 0) return freshWeight;
  if (gpsAgeMs >= maxAgeMs) return 0;

  // Exponential decay
  const decay = Math.exp(-3 * gpsAgeMs / maxAgeMs);
  return freshWeight * decay;
}

/**
 * Interpolate bearing between two values, handling wraparound
 *
 * Task T024: Bearing interpolation
 *
 * @param bearing1 - Start bearing (degrees)
 * @param bearing2 - End bearing (degrees)
 * @param progress - Progress (0-1)
 * @returns Interpolated bearing (degrees, 0-360)
 */
export function interpolateBearing(
  bearing1: number,
  bearing2: number,
  progress: number
): number {
  // Normalize bearings to 0-360
  const b1 = ((bearing1 % 360) + 360) % 360;
  const b2 = ((bearing2 % 360) + 360) % 360;

  // Find shortest rotation direction
  let diff = b2 - b1;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;

  // Interpolate
  const result = b1 + diff * progress;
  return ((result % 360) + 360) % 360;
}

/**
 * Calculate predictive position for a train
 *
 * Task T020: Main predictive calculation
 *
 * Uses schedule data to predict where a train should be based on current time,
 * optionally blending with GPS data when available.
 *
 * @param train - Current train position data
 * @param tripDetails - Full trip schedule with stop times
 * @param currentTime - Current timestamp (ms since epoch)
 * @param railwayLines - Map of preprocessed railway geometries
 * @param stations - Map of station data
 * @param config - Predictive configuration
 * @returns Calculated position or null if prediction not possible
 */
export function calculatePredictivePosition(
  train: TrainPosition,
  tripDetails: TripDetails,
  currentTime: number,
  railwayLines: Map<string, PreprocessedRailwayLine>,
  stations: Map<string, Station>,
  config: PredictiveConfig = DEFAULT_PREDICTIVE_CONFIG
): PredictedPosition | null {
  const currentTimeSeconds = getCurrentTimeSeconds();

  // Calculate schedule-based progress
  const progressResult = calculateProgress(train, tripDetails, currentTimeSeconds);

  if (!progressResult) {
    // Can't calculate progress - fall back to GPS if available
    if (train.latitude !== null && train.longitude !== null) {
      return {
        position: [train.longitude, train.latitude],
        bearing: 0, // Unknown bearing
        source: 'gps',
        confidence: 0.5,
        progress: 0,
      };
    }
    return null;
  }

  const { progress, previousStop, nextStop } = progressResult;

  // Get station coordinates
  const previousStation = stations.get(previousStop.stopId);
  const nextStation = stations.get(nextStop.stopId);

  if (!previousStation || !nextStation) {
    if (config.debug) {
      console.warn('PredictiveCalculator: Station not found', {
        previousStopId: previousStop.stopId,
        nextStopId: nextStop.stopId,
      });
    }
    return null;
  }

  const previousCoords: [number, number] = [
    previousStation.geometry.coordinates[0],
    previousStation.geometry.coordinates[1],
  ];
  const nextCoords: [number, number] = [
    nextStation.geometry.coordinates[0],
    nextStation.geometry.coordinates[1],
  ];

  // Extract line ID from route
  const lineMatch = train.routeId.match(/R\d+[A-Z]?/i);
  const lineId = lineMatch ? lineMatch[0].toUpperCase() : null;

  if (!lineId) {
    if (config.debug) {
      console.warn('PredictiveCalculator: Could not extract line ID from', train.routeId);
    }
    return null;
  }

  const railway = railwayLines.get(lineId);
  if (!railway) {
    if (config.debug) {
      console.warn('PredictiveCalculator: Railway not found for', lineId);
    }
    return null;
  }

  // Get path between stations
  const path = getPathBetweenStations(
    previousStop.stopId,
    nextStop.stopId,
    railway,
    stations
  );

  let predictedPosition: [number, number];
  let predictedBearing: number;

  if (path) {
    // Interpolate along the railway path
    const totalDistance = path.totalLength;
    const targetDistance = totalDistance * progress;
    const sample = sampleRailwayPosition(path, targetDistance);

    predictedPosition = [sample.position[0], sample.position[1]];
    predictedBearing = sample.bearing;
  } else {
    // Fall back to linear interpolation between stations
    predictedPosition = [
      previousCoords[0] + (nextCoords[0] - previousCoords[0]) * progress,
      previousCoords[1] + (nextCoords[1] - previousCoords[1]) * progress,
    ];

    // Calculate bearing from previous to next
    const dLng = nextCoords[0] - previousCoords[0];
    const dLat = nextCoords[1] - previousCoords[1];
    predictedBearing = (Math.atan2(dLng, dLat) * 180 / Math.PI + 360) % 360;
  }

  // Check if we have GPS data to blend
  const hasGps = train.latitude !== null && train.longitude !== null;
  const gpsPosition: [number, number] | null = hasGps
    ? [train.longitude!, train.latitude!]
    : null;

  // Calculate GPS age (using polledAtUtc)
  const gpsAgeMs = train.polledAtUtc
    ? currentTime - new Date(train.polledAtUtc).getTime()
    : Infinity;

  // Determine blending
  let finalPosition: [number, number];
  let source: 'gps' | 'predicted' | 'blended';
  let confidence: number;
  let blendWeight = 0;

  if (gpsPosition && gpsAgeMs < config.maxGpsAgeMs) {
    // Blend GPS with prediction
    blendWeight = calculateGpsWeight(gpsAgeMs, config.maxGpsAgeMs, config.freshGpsWeight);

    if (blendWeight > 0.9) {
      // GPS is very fresh - use it directly
      finalPosition = gpsPosition;
      source = 'gps';
      confidence = 0.9;
    } else if (blendWeight < 0.1) {
      // GPS is too old - use prediction
      finalPosition = predictedPosition;
      source = 'predicted';
      confidence = 0.7;
    } else {
      // Blend
      finalPosition = blendPositions(predictedPosition, gpsPosition, blendWeight);
      source = 'blended';
      confidence = 0.8;
    }
  } else {
    // No GPS or too old - use pure prediction
    finalPosition = predictedPosition;
    source = 'predicted';
    confidence = 0.6;
  }

  // Snap to railway for better bearing if possible
  const snapResult = snapTrainToRailway(finalPosition, railway, 100);
  const finalBearing = snapResult ? snapResult.bearing : predictedBearing;

  return {
    position: finalPosition,
    bearing: finalBearing,
    source,
    confidence,
    progress,
    debug: config.debug
      ? {
          previousStopId: previousStop.stopId,
          nextStopId: nextStop.stopId,
          scheduledProgress: progress,
          gpsAge: gpsAgeMs === Infinity ? null : gpsAgeMs,
          blendWeight,
        }
      : undefined,
  };
}
