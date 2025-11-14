import { describe, it, expect, beforeEach } from 'vitest';
import { ScaleManager } from '../scaleManager';

describe('ScaleManager', () => {
  let manager: ScaleManager;

  beforeEach(() => {
    manager = new ScaleManager();
  });

  describe('computeScale', () => {
    it('should return 1.0 for zoom level 10 (standard size bucket)', () => {
      const scale = manager.computeScale(10);
      expect(scale).toBeCloseTo(1.0, 10);
    });

    it('should return 1.0 for zoom level 5 (standard size bucket)', () => {
      const scale = manager.computeScale(5);
      expect(scale).toBeCloseTo(1.0, 10);
    });

    it('should return 1.0 for zoom level 14 (at bucket threshold)', () => {
      const scale = manager.computeScale(14);
      expect(scale).toBeCloseTo(1.0, 10);
    });

    it('should return 0.5 for zoom level 15 (high zoom bucket)', () => {
      const scale = manager.computeScale(15);
      expect(scale).toBeCloseTo(0.5, 10);
    });

    it('should return 0.5 for zoom level 20 (high zoom bucket)', () => {
      const scale = manager.computeScale(20);
      expect(scale).toBeCloseTo(0.5, 10);
    });

    it('should return 1.0 for zoom level 0 (standard size bucket)', () => {
      const scale = manager.computeScale(0);
      expect(scale).toBeCloseTo(1.0, 10);
    });

    it('should use discrete buckets: zoom 0-15 = 1.0x, zoom 15+ = 0.5x', () => {
      const scale10 = manager.computeScale(10);
      const scale11 = manager.computeScale(11);
      const scale14 = manager.computeScale(14);
      const scale15 = manager.computeScale(15);
      const scale16 = manager.computeScale(16);

      // Same bucket (0-15) = same scale
      expect(scale10).toBe(scale11);
      expect(scale11).toBe(scale14);

      // Different bucket (15+) = different scale
      expect(scale14).toBeGreaterThan(scale15);
      expect(scale15).toBe(scale16);
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
    it('should accept custom configuration (discrete buckets override config)', () => {
      const customManager = new ScaleManager({ minHeightPx: 20, maxHeightPx: 50 });
      // Discrete bucket system ignores config values and uses fixed buckets
      const scale0 = customManager.computeScale(0);
      const scale15 = customManager.computeScale(15);

      expect(scale0).toBeCloseTo(1.0, 10); // Standard bucket
      expect(scale15).toBeCloseTo(0.5, 10); // High zoom bucket
    });

    it('should maintain discrete bucket behavior with custom referenceZoom', () => {
      const customManager = new ScaleManager({ referenceZoom: 12 });
      // Discrete buckets remain: 0-15 = 1.0x, 15+ = 0.5x
      const scale12 = customManager.computeScale(12);
      const scale16 = customManager.computeScale(16);

      expect(scale12).toBeCloseTo(1.0, 10);
      expect(scale16).toBeCloseTo(0.5, 10);
    });
  });
});
