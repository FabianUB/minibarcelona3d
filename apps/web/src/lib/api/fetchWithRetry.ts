/**
 * Shared HTTP fetch utilities with automatic retry logic
 *
 * Provides exponential backoff with jitter to prevent thundering herd
 * when multiple clients retry simultaneously after a server error.
 * Optionally integrates with circuit breaker to prevent hammering failed APIs.
 */

import { getCircuitBreaker, CircuitOpenError } from './circuitBreaker';

/**
 * Default request timeout in milliseconds (15 seconds)
 * Prevents hanging requests from blocking the UI indefinitely
 */
export const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Configuration for retry behavior
 */
export const RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 5000, // 5 seconds
  timeoutMs: DEFAULT_TIMEOUT_MS,
  shouldRetry: (status: number) => {
    // Retry on network errors and 5xx server errors
    // Don't retry on 4xx client errors (bad request, not found, etc.)
    return status >= 500 || status === 0;
  },
};

/**
 * Sleeps for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculates exponential backoff delay with jitter
 * Prevents thundering herd when multiple clients retry simultaneously
 */
export function getRetryDelay(attempt: number): number {
  const exponentialDelay = Math.min(
    RETRY_CONFIG.baseDelay * Math.pow(2, attempt - 1),
    RETRY_CONFIG.maxDelay
  );
  // Add random jitter (0-50% of delay)
  const jitter = Math.random() * exponentialDelay * 0.5;
  return exponentialDelay + jitter;
}

/**
 * Options for fetchWithRetry
 */
export interface FetchWithRetryOptions {
  /** Fetch request options */
  fetchOptions?: RequestInit;
  /** Prefix for log messages (e.g., "Metro API", "Train API") */
  logPrefix?: string;
  /** Request timeout in milliseconds (default: 15000) */
  timeoutMs?: number;
  /** Enable circuit breaker pattern (default: true for API calls) */
  useCircuitBreaker?: boolean;
}

// Re-export circuit breaker utilities for consumers
export { CircuitOpenError, getCircuitBreaker, getAllCircuitBreakerStats } from './circuitBreaker';

/**
 * Fetches with automatic retry on transient failures
 * Uses exponential backoff with jitter to prevent thundering herd
 *
 * @param url - URL to fetch
 * @param options - Fetch options (deprecated, use FetchWithRetryOptions)
 * @param logPrefix - Prefix for log messages (deprecated, use FetchWithRetryOptions)
 */
export async function fetchWithRetry(
  url: string,
  options?: RequestInit | FetchWithRetryOptions,
  logPrefix?: string
): Promise<Response> {
  // Handle both old and new API signatures for backwards compatibility
  let fetchOptions: RequestInit | undefined;
  let prefix: string;
  let timeoutMs: number;
  let useCircuitBreaker: boolean;

  if (options && 'fetchOptions' in options) {
    // New API: FetchWithRetryOptions object
    fetchOptions = options.fetchOptions;
    prefix = options.logPrefix ?? 'API';
    timeoutMs = options.timeoutMs ?? RETRY_CONFIG.timeoutMs;
    useCircuitBreaker = options.useCircuitBreaker ?? true;
  } else {
    // Old API: RequestInit + logPrefix
    fetchOptions = options as RequestInit | undefined;
    prefix = logPrefix ?? 'API';
    timeoutMs = RETRY_CONFIG.timeoutMs;
    useCircuitBreaker = true;
  }

  // Get circuit breaker for this API (identified by prefix)
  const circuitBreaker = useCircuitBreaker ? getCircuitBreaker(prefix) : null;

  // Check circuit breaker state before attempting request
  if (circuitBreaker) {
    try {
      circuitBreaker.checkState();
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        // Circuit is open - fail fast
        throw error;
      }
      throw error;
    }
  }

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= RETRY_CONFIG.maxAttempts; attempt++) {
    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Success or non-retryable error
      if (response.ok || !RETRY_CONFIG.shouldRetry(response.status)) {
        // Record success with circuit breaker
        if (circuitBreaker && response.ok) {
          circuitBreaker.recordSuccess();
        }
        return response;
      }

      // Server error - record failure and retry
      if (circuitBreaker) {
        circuitBreaker.recordFailure();
      }

      lastError = new Error(
        `HTTP ${response.status}: ${response.statusText}`
      );

      if (attempt < RETRY_CONFIG.maxAttempts) {
        const delay = getRetryDelay(attempt);
        console.warn(
          `${prefix} request failed (attempt ${attempt}/${RETRY_CONFIG.maxAttempts}): ${url}. Retrying in ${Math.round(delay)}ms...`
        );
        await sleep(delay);
      }
    } catch (error) {
      clearTimeout(timeoutId);

      // Handle timeout errors specifically
      if (error instanceof Error && error.name === 'AbortError') {
        lastError = new Error(`Request timed out after ${timeoutMs}ms`);
      } else {
        lastError = error instanceof Error ? error : new Error(String(error));
      }

      // Record failure with circuit breaker (but not for user aborts)
      if (circuitBreaker && !(error instanceof Error && error.name === 'AbortError' && fetchOptions?.signal?.aborted)) {
        circuitBreaker.recordFailure();
      }

      if (attempt < RETRY_CONFIG.maxAttempts) {
        const delay = getRetryDelay(attempt);
        console.warn(
          `${lastError.message.includes('timed out') ? 'Timeout' : 'Network'} error (attempt ${attempt}/${RETRY_CONFIG.maxAttempts}): ${lastError.message}. Retrying in ${Math.round(delay)}ms...`
        );
        await sleep(delay);
      }
    }
  }

  throw new Error(
    `${prefix} request failed after ${RETRY_CONFIG.maxAttempts} attempts: ${lastError?.message || 'Unknown error'}`
  );
}

/**
 * Parses error response from API
 * Attempts to extract error message from JSON response body
 */
export async function parseErrorResponse(response: Response): Promise<string> {
  try {
    const error = await response.json();
    return error.error || error.message || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}: ${response.statusText}`;
  }
}
