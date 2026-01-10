/**
 * API client for Metro data endpoints
 * Handles HTTP requests to the Go backend API with retry logic
 *
 * Metro positions are estimated from iMetro arrival predictions,
 * not GPS coordinates. The poller computes positions by interpolating
 * along line geometry based on time-to-arrival.
 */

import type { GetMetroPositionsResponse } from '../../types/metro';
import { fetchWithRetry, parseErrorResponse } from './fetchWithRetry';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';
const LOG_PREFIX = 'Metro API';

/**
 * Fetches Metro vehicle positions from the backend
 *
 * Returns estimated positions computed from iMetro arrival predictions.
 * Includes previous positions for smooth animation interpolation.
 *
 * Designed for polling every 30 seconds (same as Rodalies).
 * Performance target: <50ms for ~150 vehicles.
 *
 * Automatically retries on transient failures with exponential backoff.
 *
 * @param lineCode - Optional line code to filter (e.g., "L1", "L3")
 * @returns Promise with positions array, count, and poll timestamps
 * @throws Error if request fails after all retry attempts
 */
export async function fetchMetroPositions(
  lineCode?: string
): Promise<GetMetroPositionsResponse> {
  const url = new URL(`${API_BASE}/metro/positions`, window.location.origin);

  if (lineCode) {
    url.searchParams.set('line_code', lineCode);
  }

  const response = await fetchWithRetry(url.toString(), undefined, LOG_PREFIX);

  if (!response.ok) {
    const errorMessage = await parseErrorResponse(response);
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Fetches Metro positions for a specific line
 *
 * Alternative endpoint that uses path parameter instead of query string.
 * Useful when you always want positions for exactly one line.
 *
 * @param lineCode - Line code (e.g., "L1", "L3", "L9N")
 * @returns Promise with positions for the specified line
 * @throws Error if lineCode is empty or request fails
 */
export async function fetchMetroPositionsByLine(
  lineCode: string
): Promise<GetMetroPositionsResponse> {
  if (!lineCode) {
    throw new Error('lineCode is required');
  }

  const url = `${API_BASE}/metro/lines/${encodeURIComponent(lineCode)}`;
  const response = await fetchWithRetry(url, undefined, LOG_PREFIX);

  if (!response.ok) {
    const errorMessage = await parseErrorResponse(response);
    throw new Error(errorMessage);
  }

  return response.json();
}
