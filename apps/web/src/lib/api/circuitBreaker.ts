/**
 * Circuit Breaker Pattern Implementation
 *
 * Prevents hammering failed APIs by tracking consecutive failures
 * and temporarily blocking requests after a threshold is exceeded.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Circuit tripped, requests are immediately rejected
 * - HALF_OPEN: Testing if service recovered, one request allowed
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening circuit (default: 5) */
  failureThreshold: number;
  /** Time in ms before attempting to close circuit (default: 30000) */
  resetTimeoutMs: number;
  /** Name for logging purposes */
  name: string;
}

export interface CircuitBreakerStats {
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureTime: number | null;
  totalFailures: number;
  totalSuccesses: number;
}

const DEFAULT_CONFIG: Omit<CircuitBreakerConfig, 'name'> = {
  failureThreshold: 5,
  resetTimeoutMs: 30000, // 30 seconds
};

/**
 * Circuit Breaker for API endpoints
 *
 * @example
 * const breaker = new CircuitBreaker({ name: 'Train API' });
 *
 * async function fetchTrains() {
 *   breaker.checkState(); // Throws if circuit is open
 *   try {
 *     const result = await fetch('/api/trains');
 *     breaker.recordSuccess();
 *     return result;
 *   } catch (error) {
 *     breaker.recordFailure();
 *     throw error;
 *   }
 * }
 */
export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private lastFailureTime: number | null = null;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private readonly config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> & { name: string }) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if the circuit allows a request to pass through
   * Throws an error if the circuit is open
   */
  checkState(): void {
    if (this.state === 'CLOSED') {
      return;
    }

    if (this.state === 'OPEN') {
      // Check if reset timeout has elapsed
      const timeSinceFailure = Date.now() - (this.lastFailureTime ?? 0);
      if (timeSinceFailure >= this.config.resetTimeoutMs) {
        // Transition to half-open state
        this.state = 'HALF_OPEN';
        console.log(
          `[${this.config.name}] Circuit breaker transitioning to HALF_OPEN after ${Math.round(timeSinceFailure / 1000)}s`
        );
        return;
      }

      const remainingMs = this.config.resetTimeoutMs - timeSinceFailure;
      throw new CircuitOpenError(
        `${this.config.name} circuit is open. Retry in ${Math.round(remainingMs / 1000)}s`,
        remainingMs
      );
    }

    // HALF_OPEN: Allow one request through to test
  }

  /**
   * Record a successful request
   */
  recordSuccess(): void {
    this.totalSuccesses++;

    if (this.state === 'HALF_OPEN') {
      // Service recovered - close the circuit
      console.log(`[${this.config.name}] Circuit breaker CLOSED - service recovered`);
      this.state = 'CLOSED';
      this.consecutiveFailures = 0;
      this.lastFailureTime = null;
    } else if (this.state === 'CLOSED') {
      // Reset failure count on success
      this.consecutiveFailures = 0;
    }
  }

  /**
   * Record a failed request
   */
  recordFailure(): void {
    this.consecutiveFailures++;
    this.totalFailures++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      // Test request failed - reopen the circuit
      console.warn(
        `[${this.config.name}] Circuit breaker OPEN - test request failed`
      );
      this.state = 'OPEN';
      return;
    }

    if (
      this.state === 'CLOSED' &&
      this.consecutiveFailures >= this.config.failureThreshold
    ) {
      console.warn(
        `[${this.config.name}] Circuit breaker OPEN after ${this.consecutiveFailures} consecutive failures`
      );
      this.state = 'OPEN';
    }
  }

  /**
   * Get current circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      lastFailureTime: this.lastFailureTime,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
    };
  }

  /**
   * Check if the circuit is currently open
   */
  isOpen(): boolean {
    return this.state === 'OPEN';
  }

  /**
   * Manually reset the circuit breaker to closed state
   */
  reset(): void {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.lastFailureTime = null;
    console.log(`[${this.config.name}] Circuit breaker manually reset`);
  }
}

/**
 * Error thrown when circuit is open
 */
export class CircuitOpenError extends Error {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = 'CircuitOpenError';
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Global circuit breaker instances for each API
 */
const circuitBreakers = new Map<string, CircuitBreaker>();

/**
 * Get or create a circuit breaker for an API endpoint
 */
export function getCircuitBreaker(
  name: string,
  config?: Partial<Omit<CircuitBreakerConfig, 'name'>>
): CircuitBreaker {
  if (!circuitBreakers.has(name)) {
    circuitBreakers.set(name, new CircuitBreaker({ name, ...config }));
  }
  return circuitBreakers.get(name)!;
}

/**
 * Get all circuit breaker stats for monitoring
 */
export function getAllCircuitBreakerStats(): Record<string, CircuitBreakerStats> {
  const stats: Record<string, CircuitBreakerStats> = {};
  circuitBreakers.forEach((breaker, name) => {
    stats[name] = breaker.getStats();
  });
  return stats;
}
