import { describe, it, expect, beforeEach } from 'vitest';
import { ScaleManager } from '../scaleManager';

describe('ScaleManager', () => {
  let manager: ScaleManager;

  beforeEach(() => {
    manager = new ScaleManager();
  });

  describe('computeScale — continuous zoom compensation', () => {
    it('should return 0.7 at reference zoom 14', () => {
      expect(manager.computeScale(14)).toBeCloseTo(0.7, 2);
    });

    it('should increase as zoom decreases (zooming out)', () => {
      const scale14 = manager.computeScale(14);
      const scale12 = manager.computeScale(12);
      const scale10 = manager.computeScale(10);
      expect(scale12).toBeGreaterThan(scale14);
      expect(scale10).toBeGreaterThan(scale12);
    });

    it('should decrease as zoom increases (zooming in)', () => {
      const scale14 = manager.computeScale(14);
      const scale15 = manager.computeScale(15);
      const scale16 = manager.computeScale(16);
      expect(scale15).toBeLessThan(scale14);
      expect(scale16).toBeLessThan(scale15);
    });

    it('should be roughly 1.0 at zoom 13 (one level out from reference)', () => {
      const scale = manager.computeScale(13);
      expect(scale).toBeCloseTo(0.99, 1);
    });

    it('should be roughly 1.4 at zoom 12', () => {
      const scale = manager.computeScale(12);
      expect(scale).toBeCloseTo(1.4, 1);
    });

    it('should clamp to minimum 0.35 at very high zoom', () => {
      const scale = manager.computeScale(20);
      expect(scale).toBe(0.35);
    });

    it('should clamp to maximum 3.0 at very low zoom', () => {
      const scale = manager.computeScale(5);
      expect(scale).toBe(3.0);
    });

    it('should decrease monotonically across the full zoom range', () => {
      const zooms = [8, 9, 10, 11, 12, 13, 14, 15, 16];
      const scales = zooms.map(z => manager.computeScale(z));
      for (let i = 1; i < scales.length; i++) {
        expect(scales[i]).toBeLessThanOrEqual(scales[i - 1]);
      }
    });
  });

  describe('caching', () => {
    it('should cache computed scales', () => {
      manager.computeScale(10);
      manager.computeScale(10);
      const stats = manager.getCacheStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });

    it('should quantize zoom to 0.1 increments', () => {
      manager.computeScale(10.04);
      manager.computeScale(10.14);
      const stats = manager.getCacheStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(2);
      expect(stats.size).toBe(2);
    });

    it('should calculate correct hit rate', () => {
      manager.computeScale(10);
      manager.computeScale(10);
      manager.computeScale(10);
      const stats = manager.getCacheStats();
      expect(stats.hitRate).toBeCloseTo(0.666, 2);
    });

    it('should track cache size', () => {
      manager.computeScale(10);
      manager.computeScale(11);
      manager.computeScale(12);
      const stats = manager.getCacheStats();
      expect(stats.size).toBe(3);
    });
  });

  describe('invalidateCache', () => {
    it('should clear all cache entries', () => {
      manager.computeScale(10);
      manager.computeScale(11);
      manager.invalidateCache();
      const stats = manager.getCacheStats();
      expect(stats.size).toBe(0);
    });

    it('should reset hit/miss counters', () => {
      manager.computeScale(10);
      manager.computeScale(10);
      manager.invalidateCache();
      const stats = manager.getCacheStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });

    it('should recompute values after invalidation', () => {
      manager.computeScale(10);
      manager.computeScale(10);
      manager.invalidateCache();
      manager.computeScale(10);
      const stats = manager.getCacheStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(0);
    });
  });
});
