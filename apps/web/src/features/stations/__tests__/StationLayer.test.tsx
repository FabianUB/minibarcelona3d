/**
 * StationLayer Component Tests
 * Feature: 004-station-visualization
 * Tasks: T034
 *
 * Tests StationLayer component's integration with Mapbox GL:
 * - Layer creation and source management
 * - Event handler registration
 * - Style updates on highlight changes
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { StationLayer } from '../StationLayer';
import type { Map as MapboxMap } from 'mapbox-gl';
import * as useStationMarkersHook from '../hooks/useStationMarkers';

// Mock useStationMarkers hook
vi.mock('../hooks/useStationMarkers');

// Mock mapbox-gl types
type MockSource = {
  type: string;
  data: unknown;
  setData: ReturnType<typeof vi.fn>;
};

type MockLayer = {
  id: string;
  type: string;
  source: string;
  filter?: unknown;
  paint?: Record<string, unknown>;
};

describe('StationLayer', () => {
  let mockMap: MapboxMap;
  let mockSources: Map<string, MockSource>;
  let mockLayers: Map<string, MockLayer>;
  let mockEventHandlers: Map<string, Map<string, (...args: unknown[]) => unknown>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let canvasContextSpy: any;

  beforeAll(() => {
    const mockCanvasContext = {
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      ellipse: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(0), width: 0, height: 0 })),
    };

    canvasContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockReturnValue(mockCanvasContext as any);
  });

  afterAll(() => {
    canvasContextSpy.mockRestore();
  });

  beforeEach(() => {
    mockSources = new Map();
    mockLayers = new Map();
    mockEventHandlers = new Map();

    // Mock useStationMarkers to return valid GeoJSON data
    vi.mocked(useStationMarkersHook.useStationMarkers).mockReturnValue({
      geoJSON: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            id: 'station-1',
            properties: {
              id: 'station-1',
              name: 'Test Station 1',
              code: '001',
              lines: ['R1'],
              isMultiLine: false,
              dominantLineColor: '#FF0000',
              lineCount: 1,
              offsetX: 0,
              offsetY: 0,
              trackBearing: 45,
            },
            geometry: {
              type: 'Point',
              coordinates: [2.0, 41.0],
            },
          },
          {
            type: 'Feature',
            id: 'station-2',
            properties: {
              id: 'station-2',
              name: 'Test Station 2',
              code: '002',
              lines: ['R1', 'R2'],
              isMultiLine: true,
              dominantLineColor: '#FF0000',
              lineCount: 2,
              offsetX: 10,
              offsetY: 5,
              trackBearing: 90,
            },
            geometry: {
              type: 'Point',
              coordinates: [2.1, 41.1],
            },
          },
        ],
      },
      isLoading: false,
      error: null,
      retry: vi.fn(),
    });

    // Create mock Mapbox GL map
    mockMap = {
      isStyleLoaded: vi.fn(() => true),
      getSource: vi.fn((id: string) => mockSources.get(id)),
      addSource: vi.fn((id: string, config: { type: string; data: unknown }) => {
        mockSources.set(id, {
          ...config,
          setData: vi.fn((data: unknown) => {
            const source = mockSources.get(id);
            if (source) {
              source.data = data;
            }
          }),
        });
      }),
      removeSource: vi.fn((id: string) => {
        mockSources.delete(id);
      }),
      getLayer: vi.fn((id: string) => mockLayers.get(id)),
      addLayer: vi.fn((config: MockLayer) => {
        mockLayers.set(config.id, config);
      }),
      removeLayer: vi.fn((id: string) => {
        mockLayers.delete(id);
      }),
      setPaintProperty: vi.fn((layerId: string, property: string, value: unknown) => {
        const layer = mockLayers.get(layerId);
        if (layer?.paint) {
          layer.paint[property] = value;
        } else if (layer) {
          layer.paint = { [property]: value };
        }
      }),
      on: vi.fn(
        (
          event: string,
          layerIdOrCallback: string | ((...args: unknown[]) => unknown),
          callback?: (...args: unknown[]) => unknown
        ) => {
          const eventKey = typeof layerIdOrCallback === 'string' ? layerIdOrCallback : 'map';
          const handler = (callback || layerIdOrCallback) as (...args: unknown[]) => unknown;

        if (!mockEventHandlers.has(event)) {
          mockEventHandlers.set(event, new Map());
        }
        mockEventHandlers.get(event)!.set(eventKey, handler);
      }
      ),
      off: vi.fn(
        (
          event: string,
          layerIdOrCallback: string | ((...args: unknown[]) => unknown)
        ) => {
          const eventKey = typeof layerIdOrCallback === 'string' ? layerIdOrCallback : 'map';
          const handlers = mockEventHandlers.get(event);
          if (handlers) {
            handlers.delete(eventKey);
          }
        }
      ),
      getCanvas: vi.fn(() => ({
        style: {
          cursor: '',
        },
      })),
      moveLayer: vi.fn(),
      getZoom: vi.fn(() => 16),
      queryRenderedFeatures: vi.fn(() => []),
      hasImage: vi.fn(() => false),
      addImage: vi.fn(),
      removeImage: vi.fn(),
      setFilter: vi.fn((layerId: string, filter: unknown) => {
        const layer = mockLayers.get(layerId);
        if (layer) {
          layer.filter = filter;
        }
      }),
    } as unknown as MapboxMap;
  });

  afterEach(() => {
    cleanup();
  });

  describe('Layer Creation', () => {
    it('should add source and station layer on mount', () => {
      render(
        <StationLayer
          map={mockMap}
          highlightedLineIds={[]}
          highlightMode="none"
          onStationClick={vi.fn()}
        />
      );

      // Should add source
      expect(mockMap.addSource).toHaveBeenCalledWith(
        'rodalies-stations-source',
        expect.objectContaining({
          type: 'geojson',
        })
      );

      // Should add two layers (circle layer + label layer)
      expect(mockMap.addLayer).toHaveBeenCalledTimes(2);

      // Check layer IDs
      const layerIds = (mockMap.addLayer as ReturnType<typeof vi.fn>).mock.calls.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (call: any) => call[0].id
      );
      expect(layerIds).toContain('rodalies-stations-circles');
      expect(layerIds).toContain('rodalies-stations-labels');
    });

    it('should create circle layer for station markers', () => {
      render(
        <StationLayer
          map={mockMap}
          highlightedLineIds={[]}
          highlightMode="none"
          onStationClick={vi.fn()}
        />
      );

      const layerCalls = (mockMap.addLayer as ReturnType<typeof vi.fn>).mock.calls;
      const circleLayer = layerCalls.find((call: unknown[]) => (call[0] as { id: string }).id === 'rodalies-stations-circles')?.[0];
      const labelLayer = layerCalls.find((call: unknown[]) => (call[0] as { id: string }).id === 'rodalies-stations-labels')?.[0];

      // Should have a circle layer
      expect(circleLayer?.type).toBe('circle');
      expect(circleLayer?.paint).toHaveProperty('circle-radius');
      expect(circleLayer?.paint).toHaveProperty('circle-color');

      // Should have a symbol layer for labels
      expect(labelLayer?.type).toBe('symbol');
      expect(labelLayer?.layout).toHaveProperty('text-field');
    });

    it('should update source data instead of recreating if source exists', () => {
      const { rerender } = render(
        <StationLayer
          map={mockMap}
          highlightedLineIds={[]}
          highlightMode="none"
          onStationClick={vi.fn()}
        />
      );

      // First render creates source
      expect(mockMap.addSource).toHaveBeenCalledTimes(1);

      // Mock that source now exists
      const mockGetSource = mockMap.getSource as ReturnType<typeof vi.fn>;
      mockGetSource.mockReturnValue({
        setData: vi.fn(),
      });

      // Re-render with same props
      rerender(
        <StationLayer
          map={mockMap}
          highlightedLineIds={[]}
          highlightMode="none"
          onStationClick={vi.fn()}
        />
      );

      // Should NOT create new source
      expect(mockMap.addSource).toHaveBeenCalledTimes(1);
    });

    it('should clean up layers and source on unmount', () => {
      const { unmount } = render(
        <StationLayer
          map={mockMap}
          highlightedLineIds={[]}
          highlightMode="none"
          onStationClick={vi.fn()}
        />
      );

      // Mock that layers exist
      mockLayers.set('rodalies-stations-circles', {
        id: 'rodalies-stations-circles',
        type: 'circle',
        source: 'rodalies-stations-source',
      });
      mockLayers.set('rodalies-stations-labels', {
        id: 'rodalies-stations-labels',
        type: 'symbol',
        source: 'rodalies-stations-source',
      });
      mockSources.set('rodalies-stations-source', {
        type: 'geojson',
        data: null,
        setData: vi.fn(),
      });

      unmount();

      expect(mockMap.removeLayer).toHaveBeenCalledWith('rodalies-stations-circles');
      expect(mockMap.removeLayer).toHaveBeenCalledWith('rodalies-stations-labels');
      expect(mockMap.removeSource).toHaveBeenCalledWith('rodalies-stations-source');
    });
  });

  describe('Event Handlers', () => {
    it('should register click handlers on station layer', () => {
      render(
        <StationLayer
          map={mockMap}
          highlightedLineIds={[]}
          highlightMode="none"
          onStationClick={vi.fn()}
        />
      );

      // Mock that layer exists
      (mockMap.getLayer as ReturnType<typeof vi.fn>).mockReturnValue(true);

      // Should register click handler
      expect(mockMap.on).toHaveBeenCalledWith('click', 'rodalies-stations-circles', expect.any(Function));
    });

    it('should register mouseenter/mouseleave handlers for cursor changes', () => {
      render(
        <StationLayer
          map={mockMap}
          highlightedLineIds={[]}
          highlightMode="none"
          onStationClick={vi.fn()}
        />
      );

      // Mock that layer exists
      (mockMap.getLayer as ReturnType<typeof vi.fn>).mockReturnValue(true);

      // Should register mouseenter handlers
      expect(mockMap.on).toHaveBeenCalledWith('mouseenter', 'rodalies-stations-circles', expect.any(Function));

      // Should register mouseleave handlers
      expect(mockMap.on).toHaveBeenCalledWith('mouseleave', 'rodalies-stations-circles', expect.any(Function));
    });

    it('should call onStationClick when station marker is clicked', () => {
      const mockOnStationClick = vi.fn();

      render(
        <StationLayer
          map={mockMap}
          highlightedLineIds={[]}
          highlightMode="none"
          onStationClick={mockOnStationClick}
        />
      );

      // Mock that layer exists
      (mockMap.getLayer as ReturnType<typeof vi.fn>).mockReturnValue(true);

      // Mock queryRenderedFeatures to return a station
      (mockMap.queryRenderedFeatures as ReturnType<typeof vi.fn>).mockReturnValue([
        {
          properties: {
            id: 'station-123',
            name: 'Barcelona-Sants',
          },
        },
      ]);

      // Get the click handler
      const clickHandler = mockEventHandlers.get('click')?.get('rodalies-stations-circles');
      expect(clickHandler).toBeDefined();

      // Simulate click
      clickHandler!({ point: { x: 100, y: 100 } });

      expect(mockOnStationClick).toHaveBeenCalledWith('station-123');
    });

    it('should remove all event handlers on unmount', () => {
      const { unmount } = render(
        <StationLayer
          map={mockMap}
          highlightedLineIds={[]}
          highlightMode="none"
          onStationClick={vi.fn()}
        />
      );

      // Mock that layer exists
      (mockMap.getLayer as ReturnType<typeof vi.fn>).mockReturnValue(true);

      unmount();

      // Should remove click handler
      expect(mockMap.off).toHaveBeenCalledWith('click', 'rodalies-stations-circles', expect.any(Function));

      // Should remove mouse handlers
      expect(mockMap.off).toHaveBeenCalledWith('mouseenter', 'rodalies-stations-circles', expect.any(Function));
      expect(mockMap.off).toHaveBeenCalledWith('mouseleave', 'rodalies-stations-circles', expect.any(Function));
    });
  });

  describe('Style Updates', () => {
    it('should update circle opacity when highlighting changes', () => {
      const { rerender } = render(
        <StationLayer
          map={mockMap}
          highlightedLineIds={[]}
          highlightMode="none"
          onStationClick={vi.fn()}
        />
      );

      // Mock that layer exists
      (mockMap.getLayer as ReturnType<typeof vi.fn>).mockReturnValue(true);

      // Re-render with highlight
      rerender(
        <StationLayer
          map={mockMap}
          highlightedLineIds={['R1']}
          highlightMode="isolate"
          onStationClick={vi.fn()}
        />
      );

      // Should update circle opacity
      expect(mockMap.setPaintProperty).toHaveBeenCalledWith(
        'rodalies-stations-circles',
        'circle-opacity',
        expect.anything()
      );
    });

    it('should apply dimmed opacity in isolate mode', () => {
      const { rerender } = render(
        <StationLayer
          map={mockMap}
          highlightedLineIds={[]}
          highlightMode="none"
          onStationClick={vi.fn()}
        />
      );

      // Mock that layer exists
      (mockMap.getLayer as ReturnType<typeof vi.fn>).mockReturnValue(true);

      // Clear previous calls
      (mockMap.setPaintProperty as ReturnType<typeof vi.fn>).mockClear();

      // Re-render with isolate mode
      rerender(
        <StationLayer
          map={mockMap}
          highlightedLineIds={['R1']}
          highlightMode="isolate"
          onStationClick={vi.fn()}
        />
      );

      // In isolate mode, non-highlighted stations are filtered out (not dimmed)
      // The remaining visible stations have full opacity
      expect(mockMap.setPaintProperty).toHaveBeenCalledWith(
        'rodalies-stations-circles',
        'circle-opacity',
        1
      );
      // Filter should be applied to only show stations on highlighted lines
      expect(mockMap.setFilter).toHaveBeenCalledWith(
        'rodalies-stations-circles',
        ['any', ['in', 'R1', ['get', 'lines']]]
      );
    });

    it('should not update styles if layers do not exist', () => {
      const { rerender } = render(
        <StationLayer
          map={mockMap}
          highlightedLineIds={[]}
          highlightMode="none"
          onStationClick={vi.fn()}
        />
      );

      // Mock that layers do NOT exist
      (mockMap.getLayer as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

      // Clear previous calls
      (mockMap.setPaintProperty as ReturnType<typeof vi.fn>).mockClear();

      // Re-render
      rerender(
        <StationLayer
          map={mockMap}
          highlightedLineIds={['R1']}
          highlightMode="highlight"
          onStationClick={vi.fn()}
        />
      );

      // Should NOT call setPaintProperty
      expect(mockMap.setPaintProperty).not.toHaveBeenCalled();
    });
  });

  describe('Rendering', () => {
    it('should render nothing (null) to DOM', () => {
      const { container } = render(
        <StationLayer
          map={mockMap}
          highlightedLineIds={[]}
          highlightMode="none"
          onStationClick={vi.fn()}
        />
      );

      expect(container.firstChild).toBeNull();
    });
  });
});
