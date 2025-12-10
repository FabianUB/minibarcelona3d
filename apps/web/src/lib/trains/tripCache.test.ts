/**
 * Unit tests for TripCache
 *
 * Phase 3, Task T018
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TripCache, getTripCache, resetTripCache } from './tripCache';
import type { TripDetails } from '../../types/trains';

// Mock the fetchTripDetails function
vi.mock('../api/trains', () => ({
  fetchTripDetails: vi.fn(),
}));

import { fetchTripDetails } from '../api/trains';

const mockFetchTripDetails = vi.mocked(fetchTripDetails);

// Sample trip details for testing
const createMockTripDetails = (tripId: string): TripDetails => ({
  tripId,
  routeId: 'R1_TEST',
  stopTimes: [
    {
      stopId: 'STOP_1',
      stopSequence: 1,
      stopName: 'First Stop',
      scheduledArrival: '08:00:00',
      scheduledDeparture: '08:01:00',
      predictedArrivalUtc: null,
      predictedDepartureUtc: null,
      arrivalDelaySeconds: 0,
      departureDelaySeconds: 0,
      scheduleRelationship: 'SCHEDULED',
    },
    {
      stopId: 'STOP_2',
      stopSequence: 2,
      stopName: 'Second Stop',
      scheduledArrival: '08:10:00',
      scheduledDeparture: '08:11:00',
      predictedArrivalUtc: null,
      predictedDepartureUtc: null,
      arrivalDelaySeconds: 60,
      departureDelaySeconds: 60,
      scheduleRelationship: 'SCHEDULED',
    },
  ],
  updatedAt: '2024-01-01T08:00:00Z',
});

describe('TripCache', () => {
  let cache: TripCache;

  beforeEach(() => {
    cache = new TripCache({ ttlMs: 1000, maxSize: 10 });
    mockFetchTripDetails.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetTripCache();
  });

  describe('get', () => {
    it('should return null for non-existent entries', () => {
      expect(cache.get('non_existent')).toBeNull();
    });

    it('should return cached data within TTL', async () => {
      const mockData = createMockTripDetails('trip_1');
      mockFetchTripDetails.mockResolvedValueOnce(mockData);

      // Fetch and cache
      await cache.getOrFetch('trip_1');

      // Should return from cache
      const cached = cache.get('trip_1');
      expect(cached).toEqual(mockData);
    });

    it('should return null for expired entries', async () => {
      const mockData = createMockTripDetails('trip_1');
      mockFetchTripDetails.mockResolvedValueOnce(mockData);

      // Fetch and cache
      await cache.getOrFetch('trip_1');

      // Advance time past TTL
      vi.advanceTimersByTime(1500);

      // Should return null (expired)
      const cached = cache.get('trip_1');
      expect(cached).toBeNull();
    });
  });

  describe('getOrFetch', () => {
    it('should fetch and cache on cache miss', async () => {
      const mockData = createMockTripDetails('trip_1');
      mockFetchTripDetails.mockResolvedValueOnce(mockData);

      const result = await cache.getOrFetch('trip_1');

      expect(result).toEqual(mockData);
      expect(mockFetchTripDetails).toHaveBeenCalledTimes(1);
      expect(mockFetchTripDetails).toHaveBeenCalledWith('trip_1');
    });

    it('should return cached data on cache hit', async () => {
      const mockData = createMockTripDetails('trip_1');
      mockFetchTripDetails.mockResolvedValueOnce(mockData);

      // First call - fetches
      await cache.getOrFetch('trip_1');

      // Second call - should use cache
      const result = await cache.getOrFetch('trip_1');

      expect(result).toEqual(mockData);
      expect(mockFetchTripDetails).toHaveBeenCalledTimes(1);
    });

    it('should deduplicate concurrent requests for same tripId', async () => {
      const mockData = createMockTripDetails('trip_1');
      mockFetchTripDetails.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(mockData), 100))
      );

      // Start multiple concurrent requests
      const promise1 = cache.getOrFetch('trip_1');
      const promise2 = cache.getOrFetch('trip_1');
      const promise3 = cache.getOrFetch('trip_1');

      // Advance timers to complete the fetch
      vi.advanceTimersByTime(100);

      const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);

      // All should get same data
      expect(result1).toEqual(mockData);
      expect(result2).toEqual(mockData);
      expect(result3).toEqual(mockData);

      // But only one fetch should have been made
      expect(mockFetchTripDetails).toHaveBeenCalledTimes(1);
    });

    it('should refetch after TTL expiry', async () => {
      const mockData1 = createMockTripDetails('trip_1');
      const mockData2 = { ...createMockTripDetails('trip_1'), updatedAt: '2024-01-01T09:00:00Z' };

      mockFetchTripDetails
        .mockResolvedValueOnce(mockData1)
        .mockResolvedValueOnce(mockData2);

      // First fetch
      const result1 = await cache.getOrFetch('trip_1');
      expect(result1).toEqual(mockData1);

      // Advance past TTL
      vi.advanceTimersByTime(1500);

      // Should refetch
      const result2 = await cache.getOrFetch('trip_1');
      expect(result2).toEqual(mockData2);
      expect(mockFetchTripDetails).toHaveBeenCalledTimes(2);
    });

    it('should propagate fetch errors', async () => {
      mockFetchTripDetails.mockRejectedValueOnce(new Error('Network error'));

      await expect(cache.getOrFetch('trip_1')).rejects.toThrow('Network error');
    });
  });

  describe('prefetch', () => {
    it('should fetch without blocking', async () => {
      const mockData = createMockTripDetails('trip_1');
      mockFetchTripDetails.mockResolvedValueOnce(mockData);

      // Prefetch doesn't return a promise we need to await
      cache.prefetch('trip_1');

      // But fetch should have been called
      expect(mockFetchTripDetails).toHaveBeenCalledWith('trip_1');
    });

    it('should skip if already cached', async () => {
      const mockData = createMockTripDetails('trip_1');
      mockFetchTripDetails.mockResolvedValueOnce(mockData);

      // First fetch
      await cache.getOrFetch('trip_1');

      // Reset mock
      mockFetchTripDetails.mockClear();

      // Prefetch should skip
      cache.prefetch('trip_1');
      expect(mockFetchTripDetails).not.toHaveBeenCalled();
    });

    it('should skip if already pending', async () => {
      const mockData = createMockTripDetails('trip_1');
      mockFetchTripDetails.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(mockData), 100))
      );

      // Start a fetch
      cache.getOrFetch('trip_1');

      // Prefetch should skip (already pending)
      cache.prefetch('trip_1');

      // Only one fetch should have been made
      expect(mockFetchTripDetails).toHaveBeenCalledTimes(1);
    });
  });

  describe('prefetchMany', () => {
    it('should prefetch multiple trips', async () => {
      mockFetchTripDetails.mockImplementation((tripId) =>
        Promise.resolve(createMockTripDetails(tripId))
      );

      cache.prefetchMany(['trip_1', 'trip_2', 'trip_3']);

      expect(mockFetchTripDetails).toHaveBeenCalledTimes(3);
    });
  });

  describe('invalidate', () => {
    it('should remove entry from cache', async () => {
      const mockData = createMockTripDetails('trip_1');
      mockFetchTripDetails.mockResolvedValueOnce(mockData);

      // Cache it
      await cache.getOrFetch('trip_1');
      expect(cache.has('trip_1')).toBe(true);

      // Invalidate
      cache.invalidate('trip_1');
      expect(cache.has('trip_1')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all entries', async () => {
      mockFetchTripDetails.mockImplementation((tripId) =>
        Promise.resolve(createMockTripDetails(tripId))
      );

      // Cache multiple
      await cache.getOrFetch('trip_1');
      await cache.getOrFetch('trip_2');

      expect(cache.has('trip_1')).toBe(true);
      expect(cache.has('trip_2')).toBe(true);

      // Clear
      cache.clear();

      expect(cache.has('trip_1')).toBe(false);
      expect(cache.has('trip_2')).toBe(false);
    });

    it('should reset statistics', async () => {
      const mockData = createMockTripDetails('trip_1');
      mockFetchTripDetails.mockResolvedValueOnce(mockData);

      await cache.getOrFetch('trip_1');
      await cache.getOrFetch('trip_1'); // Cache hit

      const statsBefore = cache.getStats();
      expect(statsBefore.hits).toBe(1);
      expect(statsBefore.misses).toBe(1);

      cache.clear();

      const statsAfter = cache.getStats();
      expect(statsAfter.hits).toBe(0);
      expect(statsAfter.misses).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should track hits and misses', async () => {
      const mockData = createMockTripDetails('trip_1');
      mockFetchTripDetails.mockResolvedValue(mockData);

      // Miss
      await cache.getOrFetch('trip_1');

      // Hit
      await cache.getOrFetch('trip_1');

      // Another miss
      await cache.getOrFetch('trip_2');

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(2);
      expect(stats.hitRate).toBeCloseTo(1 / 3);
      expect(stats.size).toBe(2);
    });

    it('should return 0 hit rate when no requests', () => {
      const stats = cache.getStats();
      expect(stats.hitRate).toBe(0);
    });
  });

  describe('has', () => {
    it('should return true for cached entries', async () => {
      const mockData = createMockTripDetails('trip_1');
      mockFetchTripDetails.mockResolvedValueOnce(mockData);

      await cache.getOrFetch('trip_1');
      expect(cache.has('trip_1')).toBe(true);
    });

    it('should return false for non-existent entries', () => {
      expect(cache.has('non_existent')).toBe(false);
    });

    it('should return false for expired entries', async () => {
      const mockData = createMockTripDetails('trip_1');
      mockFetchTripDetails.mockResolvedValueOnce(mockData);

      await cache.getOrFetch('trip_1');

      // Advance past TTL
      vi.advanceTimersByTime(1500);

      expect(cache.has('trip_1')).toBe(false);
    });
  });

  describe('isPending', () => {
    it('should return true while fetch is in progress', async () => {
      const mockData = createMockTripDetails('trip_1');
      mockFetchTripDetails.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(mockData), 100))
      );

      // Start fetch
      const promise = cache.getOrFetch('trip_1');

      expect(cache.isPending('trip_1')).toBe(true);

      // Complete fetch
      vi.advanceTimersByTime(100);
      await promise;

      expect(cache.isPending('trip_1')).toBe(false);
    });
  });

  describe('eviction', () => {
    it('should evict oldest entry when max size reached', async () => {
      const smallCache = new TripCache({ ttlMs: 10000, maxSize: 3 });
      mockFetchTripDetails.mockImplementation((tripId) =>
        Promise.resolve(createMockTripDetails(tripId))
      );

      // Fill cache
      await smallCache.getOrFetch('trip_1');
      vi.advanceTimersByTime(10);
      await smallCache.getOrFetch('trip_2');
      vi.advanceTimersByTime(10);
      await smallCache.getOrFetch('trip_3');

      expect(smallCache.getStats().size).toBe(3);

      // Add one more - should evict oldest (trip_1)
      vi.advanceTimersByTime(10);
      await smallCache.getOrFetch('trip_4');

      expect(smallCache.getStats().size).toBe(3);
      expect(smallCache.has('trip_1')).toBe(false);
      expect(smallCache.has('trip_2')).toBe(true);
      expect(smallCache.has('trip_3')).toBe(true);
      expect(smallCache.has('trip_4')).toBe(true);
    });
  });
});

describe('getTripCache', () => {
  afterEach(() => {
    resetTripCache();
  });

  it('should return singleton instance', () => {
    const cache1 = getTripCache();
    const cache2 = getTripCache();
    expect(cache1).toBe(cache2);
  });

  it('should use config on first call', () => {
    const cache = getTripCache({ debug: true });
    expect(cache).toBeDefined();
  });
});

describe('resetTripCache', () => {
  it('should create new instance after reset', () => {
    const cache1 = getTripCache();
    resetTripCache();
    const cache2 = getTripCache();
    expect(cache1).not.toBe(cache2);
  });
});
