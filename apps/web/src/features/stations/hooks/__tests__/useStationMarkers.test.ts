/**
 * useStationMarkers Hook Tests
 * Feature: 004-station-visualization
 * Tasks: T035
 *
 * Tests useStationMarkers hook behavior:
 * - Data loading and error handling
 * - GeoJSON generation with enriched properties
 * - Radial offset integration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useStationMarkers } from '../useStationMarkers';
import * as dataLoader from '../../../../lib/rodalies/dataLoader';
import * as markerPositioning from '../../../../lib/stations/markerPositioning';
import type { Map as MapboxMap } from 'mapbox-gl';

// Mock modules
vi.mock('../../../../lib/rodalies/dataLoader');
vi.mock('../../../../lib/stations/markerPositioning');

describe('useStationMarkers', () => {
  let mockMap: MapboxMap;

  beforeEach(() => {
    mockMap = {
      project: vi.fn((coords: [number, number]) => ({
        x: coords[0] * 100,
        y: coords[1] * 100,
      })),
    } as unknown as MapboxMap;

    // Reset all mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Data Loading', () => {
    it('should load stations and lines in parallel', async () => {
      const mockStations = {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            properties: {
              id: 'station-1',
              name: 'Test Station',
              code: '001',
              lines: ['R1'],
            },
            geometry: {
              type: 'Point' as const,
              coordinates: [2.0, 41.0] as [number, number],
            },
          },
        ],
      };

      const mockLines = [
        {
          id: 'R1',
          name: 'R1',
          short_code: 'R1',
          brand_color: '#FF0000',
          default_pattern: 'solid' as const,
          high_contrast_pattern: 'dashed' as const,
        },
      ];

      vi.mocked(dataLoader.loadStations).mockResolvedValue(mockStations);
      vi.mocked(dataLoader.loadRodaliesLines).mockResolvedValue(mockLines);
      vi.mocked(dataLoader.loadLineGeometryCollection).mockResolvedValue({
        type: 'FeatureCollection',
        features: [],
      });
      vi.mocked(markerPositioning.calculateRadialOffsets).mockReturnValue([
        { stationId: 'station-1', offsetX: 0, offsetY: 0 },
      ]);

      const { result } = renderHook(() =>
        useStationMarkers({
          map: mockMap,
          highlightedLineIds: [],
          highlightMode: 'none',
        })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(dataLoader.loadStations).toHaveBeenCalledTimes(1);
      expect(dataLoader.loadRodaliesLines).toHaveBeenCalledTimes(1);
    });

    it('should return loading state initially', () => {
      vi.mocked(dataLoader.loadStations).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );
      vi.mocked(dataLoader.loadRodaliesLines).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );
      vi.mocked(dataLoader.loadLineGeometryCollection).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      const { result } = renderHook(() =>
        useStationMarkers({
          map: mockMap,
          highlightedLineIds: [],
          highlightMode: 'none',
        })
      );

      expect(result.current.isLoading).toBe(true);
      expect(result.current.geoJSON).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it('should handle loading errors', async () => {
      const errorMessage = 'Failed to fetch stations';
      vi.mocked(dataLoader.loadStations).mockRejectedValue(new Error(errorMessage));

      const { result } = renderHook(() =>
        useStationMarkers({
          map: mockMap,
          highlightedLineIds: [],
          highlightMode: 'none',
        })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBe(errorMessage);
      expect(result.current.geoJSON).toBeNull();
    });

    it('should not load data if map is null', () => {
      const { result } = renderHook(() =>
        useStationMarkers({
          map: null,
          highlightedLineIds: [],
          highlightMode: 'none',
        })
      );

      expect(result.current.isLoading).toBe(false);
      expect(dataLoader.loadStations).not.toHaveBeenCalled();
    });
  });

  describe('GeoJSON Generation', () => {
    it('should enrich features with display properties', async () => {
      const mockStations = {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            properties: {
              id: 'station-1',
              name: 'Single Line Station',
              code: '001',
              lines: ['R1'],
            },
            geometry: {
              type: 'Point' as const,
              coordinates: [2.0, 41.0] as [number, number],
            },
          },
          {
            type: 'Feature' as const,
            properties: {
              id: 'station-2',
              name: 'Multi Line Station',
              code: '002',
              lines: ['R1', 'R2'],
            },
            geometry: {
              type: 'Point' as const,
              coordinates: [2.1, 41.1] as [number, number],
            },
          },
        ],
      };

      const mockLines = [
        {
          id: 'R1',
          name: 'R1',
          short_code: 'R1',
          brand_color: '#FF0000',
          default_pattern: 'solid' as const,
          high_contrast_pattern: 'dashed' as const,
        },
        {
          id: 'R2',
          name: 'R2',
          short_code: 'R2',
          brand_color: '#00FF00',
          default_pattern: 'solid' as const,
          high_contrast_pattern: 'dashed' as const,
        },
      ];

      vi.mocked(dataLoader.loadStations).mockResolvedValue(mockStations);
      vi.mocked(dataLoader.loadRodaliesLines).mockResolvedValue(mockLines);
      vi.mocked(dataLoader.loadLineGeometryCollection).mockResolvedValue({
        type: 'FeatureCollection',
        features: [],
      });
      vi.mocked(markerPositioning.calculateRadialOffsets).mockReturnValue([
        { stationId: 'station-1', offsetX: 0, offsetY: 0 },
        { stationId: 'station-2', offsetX: 10, offsetY: 5 },
      ]);

      const { result } = renderHook(() =>
        useStationMarkers({
          map: mockMap,
          highlightedLineIds: [],
          highlightMode: 'none',
        })
      );

      await waitFor(() => {
        expect(result.current.geoJSON).not.toBeNull();
      });

      const { geoJSON } = result.current;

      // Check single-line station
      const station1 = geoJSON!.features.find((f) => f.properties.id === 'station-1');
      expect(station1).toBeDefined();
      expect(station1!.properties.isMultiLine).toBe(false);
      expect(station1!.properties.lineCount).toBe(1);
      expect(station1!.properties.dominantLineColor).toBe('#FF0000');
      expect(station1!.properties.offsetX).toBe(0);
      expect(station1!.properties.offsetY).toBe(0);

      // Check multi-line station
      const station2 = geoJSON!.features.find((f) => f.properties.id === 'station-2');
      expect(station2).toBeDefined();
      expect(station2!.properties.isMultiLine).toBe(true);
      expect(station2!.properties.lineCount).toBe(2);
      expect(station2!.properties.dominantLineColor).toBe('#FF0000'); // First line color
      expect(station2!.properties.offsetX).toBe(10);
      expect(station2!.properties.offsetY).toBe(5);
    });

    it('should use fallback color if line not found', async () => {
      const mockStations = {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            properties: {
              id: 'station-1',
              name: 'Test Station',
              code: '001',
              lines: ['UNKNOWN'],
            },
            geometry: {
              type: 'Point' as const,
              coordinates: [2.0, 41.0] as [number, number],
            },
          },
        ],
      };

      const mockLines: any[] = [];

      vi.mocked(dataLoader.loadStations).mockResolvedValue(mockStations);
      vi.mocked(dataLoader.loadRodaliesLines).mockResolvedValue(mockLines);
      vi.mocked(dataLoader.loadLineGeometryCollection).mockResolvedValue({
        type: 'FeatureCollection',
        features: [],
      });
      vi.mocked(markerPositioning.calculateRadialOffsets).mockReturnValue([
        { stationId: 'station-1', offsetX: 0, offsetY: 0 },
      ]);

      const { result } = renderHook(() =>
        useStationMarkers({
          map: mockMap,
          highlightedLineIds: [],
          highlightMode: 'none',
        })
      );

      await waitFor(() => {
        expect(result.current.geoJSON).not.toBeNull();
      });

      const { geoJSON } = result.current;
      const station = geoJSON!.features[0];

      expect(station.properties.dominantLineColor).toBe('#CCCCCC'); // Fallback color
    });

    it('should preserve original geometry', async () => {
      const mockStations = {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            properties: {
              id: 'station-1',
              name: 'Test Station',
              code: '001',
              lines: ['R1'],
            },
            geometry: {
              type: 'Point' as const,
              coordinates: [2.12345, 41.98765] as [number, number],
            },
          },
        ],
      };

      const mockLines = [
        {
          id: 'R1',
          name: 'R1',
          short_code: 'R1',
          brand_color: '#FF0000',
          default_pattern: 'solid' as const,
          high_contrast_pattern: 'dashed' as const,
        },
      ];

      vi.mocked(dataLoader.loadStations).mockResolvedValue(mockStations);
      vi.mocked(dataLoader.loadRodaliesLines).mockResolvedValue(mockLines);
      vi.mocked(dataLoader.loadLineGeometryCollection).mockResolvedValue({
        type: 'FeatureCollection',
        features: [],
      });
      vi.mocked(markerPositioning.calculateRadialOffsets).mockReturnValue([
        { stationId: 'station-1', offsetX: 0, offsetY: 0 },
      ]);

      const { result } = renderHook(() =>
        useStationMarkers({
          map: mockMap,
          highlightedLineIds: [],
          highlightMode: 'none',
        })
      );

      await waitFor(() => {
        expect(result.current.geoJSON).not.toBeNull();
      });

      const { geoJSON } = result.current;
      const station = geoJSON!.features[0];

      expect(station.geometry).toEqual({
        type: 'Point',
        coordinates: [2.12345, 41.98765],
      });
    });
  });

  describe('Radial Offset Integration', () => {
    it('should call calculateRadialOffsets with station array and map', async () => {
      const mockStations = {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            properties: {
              id: 'station-1',
              name: 'Test Station',
              code: '001',
              lines: ['R1'],
            },
            geometry: {
              type: 'Point' as const,
              coordinates: [2.0, 41.0] as [number, number],
            },
          },
        ],
      };

      const mockLines = [
        {
          id: 'R1',
          name: 'R1',
          short_code: 'R1',
          brand_color: '#FF0000',
          default_pattern: 'solid' as const,
          high_contrast_pattern: 'dashed' as const,
        },
      ];

      vi.mocked(dataLoader.loadStations).mockResolvedValue(mockStations);
      vi.mocked(dataLoader.loadRodaliesLines).mockResolvedValue(mockLines);
      vi.mocked(dataLoader.loadLineGeometryCollection).mockResolvedValue({
        type: 'FeatureCollection',
        features: [],
      });
      vi.mocked(markerPositioning.calculateRadialOffsets).mockReturnValue([
        { stationId: 'station-1', offsetX: 15, offsetY: 20 },
      ]);

      const { result } = renderHook(() =>
        useStationMarkers({
          map: mockMap,
          highlightedLineIds: [],
          highlightMode: 'none',
        })
      );

      await waitFor(() => {
        expect(result.current.geoJSON).not.toBeNull();
      });

      expect(markerPositioning.calculateRadialOffsets).toHaveBeenCalledWith(
        [
          {
            id: 'station-1',
            name: 'Test Station',
            code: '001',
            lines: ['R1'],
            geometry: {
              type: 'Point',
              coordinates: [2.0, 41.0],
            },
          },
        ],
        mockMap
      );
    });

    it('should apply calculated offsets to features', async () => {
      const mockStations = {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            properties: {
              id: 'station-1',
              name: 'Test Station',
              code: '001',
              lines: ['R1'],
            },
            geometry: {
              type: 'Point' as const,
              coordinates: [2.0, 41.0] as [number, number],
            },
          },
        ],
      };

      const mockLines = [
        {
          id: 'R1',
          name: 'R1',
          short_code: 'R1',
          brand_color: '#FF0000',
          default_pattern: 'solid' as const,
          high_contrast_pattern: 'dashed' as const,
        },
      ];

      vi.mocked(dataLoader.loadStations).mockResolvedValue(mockStations);
      vi.mocked(dataLoader.loadRodaliesLines).mockResolvedValue(mockLines);
      vi.mocked(dataLoader.loadLineGeometryCollection).mockResolvedValue({
        type: 'FeatureCollection',
        features: [],
      });
      vi.mocked(markerPositioning.calculateRadialOffsets).mockReturnValue([
        { stationId: 'station-1', offsetX: 25, offsetY: 30 },
      ]);

      const { result } = renderHook(() =>
        useStationMarkers({
          map: mockMap,
          highlightedLineIds: [],
          highlightMode: 'none',
        })
      );

      await waitFor(() => {
        expect(result.current.geoJSON).not.toBeNull();
      });

      const { geoJSON } = result.current;
      const station = geoJSON!.features[0];

      expect(station.properties.offsetX).toBe(25);
      expect(station.properties.offsetY).toBe(30);
    });

    it('should use zero offsets if station not in offset map', async () => {
      const mockStations = {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            properties: {
              id: 'station-1',
              name: 'Test Station',
              code: '001',
              lines: ['R1'],
            },
            geometry: {
              type: 'Point' as const,
              coordinates: [2.0, 41.0] as [number, number],
            },
          },
        ],
      };

      const mockLines = [
        {
          id: 'R1',
          name: 'R1',
          short_code: 'R1',
          brand_color: '#FF0000',
          default_pattern: 'solid' as const,
          high_contrast_pattern: 'dashed' as const,
        },
      ];

      vi.mocked(dataLoader.loadStations).mockResolvedValue(mockStations);
      vi.mocked(dataLoader.loadRodaliesLines).mockResolvedValue(mockLines);
      vi.mocked(dataLoader.loadLineGeometryCollection).mockResolvedValue({
        type: 'FeatureCollection',
        features: [],
      });
      // Return empty offset array
      vi.mocked(markerPositioning.calculateRadialOffsets).mockReturnValue([]);

      const { result } = renderHook(() =>
        useStationMarkers({
          map: mockMap,
          highlightedLineIds: [],
          highlightMode: 'none',
        })
      );

      await waitFor(() => {
        expect(result.current.geoJSON).not.toBeNull();
      });

      const { geoJSON } = result.current;
      const station = geoJSON!.features[0];

      expect(station.properties.offsetX).toBe(0);
      expect(station.properties.offsetY).toBe(0);
    });
  });

  describe('Retry Mechanism', () => {
    it('should provide retry function', () => {
      const { result } = renderHook(() =>
        useStationMarkers({
          map: mockMap,
          highlightedLineIds: [],
          highlightMode: 'none',
        })
      );

      expect(result.current.retry).toBeDefined();
      expect(typeof result.current.retry).toBe('function');
    });

    it('should reload data when retry is called', async () => {
      const mockStations = {
        type: 'FeatureCollection' as const,
        features: [],
      };

      const mockLines: any[] = [];

      vi.mocked(dataLoader.loadStations).mockResolvedValue(mockStations);
      vi.mocked(dataLoader.loadRodaliesLines).mockResolvedValue(mockLines);
      vi.mocked(dataLoader.loadLineGeometryCollection).mockResolvedValue({
        type: 'FeatureCollection',
        features: [],
      });
      vi.mocked(markerPositioning.calculateRadialOffsets).mockReturnValue([]);

      const { result } = renderHook(() =>
        useStationMarkers({
          map: mockMap,
          highlightedLineIds: [],
          highlightMode: 'none',
        })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Clear mock calls
      vi.clearAllMocks();

      // Call retry
      result.current.retry();

      await waitFor(() => {
        expect(dataLoader.loadStations).toHaveBeenCalled();
      });
    });
  });
});
