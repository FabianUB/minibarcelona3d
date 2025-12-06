import { describe, it, expect, vi } from 'vitest';
import { calculateRadialOffsets, clusterByProximity } from '../markerPositioning';
import type { Station } from '../../../types/rodalies';

describe('markerPositioning', () => {
  describe('clusterByProximity', () => {
    it('should return single cluster for isolated station', () => {
      const station: Station = {
        id: '1',
        name: 'Test Station',
        code: '001',
        lines: ['R1'],
        geometry: {
          type: 'Point',
          coordinates: [2.0, 41.0],
        },
      };

      const projected = [
        {
          station,
          point: { x: 200, y: 4100 },
        },
      ];

      const clusters = clusterByProximity(projected, 20);

      expect(clusters).toHaveLength(1);
      expect(clusters[0]).toHaveLength(1);
      expect(clusters[0][0].station.id).toBe('1');
    });

    it('should cluster stations within threshold', () => {
      const station1: Station = {
        id: '1',
        name: 'Station 1',
        code: '001',
        lines: ['R1'],
        geometry: {
          type: 'Point',
          coordinates: [2.0, 41.0],
        },
      };

      const station2: Station = {
        id: '2',
        name: 'Station 2',
        code: '002',
        lines: ['R2'],
        geometry: {
          type: 'Point',
          coordinates: [2.0, 41.0],
        },
      };

      const projected = [
        {
          station: station1,
          point: { x: 100, y: 100 },
        },
        {
          station: station2,
          point: { x: 110, y: 100 }, // 10px apart (within 20px threshold)
        },
      ];

      const clusters = clusterByProximity(projected, 20);

      expect(clusters).toHaveLength(1);
      expect(clusters[0]).toHaveLength(2);
      expect(clusters[0].map((p) => p.station.id)).toEqual(['1', '2']);
    });

    it('should separate stations beyond threshold', () => {
      const station1: Station = {
        id: '1',
        name: 'Station 1',
        code: '001',
        lines: ['R1'],
        geometry: {
          type: 'Point',
          coordinates: [2.0, 41.0],
        },
      };

      const station2: Station = {
        id: '2',
        name: 'Station 2',
        code: '002',
        lines: ['R2'],
        geometry: {
          type: 'Point',
          coordinates: [2.0, 41.0],
        },
      };

      const projected = [
        {
          station: station1,
          point: { x: 100, y: 100 },
        },
        {
          station: station2,
          point: { x: 150, y: 100 }, // 50px apart (beyond 20px threshold)
        },
      ];

      const clusters = clusterByProximity(projected, 20);

      expect(clusters).toHaveLength(2);
      expect(clusters[0]).toHaveLength(1);
      expect(clusters[1]).toHaveLength(1);
    });

    it('should use Euclidean distance for proximity', () => {
      const station1: Station = {
        id: '1',
        name: 'Station 1',
        code: '001',
        lines: ['R1'],
        geometry: {
          type: 'Point',
          coordinates: [2.0, 41.0],
        },
      };

      const station2: Station = {
        id: '2',
        name: 'Station 2',
        code: '002',
        lines: ['R2'],
        geometry: {
          type: 'Point',
          coordinates: [2.0, 41.0],
        },
      };

      const projected = [
        {
          station: station1,
          point: { x: 100, y: 100 },
        },
        {
          station: station2,
          point: { x: 112, y: 115 }, // sqrt(144 + 225) = ~19.2px (within threshold)
        },
      ];

      const clusters = clusterByProximity(projected, 20);

      // Should be in same cluster (distance is within threshold)
      expect(clusters).toHaveLength(1);
      expect(clusters[0]).toHaveLength(2);
    });
  });

  describe('calculateRadialOffsets', () => {
    it('should return zero offset for isolated station', () => {
      const mockMap = {
        project: vi.fn((coords: [number, number]) => ({ x: coords[0] * 100, y: coords[1] * 100 })),
      } as unknown as mapboxgl.Map;

      const station: Station = {
        id: '1',
        name: 'Test Station',
        code: '001',
        lines: ['R1'],
        geometry: {
          type: 'Point',
          coordinates: [2.0, 41.0],
        },
      };

      const offsets = calculateRadialOffsets([station], mockMap);

      expect(offsets).toHaveLength(1);
      expect(offsets[0]).toEqual({
        stationId: '1',
        offsetX: 0,
        offsetY: 0,
      });
    });

    it('should compute radial offsets for overlapping stations', () => {
      const mockMap = {
        project: vi.fn((coords: [number, number]) => ({ x: coords[0] * 100, y: coords[1] * 100 })),
      } as unknown as mapboxgl.Map;

      const station1: Station = {
        id: '1',
        name: 'Station 1',
        code: '001',
        lines: ['R1'],
        geometry: {
          type: 'Point',
          coordinates: [2.0, 41.0],
        },
      };

      const station2: Station = {
        id: '2',
        name: 'Station 2',
        code: '002',
        lines: ['R2'],
        geometry: {
          type: 'Point',
          coordinates: [2.0001, 41.0], // Very close
        },
      };

      const offsets = calculateRadialOffsets([station1, station2], mockMap);

      expect(offsets).toHaveLength(2);

      // Both stations should have non-zero offsets
      const offset1 = offsets.find((o) => o.stationId === '1');
      const offset2 = offsets.find((o) => o.stationId === '2');

      expect(offset1).toBeDefined();
      expect(offset2).toBeDefined();

      // Offsets should be non-zero (since they overlap)
      expect(Math.abs(offset1!.offsetX) + Math.abs(offset1!.offsetY)).toBeGreaterThan(0);
      expect(Math.abs(offset2!.offsetX) + Math.abs(offset2!.offsetY)).toBeGreaterThan(0);
    });

    it('should distribute stations evenly around circle', () => {
      const mockMap = {
        project: vi.fn((coords: [number, number]) => ({ x: coords[0] * 100, y: coords[1] * 100 })),
      } as unknown as mapboxgl.Map;

      // Create 4 overlapping stations
      const stations: Station[] = [
        {
          id: '1',
          name: 'Station 1',
          code: '001',
          lines: ['R1'],
          geometry: { type: 'Point', coordinates: [2.0, 41.0] },
        },
        {
          id: '2',
          name: 'Station 2',
          code: '002',
          lines: ['R2'],
          geometry: { type: 'Point', coordinates: [2.0001, 41.0] },
        },
        {
          id: '3',
          name: 'Station 3',
          code: '003',
          lines: ['R3'],
          geometry: { type: 'Point', coordinates: [2.0002, 41.0] },
        },
        {
          id: '4',
          name: 'Station 4',
          code: '004',
          lines: ['R4'],
          geometry: { type: 'Point', coordinates: [2.0003, 41.0] },
        },
      ];

      const offsets = calculateRadialOffsets(stations, mockMap);

      expect(offsets).toHaveLength(4);

      // All offsets should have the same radius (base + count * 2 = 10 + 4*2 = 18px)
      const expectedRadius = 10 + 4 * 2;

      offsets.forEach((offset) => {
        const radius = Math.sqrt(offset.offsetX ** 2 + offset.offsetY ** 2);
        expect(radius).toBeCloseTo(expectedRadius, 1);
      });

      // Angles should be evenly distributed (0, π/2, π, 3π/2)
      const angles = offsets.map((offset) =>
        Math.atan2(offset.offsetY, offset.offsetX)
      );

      // Normalize angles to [0, 2π]
      const normalizedAngles = angles.map((a) => (a < 0 ? a + 2 * Math.PI : a));
      normalizedAngles.sort((a, b) => a - b);

      // Check that angles are roughly π/2 apart
      for (let i = 1; i < normalizedAngles.length; i++) {
        const diff = normalizedAngles[i] - normalizedAngles[i - 1];
        expect(diff).toBeCloseTo(Math.PI / 2, 1);
      }
    });

    it('should increase radius based on cluster size', () => {
      const mockMap = {
        project: vi.fn((coords: [number, number]) => ({ x: coords[0] * 100, y: coords[1] * 100 })),
      } as unknown as mapboxgl.Map;

      // 2 overlapping stations
      const stations2: Station[] = [
        {
          id: '1',
          name: 'Station 1',
          code: '001',
          lines: ['R1'],
          geometry: { type: 'Point', coordinates: [2.0, 41.0] },
        },
        {
          id: '2',
          name: 'Station 2',
          code: '002',
          lines: ['R2'],
          geometry: { type: 'Point', coordinates: [2.0001, 41.0] },
        },
      ];

      // 4 overlapping stations
      const stations4: Station[] = [
        ...stations2,
        {
          id: '3',
          name: 'Station 3',
          code: '003',
          lines: ['R3'],
          geometry: { type: 'Point', coordinates: [2.0002, 41.0] },
        },
        {
          id: '4',
          name: 'Station 4',
          code: '004',
          lines: ['R4'],
          geometry: { type: 'Point', coordinates: [2.0003, 41.0] },
        },
      ];

      const offsets2 = calculateRadialOffsets(stations2, mockMap);
      const offsets4 = calculateRadialOffsets(stations4, mockMap);

      const radius2 = Math.sqrt(offsets2[0].offsetX ** 2 + offsets2[0].offsetY ** 2);
      const radius4 = Math.sqrt(offsets4[0].offsetX ** 2 + offsets4[0].offsetY ** 2);

      // Larger cluster should have larger radius
      // radius2 = 10 + 2*2 = 14
      // radius4 = 10 + 4*2 = 18
      expect(radius2).toBeCloseTo(14, 1);
      expect(radius4).toBeCloseTo(18, 1);
      expect(radius4).toBeGreaterThan(radius2);
    });

    it('should call map.project for each station', () => {
      const mockMap = {
        project: vi.fn((coords: [number, number]) => ({ x: coords[0] * 100, y: coords[1] * 100 })),
      } as unknown as mapboxgl.Map;

      const stations: Station[] = [
        {
          id: '1',
          name: 'Station 1',
          code: '001',
          lines: ['R1'],
          geometry: { type: 'Point', coordinates: [2.0, 41.0] },
        },
        {
          id: '2',
          name: 'Station 2',
          code: '002',
          lines: ['R2'],
          geometry: { type: 'Point', coordinates: [3.0, 42.0] },
        },
      ];

      calculateRadialOffsets(stations, mockMap);

      expect(mockMap.project).toHaveBeenCalledTimes(2);
      expect(mockMap.project).toHaveBeenCalledWith([2.0, 41.0]);
      expect(mockMap.project).toHaveBeenCalledWith([3.0, 42.0]);
    });
  });
});
