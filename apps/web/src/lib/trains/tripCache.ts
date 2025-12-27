/**
 * Trip details cache for predictive positioning
 *
 * Caches TripDetails responses to avoid redundant API calls.
 * Uses TTL-based expiration and supports concurrent request deduplication.
 *
 * Phase 3, Task T015
 */

import type { TripDetails } from '../../types/trains';
import { fetchTripDetails } from '../api/trains';

/**
 * Cache entry with metadata
 */
interface CacheEntry {
  /** Cached trip details */
  data: TripDetails;
  /** Timestamp when data was fetched */
  fetchedAt: number;
  /** Timestamp when entry expires */
  expiresAt: number;
}

/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
  /** Number of cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
  /** Current cache size */
  size: number;
  /** Hit rate (0-1) */
  hitRate: number;
  /** Number of in-flight requests */
  pendingRequests: number;
}

/**
 * Configuration for the trip cache
 */
export interface TripCacheConfig {
  /** Time-to-live in milliseconds (default: 10 minutes) */
  ttlMs: number;
  /** Maximum cache size (default: 200 entries) */
  maxSize: number;
  /** Whether to log cache operations (default: false) */
  debug: boolean;
}

const DEFAULT_CONFIG: TripCacheConfig = {
  ttlMs: 10 * 60 * 1000, // 10 minutes
  maxSize: 200,
  debug: false,
};

/**
 * In-memory cache for TripDetails with TTL expiration
 *
 * Features:
 * - TTL-based expiration
 * - Concurrent request deduplication (same tripId only fetched once)
 * - LRU-style eviction when max size reached
 * - Statistics tracking
 *
 * @example
 * ```typescript
 * const cache = new TripCache();
 *
 * // Get with automatic fetch on miss
 * const trip = await cache.getOrFetch('trip_123');
 *
 * // Check cache statistics
 * console.log(cache.getStats());
 * ```
 */
export class TripCache {
  private cache = new Map<string, CacheEntry>();
  private pendingRequests = new Map<string, Promise<TripDetails>>();
  private config: TripCacheConfig;

  // Statistics
  private hits = 0;
  private misses = 0;

  constructor(config: Partial<TripCacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get cached trip details if available and not expired
   *
   * @param tripId - GTFS trip identifier
   * @returns Cached TripDetails or null if not in cache/expired
   */
  get(tripId: string): TripDetails | null {
    const entry = this.cache.get(tripId);

    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(tripId);
      if (this.config.debug) {
        console.log(`TripCache: Entry expired for ${tripId}`);
      }
      return null;
    }

    this.hits++;
    if (this.config.debug) {
      console.log(`TripCache: Cache hit for ${tripId}`);
    }
    return entry.data;
  }

  /**
   * Get trip details from cache or fetch from API
   *
   * Handles concurrent requests - if multiple callers request the same
   * tripId simultaneously, only one API call is made.
   *
   * @param tripId - GTFS trip identifier
   * @returns TripDetails (from cache or freshly fetched)
   * @throws Error if fetch fails
   */
  async getOrFetch(tripId: string): Promise<TripDetails> {
    // Check cache first
    const cached = this.get(tripId);
    if (cached) {
      return cached;
    }

    // Check if there's already a pending request for this tripId
    const pending = this.pendingRequests.get(tripId);
    if (pending) {
      if (this.config.debug) {
        console.log(`TripCache: Joining pending request for ${tripId}`);
      }
      return pending;
    }

    // Fetch from API
    this.misses++;
    if (this.config.debug) {
      console.log(`TripCache: Cache miss, fetching ${tripId}`);
    }

    const fetchPromise = this.fetchAndCache(tripId);
    this.pendingRequests.set(tripId, fetchPromise);

    try {
      const result = await fetchPromise;
      return result;
    } finally {
      this.pendingRequests.delete(tripId);
    }
  }

  /**
   * Prefetch trip details without blocking
   *
   * Useful for warming the cache for trains that might be clicked.
   *
   * @param tripId - GTFS trip identifier
   */
  prefetch(tripId: string): void {
    // Skip if already cached or pending
    if (this.cache.has(tripId) || this.pendingRequests.has(tripId)) {
      return;
    }

    if (this.config.debug) {
      console.log(`TripCache: Prefetching ${tripId}`);
    }

    // Fire and forget - errors are logged but not thrown
    this.getOrFetch(tripId).catch((error) => {
      console.warn(`TripCache: Prefetch failed for ${tripId}:`, error);
    });
  }

  /**
   * Prefetch multiple trip details
   *
   * @param tripIds - Array of GTFS trip identifiers
   */
  prefetchMany(tripIds: string[]): void {
    for (const tripId of tripIds) {
      this.prefetch(tripId);
    }
  }

  /**
   * Invalidate a specific cache entry
   *
   * @param tripId - GTFS trip identifier to invalidate
   */
  invalidate(tripId: string): void {
    this.cache.delete(tripId);
    if (this.config.debug) {
      console.log(`TripCache: Invalidated ${tripId}`);
    }
  }

  /**
   * Clear the entire cache
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    if (this.config.debug) {
      console.log('TripCache: Cache cleared');
    }
  }

  /**
   * Get cache statistics
   *
   * @returns Current cache statistics
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      hitRate: total > 0 ? this.hits / total : 0,
      pendingRequests: this.pendingRequests.size,
    };
  }

  /**
   * Check if a tripId is currently being fetched
   *
   * @param tripId - GTFS trip identifier
   * @returns True if fetch is in progress
   */
  isPending(tripId: string): boolean {
    return this.pendingRequests.has(tripId);
  }

  /**
   * Check if a tripId is in cache (not expired)
   *
   * @param tripId - GTFS trip identifier
   * @returns True if in cache and not expired
   */
  has(tripId: string): boolean {
    const entry = this.cache.get(tripId);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(tripId);
      return false;
    }
    return true;
  }

  /**
   * Fetch trip details and store in cache
   */
  private async fetchAndCache(tripId: string): Promise<TripDetails> {
    const data = await fetchTripDetails(tripId);
    const now = Date.now();

    // Evict oldest entries if at max size
    this.evictIfNeeded();

    // Store in cache
    this.cache.set(tripId, {
      data,
      fetchedAt: now,
      expiresAt: now + this.config.ttlMs,
    });

    if (this.config.debug) {
      console.log(`TripCache: Cached ${tripId}, expires in ${this.config.ttlMs / 1000}s`);
    }

    return data;
  }

  /**
   * Evict oldest entries if cache is at max size
   */
  private evictIfNeeded(): void {
    if (this.cache.size < this.config.maxSize) {
      return;
    }

    // Find and remove oldest entry
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.fetchedAt < oldestTime) {
        oldestTime = entry.fetchedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      if (this.config.debug) {
        console.log(`TripCache: Evicted oldest entry ${oldestKey}`);
      }
    }
  }
}

/**
 * Singleton instance for global use
 */
let globalCache: TripCache | null = null;

/**
 * Get the global TripCache instance
 *
 * @param config - Optional configuration (only used on first call)
 * @returns Global TripCache instance
 */
export function getTripCache(config?: Partial<TripCacheConfig>): TripCache {
  if (!globalCache) {
    globalCache = new TripCache(config);
  }
  return globalCache;
}

/**
 * Reset the global cache (useful for testing)
 */
export function resetTripCache(): void {
  globalCache?.clear();
  globalCache = null;
}
