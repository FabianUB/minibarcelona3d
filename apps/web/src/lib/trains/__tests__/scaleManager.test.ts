import { describe, it, expect, beforeEach } from 'vitest';
import { ScaleManager } from '../scaleManager';

describe('ScaleManager', () => {
  let manager: ScaleManager;

  beforeEach(() => {
    manager = new ScaleManager();
  });

  describe('computeScale', () => {
    it('should return 1.0 at reference zoom level (10)', () => {
      const scale = manager.computeScale(10);
      expect(scale).toBeCloseTo(1.0, 10);
    });

    it('should return larger scale at lower zoom levels', () => {
      const scale = manager.computeScale(5);
      expect(scale).toBeGreaterThan(1.0);
    });

    it('should return smaller scale at higher zoom levels', () => {
      const scale = manager.computeScale(15);
      expect(scale).toBeLessThan(1.0);
    });

    it('should clamp to minimum scale (12px / 25px = 0.48)', () => {
      const scale = manager.computeScale(20);
      expect(scale).toBeCloseTo(0.48, 2);
    });

    it('should clamp to maximum scale (40px / 25px = 1.6)', () => {
      const scale = manager.computeScale(0);
      expect(scale).toBeCloseTo(1.6, 2);
    });

    it('should decrease scale exponentially as zoom increases', () => {
      const scale10 = manager.computeScale(10);
      const scale11 = manager.computeScale(11);
      const scale12 = manager.computeScale(12);
      const scale13 = manager.computeScale(13);

      expect(scale10).toBeGreaterThan(scale11);
      expect(scale11).toBeGreaterThan(scale12);
      expect(scale12).toBeGreaterThan(scale13);
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

    it('should treat different zoom buckets as cache misses', () => {
      manager.computeScale(10.0);
      manager.computeScale(10.1);
      const stats = manager.getCacheStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(2);
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

  describe('custom configuration', () => {
    it('should accept custom minHeightPx', () => {
      const customManager = new ScaleManager({ minHeightPx: 20 });
      const scale = customManager.computeScale(20);
      expect(scale).toBeCloseTo(0.8, 2);
    });

    it('should accept custom maxHeightPx', () => {
      const customManager = new ScaleManager({ maxHeightPx: 50 });
      const scale = customManager.computeScale(0);
      expect(scale).toBeCloseTo(2.0, 2);
    });

    it('should accept custom referenceZoom', () => {
      const customManager = new ScaleManager({ referenceZoom: 12 });
      const scale = customManager.computeScale(12);
      expect(scale).toBeCloseTo(1.0, 10);
    });
  });
});
