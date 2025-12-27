/**
 * Unit tests for LineResolver implementations
 *
 * Tests:
 * - RouteId parsing for various formats
 * - Station-line membership checks
 * - Bearing lookups
 * - Edge cases (invalid routeId, unknown station)
 *
 * Phase 0, Task T000d
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RodaliesLineResolver } from './lineResolver';
import type { TrainPosition } from '../../types/trains';

describe('RodaliesLineResolver', () => {
  let resolver: RodaliesLineResolver;

  beforeEach(() => {
    resolver = new RodaliesLineResolver();
  });

  describe('resolveLineId', () => {
    it('should extract line ID from standard routeId format', () => {
      const train: TrainPosition = {
        vehicleKey: 'test-1',
        routeId: 'R1_MOLINS_MACANET',
        latitude: 41.5,
        longitude: 2.2,
        nextStopId: null,
        status: 'IN_TRANSIT_TO',
        polledAtUtc: '2025-12-07T10:00:00Z',
      };

      expect(resolver.resolveLineId(train)).toBe('R1');
    });

    it('should extract line ID from double-digit routes', () => {
      const train: TrainPosition = {
        vehicleKey: 'test-2',
        routeId: 'R11_PORTBOU_BARCELONA',
        latitude: 41.5,
        longitude: 2.2,
        nextStopId: null,
        status: 'IN_TRANSIT_TO',
        polledAtUtc: '2025-12-07T10:00:00Z',
      };

      expect(resolver.resolveLineId(train)).toBe('R11');
    });

    it('should extract line ID with underscores in route name', () => {
      const train: TrainPosition = {
        vehicleKey: 'test-3',
        routeId: 'R2_SANT_VICENC_GRANOLLERS',
        latitude: 41.5,
        longitude: 2.2,
        nextStopId: null,
        status: 'IN_TRANSIT_TO',
        polledAtUtc: '2025-12-07T10:00:00Z',
      };

      expect(resolver.resolveLineId(train)).toBe('R2');
    });

    it('should handle routeId with no underscores', () => {
      const train: TrainPosition = {
        vehicleKey: 'test-4',
        routeId: 'R3',
        latitude: 41.5,
        longitude: 2.2,
        nextStopId: null,
        status: 'IN_TRANSIT_TO',
        polledAtUtc: '2025-12-07T10:00:00Z',
      };

      expect(resolver.resolveLineId(train)).toBe('R3');
    });

    it('should return null for empty routeId', () => {
      const train: TrainPosition = {
        vehicleKey: 'test-5',
        routeId: '',
        latitude: 41.5,
        longitude: 2.2,
        nextStopId: null,
        status: 'IN_TRANSIT_TO',
        polledAtUtc: '2025-12-07T10:00:00Z',
      };

      expect(resolver.resolveLineId(train)).toBe(null);
    });

    it('should handle unusual line ID formats', () => {
      const train: TrainPosition = {
        vehicleKey: 'test-6',
        routeId: 'RT2_AEROPORT_BARCELONA',
        latitude: 41.5,
        longitude: 2.2,
        nextStopId: null,
        status: 'IN_TRANSIT_TO',
        polledAtUtc: '2025-12-07T10:00:00Z',
      };

      expect(resolver.resolveLineId(train)).toBe('RT2');
    });
  });

  describe('lineServesStation', () => {
    beforeEach(() => {
      // Populate test data
      resolver.setLineServesStation('R1', 'SANTS', true);
      resolver.setLineServesStation('R1', 'GRACIA', true);
      resolver.setLineServesStation('R2', 'SANTS', true);
      resolver.setLineServesStation('R2', 'CLOT', true);
    });

    it('should return true for line-station pairs that exist', () => {
      expect(resolver.lineServesStation('R1', 'SANTS')).toBe(true);
      expect(resolver.lineServesStation('R1', 'GRACIA')).toBe(true);
      expect(resolver.lineServesStation('R2', 'SANTS')).toBe(true);
      expect(resolver.lineServesStation('R2', 'CLOT')).toBe(true);
    });

    it('should return false for line-station pairs that do not exist', () => {
      expect(resolver.lineServesStation('R1', 'CLOT')).toBe(false);
      expect(resolver.lineServesStation('R2', 'GRACIA')).toBe(false);
      expect(resolver.lineServesStation('R3', 'SANTS')).toBe(false);
    });

    it('should return false for unknown lines', () => {
      expect(resolver.lineServesStation('R99', 'SANTS')).toBe(false);
    });

    it('should return false for unknown stations', () => {
      expect(resolver.lineServesStation('R1', 'UNKNOWN_STATION')).toBe(false);
    });

    it('should handle explicit false values', () => {
      resolver.setLineServesStation('R1', 'EXCLUDED', false);
      expect(resolver.lineServesStation('R1', 'EXCLUDED')).toBe(false);
    });
  });

  describe('getLineBearingAtStation', () => {
    beforeEach(() => {
      // Populate test bearing data
      resolver.setBearingAtStation('R1', 'SANTS', 45.5);
      resolver.setBearingAtStation('R1', 'GRACIA', 120.0);
      resolver.setBearingAtStation('R2', 'SANTS', 90.0);
      resolver.setBearingAtStation('R2', 'CLOT', 180.0);
    });

    it('should return correct bearing for line-station pairs', () => {
      expect(resolver.getLineBearingAtStation('R1', 'SANTS')).toBe(45.5);
      expect(resolver.getLineBearingAtStation('R1', 'GRACIA')).toBe(120.0);
      expect(resolver.getLineBearingAtStation('R2', 'SANTS')).toBe(90.0);
      expect(resolver.getLineBearingAtStation('R2', 'CLOT')).toBe(180.0);
    });

    it('should return 0 for unknown line-station pairs', () => {
      expect(resolver.getLineBearingAtStation('R1', 'CLOT')).toBe(0);
      expect(resolver.getLineBearingAtStation('R99', 'SANTS')).toBe(0);
      expect(resolver.getLineBearingAtStation('R1', 'UNKNOWN')).toBe(0);
    });

    it('should handle bearing of 0 degrees (North)', () => {
      resolver.setBearingAtStation('R3', 'NORTHBOUND', 0);
      expect(resolver.getLineBearingAtStation('R3', 'NORTHBOUND')).toBe(0);
    });

    it('should handle bearing of 359.9 degrees (near North)', () => {
      resolver.setBearingAtStation('R3', 'NEARLY_NORTH', 359.9);
      expect(resolver.getLineBearingAtStation('R3', 'NEARLY_NORTH')).toBe(359.9);
    });
  });

  describe('getCacheStats', () => {
    it('should return zero stats for empty caches', () => {
      const stats = resolver.getCacheStats();
      expect(stats.bearings).toBe(0);
      expect(stats.memberships).toBe(0);
    });

    it('should return correct stats after populating caches', () => {
      resolver.setBearingAtStation('R1', 'SANTS', 45);
      resolver.setBearingAtStation('R1', 'GRACIA', 120);
      resolver.setBearingAtStation('R2', 'SANTS', 90);

      resolver.setLineServesStation('R1', 'SANTS', true);
      resolver.setLineServesStation('R1', 'GRACIA', true);
      resolver.setLineServesStation('R2', 'SANTS', true);
      resolver.setLineServesStation('R2', 'CLOT', true);

      const stats = resolver.getCacheStats();
      expect(stats.bearings).toBe(3);
      expect(stats.memberships).toBe(4);
    });
  });

  describe('clearCaches', () => {
    it('should clear all cached data', () => {
      // Populate caches
      resolver.setBearingAtStation('R1', 'SANTS', 45);
      resolver.setLineServesStation('R1', 'SANTS', true);

      // Verify data exists
      expect(resolver.getLineBearingAtStation('R1', 'SANTS')).toBe(45);
      expect(resolver.lineServesStation('R1', 'SANTS')).toBe(true);
      expect(resolver.getCacheStats().bearings).toBe(1);
      expect(resolver.getCacheStats().memberships).toBe(1);

      // Clear caches
      resolver.clearCaches();

      // Verify data is cleared
      expect(resolver.getLineBearingAtStation('R1', 'SANTS')).toBe(0);
      expect(resolver.lineServesStation('R1', 'SANTS')).toBe(false);
      expect(resolver.getCacheStats().bearings).toBe(0);
      expect(resolver.getCacheStats().memberships).toBe(0);
    });
  });

  describe('cache key uniqueness', () => {
    it('should treat different line-station pairs independently', () => {
      resolver.setBearingAtStation('R1', 'SANTS', 45);
      resolver.setBearingAtStation('R2', 'SANTS', 90);

      expect(resolver.getLineBearingAtStation('R1', 'SANTS')).toBe(45);
      expect(resolver.getLineBearingAtStation('R2', 'SANTS')).toBe(90);
    });

    it('should allow updating existing bearings', () => {
      resolver.setBearingAtStation('R1', 'SANTS', 45);
      expect(resolver.getLineBearingAtStation('R1', 'SANTS')).toBe(45);

      resolver.setBearingAtStation('R1', 'SANTS', 60);
      expect(resolver.getLineBearingAtStation('R1', 'SANTS')).toBe(60);

      // Should still have only 1 entry
      expect(resolver.getCacheStats().bearings).toBe(1);
    });

    it('should allow updating existing memberships', () => {
      resolver.setLineServesStation('R1', 'SANTS', true);
      expect(resolver.lineServesStation('R1', 'SANTS')).toBe(true);

      resolver.setLineServesStation('R1', 'SANTS', false);
      expect(resolver.lineServesStation('R1', 'SANTS')).toBe(false);

      // Should still have only 1 entry
      expect(resolver.getCacheStats().memberships).toBe(1);
    });
  });
});
