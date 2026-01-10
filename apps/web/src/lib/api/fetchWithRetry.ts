/**
 * Shared HTTP fetch utilities with automatic retry logic
 *
 * Provides exponential backoff with jitter to prevent thundering herd
 * when multiple clients retry simultaneously after a server error.
 */

/**
 * Configuration for retry behavior
 */
export const RETRY_CONFIG = {
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
 * Fetches with automatic retry on transient failures
 * Uses exponential backoff with jitter to prevent thundering herd
 *
 * @param url - URL to fetch
 * @param options - Fetch options
 * @param logPrefix - Prefix for log messages (e.g., "Metro API", "Train API")
 */
export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  logPrefix: string = 'API'
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
          `${logPrefix} request failed (attempt ${attempt}/${RETRY_CONFIG.maxAttempts}): ${url}. Retrying in ${Math.round(delay)}ms...`
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
    `${logPrefix} request failed after ${RETRY_CONFIG.maxAttempts} attempts: ${lastError?.message || 'Unknown error'}`
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
