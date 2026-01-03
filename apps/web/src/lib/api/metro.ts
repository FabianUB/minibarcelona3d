/**
 * API client for Metro data endpoints
 * Handles HTTP requests to the Go backend API with retry logic
 *
 * Metro positions are estimated from iMetro arrival predictions,
 * not GPS coordinates. The poller computes positions by interpolating
 * along line geometry based on time-to-arrival.
 */

import type {
  GetMetroPositionsResponse,
  MetroApiError,
} from '../../types/metro';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

/**
 * Configuration for retry behavior
 */
const RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 5000, // 5 seconds
  shouldRetry: (status: number) => {
    // Retry on network errors and 5xx server errors
    // Don't retry on 4xx client errors (bad request, not found, etc.)
    return status >= 500 || status === 0;
  },
};

/**
 * Sleeps for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculates exponential backoff delay with jitter
 * Prevents thundering herd when multiple clients retry simultaneously
 */
function getRetryDelay(attempt: number): number {
  const exponentialDelay = Math.min(
    RETRY_CONFIG.baseDelay * Math.pow(2, attempt - 1),
    RETRY_CONFIG.maxDelay
  );
  // Add random jitter (0-50% of delay)
  const jitter = Math.random() * exponentialDelay * 0.5;
  return exponentialDelay + jitter;
}

/**
 * Fetches with automatic retry on transient failures
 * Uses exponential backoff with jitter to prevent thundering herd
 */
async function fetchWithRetry(
  url: string,
  options?: RequestInit
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= RETRY_CONFIG.maxAttempts; attempt++) {
    try {
      const response = await fetch(url, options);

      // Success or non-retryable error
      if (response.ok || !RETRY_CONFIG.shouldRetry(response.status)) {
        return response;
      }

      // Server error - retry
      lastError = new Error(
        `HTTP ${response.status}: ${response.statusText}`
      );

      if (attempt < RETRY_CONFIG.maxAttempts) {
        const delay = getRetryDelay(attempt);
        console.warn(
          `Metro API request failed (attempt ${attempt}/${RETRY_CONFIG.maxAttempts}): ${url}. Retrying in ${Math.round(delay)}ms...`
        );
        await sleep(delay);
      }
    } catch (error) {
      // Network error (no response)
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < RETRY_CONFIG.maxAttempts) {
        const delay = getRetryDelay(attempt);
        console.warn(
          `Network error (attempt ${attempt}/${RETRY_CONFIG.maxAttempts}): ${lastError.message}. Retrying in ${Math.round(delay)}ms...`
        );
        await sleep(delay);
      }
    }
  }

  throw new Error(
    `Metro API request failed after ${RETRY_CONFIG.maxAttempts} attempts: ${lastError?.message || 'Unknown error'}`
  );
}

/**
 * Parses error response from API
 */
async function parseErrorResponse(response: Response): Promise<string> {
  try {
    const error: MetroApiError = await response.json();
    return error.error;
  } catch {
    return `HTTP ${response.status}: ${response.statusText}`;
  }
}

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

  const response = await fetchWithRetry(url.toString());

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
  const response = await fetchWithRetry(url);

  if (!response.ok) {
    const errorMessage = await parseErrorResponse(response);
    throw new Error(errorMessage);
  }

  return response.json();
}
