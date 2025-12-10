/**
 * Unit tests for pathFinder
 *
 * Phase 4, Task T027
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getPathBetweenStations,
  isStationOnLine,
  getStationDistanceOnLine,
} from './pathFinder';
import type { Station } from '../../types/rodalies';
import type { PreprocessedRailwayLine } from './geometry';

// Mock the geometry module
vi.mock('./geometry', () => ({
  snapTrainToRailway: vi.fn(),
}));

import { snapTrainToRailway } from './geometry';

const mockSnapTrainToRailway = vi.mocked(snapTrainToRailway);

describe('pathFinder', () => {
  const mockStations = new Map<string, Station>();
  let mockRailway: PreprocessedRailwayLine;

  beforeEach(() => {
    mockSnapTrainToRailway.mockReset();

    // Set up mock stations along a line
    mockStations.clear();
    mockStations.set('STOP_A', {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [2.10, 41.35] },
      properties: { id: 'STOP_A', name: 'Station A', lines: ['R1'] },
    });
    mockStations.set('STOP_B', {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [2.15, 41.38] },
      properties: { id: 'STOP_B', name: 'Station B', lines: ['R1'] },
    });
    mockStations.set('STOP_C', {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [2.20, 41.40] },
      properties: { id: 'STOP_C', name: 'Station C', lines: ['R1'] },
    });
    mockStations.set('STOP_OFF_LINE', {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [3.00, 42.00] }, // Far away
      properties: { id: 'STOP_OFF_LINE', name: 'Station Off Line', lines: ['R2'] },
    });

    // Set up mock railway
    mockRailway = {
      lineId: 'R1',
      coordinates: [
        [2.10, 41.35],
        [2.12, 41.36],
        [2.15, 41.38],
        [2.18, 41.39],
        [2.20, 41.40],
      ],
      cumulativeDistances: [0, 500, 1000, 1500, 2000],
      segmentBearings: [45, 50, 45, 40],
      totalLength: 2000,
    };
  });

  describe('getPathBetweenStations', () => {
    it('should return path between two stations on same line', () => {
      // Mock snap results
      mockSnapTrainToRailway
        .mockReturnValueOnce({ position: [2.10, 41.35], bearing: 45, distance: 0, segmentIndex: 0 })
        .mockReturnValueOnce({ position: [2.20, 41.40], bearing: 40, distance: 2000, segmentIndex: 3 });

      const result = getPathBetweenStations('STOP_A', 'STOP_C', mockRailway, mockStations);

      expect(result).not.toBeNull();
      expect(result!.fromStationId).toBe('STOP_A');
      expect(result!.toStationId).toBe('STOP_C');
      expect(result!.totalLength).toBe(2000);
      expect(result!.isReversed).toBe(false);
    });

    it('should handle reversed direction (going backward)', () => {
      // Mock snap results (from C to A)
      mockSnapTrainToRailway
        .mockReturnValueOnce({ position: [2.20, 41.40], bearing: 40, distance: 2000, segmentIndex: 3 })
        .mockReturnValueOnce({ position: [2.10, 41.35], bearing: 45, distance: 0, segmentIndex: 0 });

      const result = getPathBetweenStations('STOP_C', 'STOP_A', mockRailway, mockStations);

      expect(result).not.toBeNull();
      expect(result!.fromStationId).toBe('STOP_C');
      expect(result!.toStationId).toBe('STOP_A');
      expect(result!.isReversed).toBe(true);
    });

    it('should return null if from station not found', () => {
      const result = getPathBetweenStations('UNKNOWN', 'STOP_C', mockRailway, mockStations);
      expect(result).toBeNull();
    });

    it('should return null if to station not found', () => {
      const result = getPathBetweenStations('STOP_A', 'UNKNOWN', mockRailway, mockStations);
      expect(result).toBeNull();
    });

    it('should return null if from station not on line', () => {
      mockSnapTrainToRailway
        .mockReturnValueOnce(null) // From station not on line
        .mockReturnValueOnce({ position: [2.20, 41.40], bearing: 40, distance: 2000, segmentIndex: 3 });

      const result = getPathBetweenStations('STOP_OFF_LINE', 'STOP_C', mockRailway, mockStations);
      expect(result).toBeNull();
    });

    it('should return null if to station not on line', () => {
      mockSnapTrainToRailway
        .mockReturnValueOnce({ position: [2.10, 41.35], bearing: 45, distance: 0, segmentIndex: 0 })
        .mockReturnValueOnce(null); // To station not on line

      const result = getPathBetweenStations('STOP_A', 'STOP_OFF_LINE', mockRailway, mockStations);
      expect(result).toBeNull();
    });

    it('should handle adjacent stations', () => {
      mockSnapTrainToRailway
        .mockReturnValueOnce({ position: [2.10, 41.35], bearing: 45, distance: 0, segmentIndex: 0 })
        .mockReturnValueOnce({ position: [2.15, 41.38], bearing: 50, distance: 1000, segmentIndex: 2 });

      const result = getPathBetweenStations('STOP_A', 'STOP_B', mockRailway, mockStations);

      expect(result).not.toBeNull();
      expect(result!.totalLength).toBe(1000);
    });
  });

  describe('isStationOnLine', () => {
    it('should return true if station is on line', () => {
      mockSnapTrainToRailway.mockReturnValueOnce({
        position: [2.10, 41.35],
        bearing: 45,
        distance: 0,
        segmentIndex: 0,
      });

      const result = isStationOnLine('STOP_A', mockRailway, mockStations);
      expect(result).toBe(true);
    });

    it('should return false if station is not on line', () => {
      mockSnapTrainToRailway.mockReturnValueOnce(null);

      const result = isStationOnLine('STOP_OFF_LINE', mockRailway, mockStations);
      expect(result).toBe(false);
    });

    it('should return false if station not found', () => {
      const result = isStationOnLine('UNKNOWN', mockRailway, mockStations);
      expect(result).toBe(false);
    });
  });

  describe('getStationDistanceOnLine', () => {
    it('should return distance for station on line', () => {
      mockSnapTrainToRailway.mockReturnValueOnce({
        position: [2.15, 41.38],
        bearing: 50,
        distance: 1000,
        segmentIndex: 2,
      });

      const result = getStationDistanceOnLine('STOP_B', mockRailway, mockStations);
      expect(result).toBe(1000);
    });

    it('should return null if station not on line', () => {
      mockSnapTrainToRailway.mockReturnValueOnce(null);

      const result = getStationDistanceOnLine('STOP_OFF_LINE', mockRailway, mockStations);
      expect(result).toBeNull();
    });

    it('should return null if station not found', () => {
      const result = getStationDistanceOnLine('UNKNOWN', mockRailway, mockStations);
      expect(result).toBeNull();
    });

    it('should return 0 for station at start of line', () => {
      mockSnapTrainToRailway.mockReturnValueOnce({
        position: [2.10, 41.35],
        bearing: 45,
        distance: 0,
        segmentIndex: 0,
      });

      const result = getStationDistanceOnLine('STOP_A', mockRailway, mockStations);
      expect(result).toBe(0);
    });
  });
});
