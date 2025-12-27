/**
 * Unit tests for station parking system
 *
 * Tests:
 * - Perpendicular offset calculations
 * - Slot assignment distribution
 * - Parking position calculations
 * - Cache behavior
 * - Edge cases
 *
 * Phase 2, Task T013
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSlotIndex,
  slotIndexToOffset,
  calculateAlongTrackOffset,
  getStationTrackBearing,
  calculateParkingPosition,
  getCachedParkingPosition,
  invalidateParkingCache,
  invalidateAllParkingCacheForTrain,
  clearParkingCache,
  getParkingCacheStats,
  calculateZoomAdjustedSpacing,
  DEFAULT_PARKING_CONFIG,
} from './stationParking';
import { preprocessRailwayLine, type PreprocessedRailwayLine } from './geometry';

// Create a mock railway line for testing
function createMockRailwayLine(): PreprocessedRailwayLine {
  const geometry = {
    type: 'LineString' as const,
    coordinates: [
      [2.170, 41.380] as [number, number], // Start point
      [2.175, 41.385] as [number, number], // End point (roughly northeast direction)
    ],
  };

  const preprocessed = preprocessRailwayLine(geometry);
  if (!preprocessed) {
    throw new Error('Failed to create mock railway line');
  }
  return preprocessed;
}

describe('stationParking', () => {
  beforeEach(() => {
    // Clear cache before each test
    clearParkingCache();
  });

  describe('getSlotIndex', () => {
    it('should return consistent slot index for same trainId', () => {
      const slot1 = getSlotIndex('train_123', 5);
      const slot2 = getSlotIndex('train_123', 5);
      expect(slot1).toBe(slot2);
    });

    it('should return index within maxSlots range', () => {
      const testIds = ['train_1', 'train_2', 'train_abc', 'train_xyz', 'long_train_id_12345'];
      for (const id of testIds) {
        const slot = getSlotIndex(id, 5);
        expect(slot).toBeGreaterThanOrEqual(0);
        expect(slot).toBeLessThan(5);
      }
    });

    it('should distribute slots across different trainIds', () => {
      // Generate many train IDs and check distribution
      const slots = new Map<number, number>();
      for (let i = 0; i < 1000; i++) {
        const slot = getSlotIndex(`train_${i}`, 5);
        slots.set(slot, (slots.get(slot) || 0) + 1);
      }

      // All 5 slots should be used
      expect(slots.size).toBe(5);

      // Each slot should have roughly 200 trains (within reasonable variance)
      for (const count of slots.values()) {
        expect(count).toBeGreaterThan(100); // At least 10% of expected
        expect(count).toBeLessThan(300); // At most 30% more than expected
      }
    });

    it('should handle different maxSlots values', () => {
      expect(getSlotIndex('train_1', 3)).toBeLessThan(3);
      expect(getSlotIndex('train_1', 7)).toBeLessThan(7);
      expect(getSlotIndex('train_1', 10)).toBeLessThan(10);
    });

    it('should handle empty string trainId', () => {
      const slot = getSlotIndex('', 5);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(5);
    });
  });

  describe('slotIndexToOffset', () => {
    it('should convert slot index to centered offset for 5 slots', () => {
      // 5 slots: 0→-2, 1→-1, 2→0, 3→1, 4→2
      expect(slotIndexToOffset(0, 5)).toBe(-2);
      expect(slotIndexToOffset(1, 5)).toBe(-1);
      expect(slotIndexToOffset(2, 5)).toBe(0);
      expect(slotIndexToOffset(3, 5)).toBe(1);
      expect(slotIndexToOffset(4, 5)).toBe(2);
    });

    it('should convert slot index to centered offset for 3 slots', () => {
      // 3 slots: 0→-1, 1→0, 2→1
      expect(slotIndexToOffset(0, 3)).toBe(-1);
      expect(slotIndexToOffset(1, 3)).toBe(0);
      expect(slotIndexToOffset(2, 3)).toBe(1);
    });

    it('should handle even number of slots', () => {
      // 4 slots: 0→-2, 1→-1, 2→0, 3→1
      expect(slotIndexToOffset(0, 4)).toBe(-2);
      expect(slotIndexToOffset(1, 4)).toBe(-1);
      expect(slotIndexToOffset(2, 4)).toBe(0);
      expect(slotIndexToOffset(3, 4)).toBe(1);
    });
  });

  describe('calculateAlongTrackOffset', () => {
    it('should return same position for zero offset', () => {
      const coords: [number, number] = [2.173, 41.385];
      const result = calculateAlongTrackOffset(coords, 45, 0);
      expect(result[0]).toBe(coords[0]);
      expect(result[1]).toBe(coords[1]);
    });

    it('should offset along north-facing bearing (0°)', () => {
      // Bearing 0° (North) → offset should move north (+lat)
      const coords: [number, number] = [2.173, 41.385];
      const result = calculateAlongTrackOffset(coords, 0, 100);

      // Should move north (positive latitude)
      expect(result[1]).toBeGreaterThan(coords[1]);
      // Longitude should be roughly the same
      expect(Math.abs(result[0] - coords[0])).toBeLessThan(0.0001);
    });

    it('should offset along east-facing bearing (90°)', () => {
      // Bearing 90° (East) → offset should move east (+lng)
      const coords: [number, number] = [2.173, 41.385];
      const result = calculateAlongTrackOffset(coords, 90, 100);

      // Should move east (positive longitude)
      expect(result[0]).toBeGreaterThan(coords[0]);
      // Latitude should be roughly the same
      expect(Math.abs(result[1] - coords[1])).toBeLessThan(0.0001);
    });

    it('should offset in opposite direction for negative offset', () => {
      const coords: [number, number] = [2.173, 41.385];
      const positive = calculateAlongTrackOffset(coords, 0, 100);
      const negative = calculateAlongTrackOffset(coords, 0, -100);

      // Positive offset goes north (greater latitude)
      // Negative offset should go south (lesser latitude)
      expect(positive[1]).toBeGreaterThan(coords[1]);
      expect(negative[1]).toBeLessThan(coords[1]);
    });

    it('should scale offset distance correctly', () => {
      const coords: [number, number] = [2.173, 41.385];
      const offset50 = calculateAlongTrackOffset(coords, 0, 50);
      const offset100 = calculateAlongTrackOffset(coords, 0, 100);

      // 100m offset should be roughly twice as far as 50m
      const dist50 = offset50[1] - coords[1];
      const dist100 = offset100[1] - coords[1];
      expect(dist100).toBeCloseTo(dist50 * 2, 5);
    });

    it('should handle all cardinal directions', () => {
      const coords: [number, number] = [0, 0]; // Use origin for simpler math

      // North (0°) → offset along bearing moves north (+lat)
      const north = calculateAlongTrackOffset(coords, 0, 100);
      expect(north[1]).toBeGreaterThan(0);

      // South (180°) → offset along bearing moves south (-lat)
      const south = calculateAlongTrackOffset(coords, 180, 100);
      expect(south[1]).toBeLessThan(0);

      // East (90°) → offset along bearing moves east (+lng)
      const east = calculateAlongTrackOffset(coords, 90, 100);
      expect(east[0]).toBeGreaterThan(0);

      // West (270°) → offset along bearing moves west (-lng)
      const west = calculateAlongTrackOffset(coords, 270, 100);
      expect(west[0]).toBeLessThan(0);
    });
  });

  describe('getStationTrackBearing', () => {
    it('should return bearing when station is on railway line', () => {
      const railway = createMockRailwayLine();
      // Use a point on the line
      const stationCoords: [number, number] = [2.1725, 41.3825];

      const bearing = getStationTrackBearing(stationCoords, railway);
      expect(bearing).not.toBeNull();
      expect(bearing).toBeGreaterThanOrEqual(0);
      expect(bearing).toBeLessThan(360);
    });

    it('should return null for station too far from railway', () => {
      const railway = createMockRailwayLine();
      // Use a point far from the line
      const stationCoords: [number, number] = [3.0, 42.0];

      const bearing = getStationTrackBearing(stationCoords, railway);
      expect(bearing).toBeNull();
    });
  });

  describe('calculateZoomAdjustedSpacing', () => {
    it('should return base spacing at reference zoom', () => {
      const spacing = calculateZoomAdjustedSpacing(20, 14, DEFAULT_PARKING_CONFIG);
      expect(spacing).toBe(20);
    });

    it('should increase spacing above reference zoom', () => {
      const spacing = calculateZoomAdjustedSpacing(20, 16, DEFAULT_PARKING_CONFIG);
      expect(spacing).toBeGreaterThan(20);
    });

    it('should decrease spacing below reference zoom', () => {
      const spacing = calculateZoomAdjustedSpacing(20, 12, DEFAULT_PARKING_CONFIG);
      expect(spacing).toBeLessThan(20);
    });

    it('should not go below 50% of base spacing', () => {
      // Very low zoom
      const spacing = calculateZoomAdjustedSpacing(20, 1, DEFAULT_PARKING_CONFIG);
      expect(spacing).toBeGreaterThanOrEqual(10);
    });
  });

  describe('calculateParkingPosition', () => {
    it('should calculate parking position for station on railway', () => {
      const railway = createMockRailwayLine();
      const stationCoords: [number, number] = [2.1725, 41.3825];

      const parking = calculateParkingPosition(
        'STATION_1',
        'train_123',
        stationCoords,
        railway
      );

      expect(parking).not.toBeNull();
      expect(parking!.position).toHaveLength(2);
      expect(parking!.trackBearing).toBeGreaterThanOrEqual(0);
      expect(parking!.parkingBearing).toBeGreaterThanOrEqual(0);
      // Parking bearing should be 90° from track bearing
      const expectedParkingBearing = (parking!.trackBearing + 90) % 360;
      expect(parking!.parkingBearing).toBeCloseTo(expectedParkingBearing, 1);
      expect(parking!.slotIndex).toBeGreaterThanOrEqual(0);
      expect(parking!.slotIndex).toBeLessThan(5);
    });

    it('should return null for station not on railway', () => {
      const railway = createMockRailwayLine();
      const stationCoords: [number, number] = [3.0, 42.0]; // Far from railway

      const parking = calculateParkingPosition(
        'STATION_FAR',
        'train_123',
        stationCoords,
        railway
      );

      expect(parking).toBeNull();
    });

    it('should assign same slot to same train', () => {
      const railway = createMockRailwayLine();
      const stationCoords: [number, number] = [2.1725, 41.3825];

      const parking1 = calculateParkingPosition(
        'STATION_1',
        'train_123',
        stationCoords,
        railway
      );
      const parking2 = calculateParkingPosition(
        'STATION_1',
        'train_123',
        stationCoords,
        railway
      );

      expect(parking1!.slotIndex).toBe(parking2!.slotIndex);
      expect(parking1!.slotOffset).toBe(parking2!.slotOffset);
    });

    it('should assign different slots to different trains', () => {
      const railway = createMockRailwayLine();
      const stationCoords: [number, number] = [2.1725, 41.3825];

      // Find two trains that get different slots
      let train1Slot = -1;
      let train2Slot = -1;
      let train2Id = '';

      const parking1 = calculateParkingPosition(
        'STATION_1',
        'train_a',
        stationCoords,
        railway
      );
      train1Slot = parking1!.slotIndex;

      // Find a train with different slot
      for (let i = 0; i < 100; i++) {
        const testId = `train_${i}`;
        const testParking = calculateParkingPosition(
          'STATION_1',
          testId,
          stationCoords,
          railway
        );
        if (testParking!.slotIndex !== train1Slot) {
          train2Slot = testParking!.slotIndex;
          train2Id = testId;
          break;
        }
      }

      expect(train2Id).not.toBe('');
      expect(train2Slot).not.toBe(train1Slot);
    });

    it('should apply zoom-adjusted spacing', () => {
      const railway = createMockRailwayLine();
      const stationCoords: [number, number] = [2.1725, 41.3825];

      const lowZoom = calculateParkingPosition(
        'STATION_1',
        'train_123',
        stationCoords,
        railway,
        DEFAULT_PARKING_CONFIG,
        10
      );

      const highZoom = calculateParkingPosition(
        'STATION_1',
        'train_123',
        stationCoords,
        railway,
        DEFAULT_PARKING_CONFIG,
        18
      );

      // Same slot, but different offset distance
      expect(lowZoom!.slotIndex).toBe(highZoom!.slotIndex);
      // Offset at high zoom should be larger
      if (lowZoom!.slotOffset !== 0) {
        expect(Math.abs(highZoom!.offsetMeters)).toBeGreaterThan(Math.abs(lowZoom!.offsetMeters));
      }
    });
  });

  describe('parking cache', () => {
    it('should cache parking positions', () => {
      const railway = createMockRailwayLine();
      const stationCoords: [number, number] = [2.1725, 41.3825];

      // First call - cache miss
      const parking1 = getCachedParkingPosition(
        'STATION_1',
        'train_123',
        stationCoords,
        railway
      );

      // Second call - cache hit
      const parking2 = getCachedParkingPosition(
        'STATION_1',
        'train_123',
        stationCoords,
        railway
      );

      expect(parking1).toEqual(parking2);

      const stats = getParkingCacheStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.size).toBe(1);
    });

    it('should track cache hit rate', () => {
      const railway = createMockRailwayLine();
      const stationCoords: [number, number] = [2.1725, 41.3825];

      // 1 miss
      getCachedParkingPosition('S1', 't1', stationCoords, railway);

      // 3 hits
      getCachedParkingPosition('S1', 't1', stationCoords, railway);
      getCachedParkingPosition('S1', 't1', stationCoords, railway);
      getCachedParkingPosition('S1', 't1', stationCoords, railway);

      const stats = getParkingCacheStats();
      expect(stats.hitRate).toBeCloseTo(0.75, 2);
    });

    it('should invalidate specific cache entry', () => {
      const railway = createMockRailwayLine();
      const stationCoords: [number, number] = [2.1725, 41.3825];

      // Cache entries
      getCachedParkingPosition('S1', 't1', stationCoords, railway);
      getCachedParkingPosition('S1', 't2', stationCoords, railway);

      expect(getParkingCacheStats().size).toBe(2);

      // Invalidate one
      invalidateParkingCache('S1', 't1');

      expect(getParkingCacheStats().size).toBe(1);

      // Next call should be a miss
      getCachedParkingPosition('S1', 't1', stationCoords, railway);
      const stats = getParkingCacheStats();
      expect(stats.misses).toBe(3); // Original 2 + new miss
    });

    it('should invalidate all entries for a train', () => {
      const railway = createMockRailwayLine();
      const stationCoords: [number, number] = [2.1725, 41.3825];

      // Cache entries for same train at different stations
      getCachedParkingPosition('S1', 't1', stationCoords, railway);
      getCachedParkingPosition('S2', 't1', stationCoords, railway);
      getCachedParkingPosition('S1', 't2', stationCoords, railway);

      expect(getParkingCacheStats().size).toBe(3);

      // Invalidate all for t1
      invalidateAllParkingCacheForTrain('t1');

      // Only t2 entry should remain
      expect(getParkingCacheStats().size).toBe(1);
    });

    it('should clear entire cache', () => {
      const railway = createMockRailwayLine();
      const stationCoords: [number, number] = [2.1725, 41.3825];

      getCachedParkingPosition('S1', 't1', stationCoords, railway);
      getCachedParkingPosition('S1', 't2', stationCoords, railway);

      clearParkingCache();

      const stats = getParkingCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });
  });

  describe('DEFAULT_PARKING_CONFIG', () => {
    it('should have expected default values', () => {
      expect(DEFAULT_PARKING_CONFIG.maxSlots).toBe(5);
      expect(DEFAULT_PARKING_CONFIG.baseSpacingMeters).toBe(20);
      expect(DEFAULT_PARKING_CONFIG.referenceZoom).toBe(14);
      expect(DEFAULT_PARKING_CONFIG.zoomScaleFactor).toBe(0.1);
      expect(DEFAULT_PARKING_CONFIG.transitionDurationMs).toBe(500);
      expect(DEFAULT_PARKING_CONFIG.groupByLine).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle very small railway segments', () => {
      const geometry = {
        type: 'LineString' as const,
        coordinates: [
          [2.170, 41.380] as [number, number],
          [2.170001, 41.380001] as [number, number], // Very small segment
        ],
      };

      const preprocessed = preprocessRailwayLine(geometry);
      if (!preprocessed) {
        // Segment too small - this is acceptable
        return;
      }

      const bearing = getStationTrackBearing([2.170, 41.380], preprocessed);
      // Should either work or return null, not throw
      expect(typeof bearing === 'number' || bearing === null).toBe(true);
    });

    it('should handle station exactly at railway endpoint', () => {
      const railway = createMockRailwayLine();
      const stationCoords: [number, number] = [2.170, 41.380]; // Start of line

      const bearing = getStationTrackBearing(stationCoords, railway);
      expect(bearing).not.toBeNull();
    });

    it('should handle maxSlots of 1', () => {
      const slot = getSlotIndex('train_123', 1);
      expect(slot).toBe(0);

      const offset = slotIndexToOffset(0, 1);
      expect(offset).toBe(0);
    });

    it('should handle special characters in trainId', () => {
      const slot1 = getSlotIndex('train/123', 5);
      const slot2 = getSlotIndex('train:123', 5);
      const slot3 = getSlotIndex('train@123', 5);

      // All should be valid slot indices
      expect(slot1).toBeGreaterThanOrEqual(0);
      expect(slot2).toBeGreaterThanOrEqual(0);
      expect(slot3).toBeGreaterThanOrEqual(0);
    });
  });
});
