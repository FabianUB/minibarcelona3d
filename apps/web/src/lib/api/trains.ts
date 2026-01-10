/**
 * API client for train data endpoints
 * Handles HTTP requests to the Go backend API with retry logic
 */

import type {
  Train,
  TripDetails,
  GetAllTrainsResponse,
  GetAllTrainPositionsResponse,
} from '../../types/trains';
import { fetchWithRetry, parseErrorResponse } from './fetchWithRetry';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

/**
 * Fetches all active trains from the backend
 * Only returns trains updated within the last 10 minutes (active routes)
 *
 * Automatically retries on transient failures (network errors, 5xx server errors)
 * Uses exponential backoff: 1s, 2s, 4s (max 3 attempts)
 *
 * @param routeId - Optional route/line ID to filter trains
 * @returns Promise with trains array, count, and poll timestamp
 * @throws Error if request fails after all retry attempts
 */
export async function fetchAllTrains(
  routeId?: string
): Promise<GetAllTrainsResponse> {
  const url = new URL(`${API_BASE}/trains`, window.location.origin);

  if (routeId) {
    url.searchParams.set('route_id', routeId);
  }

  const response = await fetchWithRetry(url.toString());

  if (!response.ok) {
    const errorMessage = await parseErrorResponse(response);
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Fetches lightweight train position data optimized for polling
 * Returns only essential fields (position, route, status)
 *
 * Designed for frequent updates (every 15-30 seconds)
 * Performance: ~50ms for 100 trains, ~1KB per train
 *
 * Automatically retries on transient failures with exponential backoff
 *
 * @returns Promise with position array, count, and poll timestamp
 * @throws Error if request fails after all retry attempts
 */
export async function fetchTrainPositions(): Promise<GetAllTrainPositionsResponse> {
  const url = `${API_BASE}/trains/positions`;
  const response = await fetchWithRetry(url);

  if (!response.ok) {
    const errorMessage = await parseErrorResponse(response);
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Fetches detailed data for a specific train by vehicle key
 * Primary key lookup with <10ms response time
 *
 * Automatically retries on transient failures (5xx errors, network issues)
 * Does NOT retry on 404 Not Found (train doesn't exist)
 *
 * @param vehicleKey - Unique train identifier (e.g., "25724", "vehicle:R12345")
 * @returns Promise with complete train data
 * @throws Error if train not found (404) or request fails after retries
 */
export async function fetchTrainByKey(vehicleKey: string): Promise<Train> {
  if (!vehicleKey) {
    throw new Error('vehicleKey is required');
  }

  const url = `${API_BASE}/trains/${encodeURIComponent(vehicleKey)}`;
  const response = await fetchWithRetry(url);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Train not found: ${vehicleKey}`);
    }

    const errorMessage = await parseErrorResponse(response);
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Fetches complete trip details including all stops with schedules and delays
 * Joins static GTFS schedule data with real-time updates
 *
 * Automatically retries on transient failures (5xx errors, network issues)
 * Does NOT retry on 404 Not Found (trip doesn't exist)
 *
 * @param tripId - GTFS trip identifier
 * @returns Promise with trip details including all stops
 * @throws Error if trip not found (404) or request fails after retries
 */
export async function fetchTripDetails(tripId: string): Promise<TripDetails> {
  if (!tripId) {
    throw new Error('tripId is required');
  }

  const url = `${API_BASE}/trips/${encodeURIComponent(tripId)}`;
  const response = await fetchWithRetry(url);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Trip not found: ${tripId}`);
    }

    const errorMessage = await parseErrorResponse(response);
    throw new Error(errorMessage);
  }

  return response.json();
}

// Import trip cache lazily to avoid circular dependencies
let tripCacheModule: typeof import('../trains/tripCache') | null = null;

async function getTripCacheModule() {
  if (!tripCacheModule) {
    tripCacheModule = await import('../trains/tripCache');
  }
  return tripCacheModule;
}

/**
 * Fetches trip details with caching
 *
 * Uses the global TripCache to avoid redundant API calls.
 * Handles concurrent requests for the same tripId.
 *
 * Phase 3, Task T016
 *
 * @param tripId - GTFS trip identifier
 * @returns Promise with trip details (from cache or freshly fetched)
 * @throws Error if trip not found or request fails
 */
export async function fetchTripDetailsCached(tripId: string): Promise<TripDetails> {
  if (!tripId) {
    throw new Error('tripId is required');
  }

  const { getTripCache } = await getTripCacheModule();
  return getTripCache().getOrFetch(tripId);
}

/**
 * Prefetch trip details for multiple trains without blocking
 *
 * Useful for warming the cache when new trains appear.
 * Silently handles errors (logs warnings but doesn't throw).
 *
 * Phase 3, Task T017
 *
 * @param tripIds - Array of GTFS trip identifiers
 */
export async function prefetchTripDetails(tripIds: string[]): Promise<void> {
  if (tripIds.length === 0) return;

  const { getTripCache } = await getTripCacheModule();
  const cache = getTripCache();

  // Filter out null/undefined and already cached trips
  const toFetch = tripIds.filter((id) => id && !cache.has(id));

  if (toFetch.length > 0) {
    cache.prefetchMany(toFetch);
  }
}
