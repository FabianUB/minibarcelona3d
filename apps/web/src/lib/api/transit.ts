/**
 * API client for transit (Metro/TRAM/FGC/Bus) data
 *
 * Provides functions for fetching schedule-based positions
 * and re-exports shared trip details functions.
 */

import type { VehiclePosition, TransportType, PositionConfidence } from '../../types/transit';

// Trip details functions are shared across all transit types
// They all use the same /api/trips/{tripId} endpoint
export {
  fetchTripDetails,
  fetchTripDetailsCached,
  prefetchTripDetails,
} from './trains';

// Re-export types
export type { TripDetails, StopTime } from '../../types/trains';

/**
 * API response types for schedule-based positions
 */
export interface SchedulePositionApi {
  vehicleKey: string;
  networkType: string;
  routeId: string;
  routeShortName: string;
  routeLongName?: string;
  routeColor: string;
  tripId: string;
  direction: number;
  latitude: number;
  longitude: number;
  bearing?: number;
  previousStopId?: string;
  nextStopId?: string;
  previousStopName?: string;
  nextStopName?: string;
  status: string;
  progressFraction?: number;
  scheduledArrival?: string;
  scheduledDeparture?: string;
  source: string;
  confidence: string;
  estimatedAt: string;
  polledAtUtc: string;
}

export interface SchedulePositionsResponse {
  positions: SchedulePositionApi[];
  count: number;
  networks: {
    tram: number;
    fgc: number;
    bus: number;
  };
  polledAt: string;
}

/**
 * Valid network types for schedule-based positions
 */
export type ScheduleNetworkType = 'tram' | 'fgc' | 'bus';

/**
 * Converts API response to frontend VehiclePosition format
 */
function apiToVehiclePosition(api: SchedulePositionApi): VehiclePosition {
  return {
    vehicleKey: api.vehicleKey,
    networkType: api.networkType as TransportType,
    lineCode: api.routeShortName,
    routeLongName: api.routeLongName,
    routeId: api.routeId,
    tripId: api.tripId,
    latitude: api.latitude,
    longitude: api.longitude,
    bearing: api.bearing ?? 0,
    source: 'schedule',
    confidence: api.confidence as PositionConfidence,
    estimatedAt: new Date(api.estimatedAt).getTime(),
    direction: api.direction as 0 | 1,
    previousStopId: api.previousStopId ?? null,
    nextStopId: api.nextStopId ?? null,
    previousStopName: api.previousStopName ?? null,
    nextStopName: api.nextStopName ?? null,
    status: api.status as VehiclePosition['status'],
    progressFraction: api.progressFraction ?? 0,
    distanceAlongLine: 0, // Not provided by schedule API
    speedMetersPerSecond: 0, // Not provided by schedule API
    lineTotalLength: 0, // Not provided by schedule API
    lineColor: api.routeColor || '#888888',
  };
}

/**
 * Fetch schedule-based positions for TRAM, FGC, and/or Bus
 *
 * @param network - Optional network filter ('tram', 'fgc', 'bus')
 * @returns Promise with positions and metadata
 */
export async function fetchSchedulePositions(
  network?: ScheduleNetworkType
): Promise<{
  positions: VehiclePosition[];
  count: number;
  networks: { tram: number; fgc: number; bus: number };
  polledAt: string;
}> {
  const url = network
    ? `/api/transit/schedule?network=${network}`
    : '/api/transit/schedule';

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch schedule positions: ${response.status}`);
  }

  const data: SchedulePositionsResponse = await response.json();

  return {
    positions: data.positions.map(apiToVehiclePosition),
    count: data.count,
    networks: data.networks,
    polledAt: data.polledAt,
  };
}
