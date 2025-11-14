import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { TrainMeshManager } from '../trainMeshManager';
import type { Station } from '../../../types/rodalies';
import type { PreprocessedRailwayLine } from '../geometry';

// Type for accessing private methods in tests
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TrainMeshManagerWithPrivates = any;

describe('TrainMeshManager - Spatial Separation', () => {
  let scene: THREE.Scene;
  let manager: TrainMeshManager;
  let managerWithPrivates: TrainMeshManagerWithPrivates;
  const mockStations: Station[] = [];
  const mockRailwayLines = new Map<string, PreprocessedRailwayLine>();

  beforeEach(() => {
    scene = new THREE.Scene();
    manager = new TrainMeshManager(scene, mockStations, mockRailwayLines);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    managerWithPrivates = manager as any;
  });

  describe('computeLateralOffset', () => {
    it('should return base offset at zoom level 10', () => {
      manager.setCurrentZoom(10);
      const offset = managerWithPrivates.computeLateralOffset(1);
      expect(offset).toBe(40);
    });

    it('should return base offset at zoom level 14 (threshold)', () => {
      manager.setCurrentZoom(14);
      const offset = managerWithPrivates.computeLateralOffset(1);
      expect(offset).toBe(40);
    });

    it('should return enhanced offset at zoom level 15 (above threshold)', () => {
      manager.setCurrentZoom(15);
      const offset = managerWithPrivates.computeLateralOffset(1);
      expect(offset).toBeCloseTo(60, 10);
    });

    it('should return enhanced offset at zoom level 17', () => {
      manager.setCurrentZoom(17);
      const offset = managerWithPrivates.computeLateralOffset(1);
      expect(offset).toBeCloseTo(60, 10);
    });

    it('should handle negative offset indices correctly', () => {
      manager.setCurrentZoom(10);
      const offset = managerWithPrivates.computeLateralOffset(-1);
      expect(offset).toBe(-40);
    });

    it('should handle negative offset indices at high zoom', () => {
      manager.setCurrentZoom(15);
      const offset = managerWithPrivates.computeLateralOffset(-1);
      expect(offset).toBeCloseTo(-60, 10);
    });

    it('should handle zero offset index', () => {
      manager.setCurrentZoom(15);
      const offset = managerWithPrivates.computeLateralOffset(0);
      expect(offset).toBe(0);
    });

    it('should handle offset index of 2 (far position)', () => {
      manager.setCurrentZoom(10);
      const offset = managerWithPrivates.computeLateralOffset(2);
      expect(offset).toBe(80);
    });

    it('should handle offset index of 2 at high zoom', () => {
      manager.setCurrentZoom(16);
      const offset = managerWithPrivates.computeLateralOffset(2);
      expect(offset).toBeCloseTo(120, 10);
    });
  });

  describe('setCurrentZoom', () => {
    it('should update current zoom level', () => {
      manager.setCurrentZoom(12);
      const offset = managerWithPrivates.computeLateralOffset(1);
      expect(offset).toBe(40);
    });

    it('should affect subsequent offset calculations', () => {
      manager.setCurrentZoom(10);
      let offset = managerWithPrivates.computeLateralOffset(1);
      expect(offset).toBe(40);

      manager.setCurrentZoom(16);
      offset = managerWithPrivates.computeLateralOffset(1);
      expect(offset).toBeCloseTo(60, 10);
    });
  });
});
