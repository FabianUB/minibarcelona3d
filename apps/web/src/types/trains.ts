/**
 * Train data types for real-time train tracking
 * Matches the API contract defined in specs/002-realtime-train-tracking/contracts/api.yaml
 */

/**
 * GTFS VehicleStopStatus enum
 * Indicates the train's current state relative to stops
 */
export type VehicleStatus = 'IN_TRANSIT_TO' | 'STOPPED_AT' | 'INCOMING_AT';

/**
 * GTFS schedule relationship enum
 * Indicates how the vehicle relates to the schedule
 */
export type ScheduleRelationship = 'SCHEDULED' | 'SKIPPED' | 'NO_DATA';

/**
 * Complete train data from GET /api/trains
 * Includes all fields for detailed train information
 */
export interface Train {
  // Primary identifier
  vehicleKey: string;

  // Identity fields
  vehicleId: string | null;
  vehicleLabel: string;
  entityId: string;

  // Trip context
  tripId: string | null;
  routeId: string;

  // Position (nullable - some trains don't report GPS)
  latitude: number | null;
  longitude: number | null;

  // Stop context
  currentStopId: string | null;
  previousStopId: string | null;
  nextStopId: string | null;
  nextStopSequence: number | null;

  // Status
  status: VehicleStatus;

  // Delay information
  arrivalDelaySeconds: number | null;
  departureDelaySeconds: number | null;

  // Schedule relationship and predictions
  scheduleRelationship: ScheduleRelationship | null;
  predictedArrivalUtc: string | null;
  predictedDepartureUtc: string | null;

  // Timestamps
  vehicleTimestampUtc: string | null;
  polledAtUtc: string;
  updatedAt: string;
}

/**
 * Lightweight train position data from GET /api/trains/positions
 * Optimized for frequent polling (every 15-30 seconds)
 */
export interface TrainPosition {
  vehicleKey: string;
  latitude: number | null;
  longitude: number | null;
  nextStopId: string | null;
  routeId: string;
  status: VehicleStatus;
  polledAtUtc: string;
}

/**
 * Response structure for GET /api/trains
 */
export interface GetAllTrainsResponse {
  trains: Train[];
  count: number;
  polledAt: string;
}

/**
 * Response structure for GET /api/trains/positions
 */
export interface GetAllTrainPositionsResponse {
  positions: TrainPosition[];
  previousPositions?: TrainPosition[];
  count: number;
  polledAt: string;
  previousPolledAt?: string;
}

/**
 * API error response structure
 */
export interface ApiError {
  error: string;
  details?: Record<string, unknown>;
}

/**
 * Stop time information for a specific stop on a trip
 */
export interface StopTime {
  stopId: string;
  stopSequence: number;
  stopName: string | null;
  scheduledArrival: string | null;
  scheduledDeparture: string | null;
  predictedArrivalUtc: string | null;
  predictedDepartureUtc: string | null;
  arrivalDelaySeconds: number | null;
  departureDelaySeconds: number | null;
  scheduleRelationship: string | null;
}

/**
 * Complete trip details including all stops
 */
export interface TripDetails {
  tripId: string;
  routeId: string;
  stopTimes: StopTime[];
  updatedAt: string | null;
}
