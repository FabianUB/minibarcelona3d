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
        'stations-source',
        expect.objectContaining({
          type: 'geojson',
        })
      );

      // Should add one layer (teardrop symbol layer)
      expect(mockMap.addLayer).toHaveBeenCalledTimes(1);

      // Check layer ID
      const layerIds = (mockMap.addLayer as ReturnType<typeof vi.fn>).mock.calls.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (call: any) => call[0].id
      );
      expect(layerIds).toContain('stations-lowmarkers');
    });

    it('should create symbol layer with text labels', () => {
      render(
        <StationLayer
          map={mockMap}
          highlightedLineIds={[]}
          highlightMode="none"
          onStationClick={vi.fn()}
        />
      );

      const layerCall = (mockMap.addLayer as ReturnType<typeof vi.fn>).mock.calls[0];
      const layer = layerCall[0];

      // Should be a symbol layer
      expect(layer.type).toBe('symbol');

      // Should have icon and text configuration
      expect(layer.layout).toHaveProperty('icon-image');
      expect(layer.layout).toHaveProperty('text-field');
      expect(layer.layout).toHaveProperty('text-font');
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

    it('should clean up layer and source on unmount', () => {
      const { unmount } = render(
        <StationLayer
          map={mockMap}
          highlightedLineIds={[]}
          highlightMode="none"
          onStationClick={vi.fn()}
        />
      );

      // Mock that layer exists
      mockLayers.set('stations-lowmarkers', {
        id: 'stations-lowmarkers',
        type: 'symbol',
        source: 'stations-source',
      });
      mockSources.set('stations-source', {
        type: 'geojson',
        data: null,
        setData: vi.fn(),
      });

      unmount();

      expect(mockMap.removeLayer).toHaveBeenCalledWith('stations-lowmarkers');
      expect(mockMap.removeSource).toHaveBeenCalledWith('stations-source');
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
      expect(mockMap.on).toHaveBeenCalledWith('click', 'stations-lowmarkers', expect.any(Function));
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
      expect(mockMap.on).toHaveBeenCalledWith('mouseenter', 'stations-lowmarkers', expect.any(Function));

      // Should register mouseleave handlers
      expect(mockMap.on).toHaveBeenCalledWith('mouseleave', 'stations-lowmarkers', expect.any(Function));
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
      const clickHandler = mockEventHandlers.get('click')?.get('stations-lowmarkers');
      expect(clickHandler).toBeDefined();

      // Simulate click
      clickHandler!({ point: { x: 100, y: 100 } });

      expect(mockOnStationClick).toHaveBeenCalledWith('station-123');
    });

    it('should register hover handlers when onStationHover provided', () => {
      const mockOnStationHover = vi.fn();

      render(
        <StationLayer
          map={mockMap}
          highlightedLineIds={[]}
          highlightMode="none"
          onStationClick={vi.fn()}
          onStationHover={mockOnStationHover}
        />
      );

      // Mock that layer exists
      (mockMap.getLayer as ReturnType<typeof vi.fn>).mockReturnValue(true);

      // Should register mousemove handler
      expect(mockMap.on).toHaveBeenCalledWith('mousemove', 'stations-lowmarkers', expect.any(Function));
    });

    it('should remove all event handlers on unmount', () => {
      const { unmount } = render(
        <StationLayer
          map={mockMap}
          highlightedLineIds={[]}
          highlightMode="none"
          onStationClick={vi.fn()}
          onStationHover={vi.fn()}
        />
      );

      // Mock that layer exists
      (mockMap.getLayer as ReturnType<typeof vi.fn>).mockReturnValue(true);

      unmount();

      // Should remove click handler
      expect(mockMap.off).toHaveBeenCalledWith('click', 'stations-lowmarkers', expect.any(Function));

      // Should remove mouse handlers
      expect(mockMap.off).toHaveBeenCalledWith('mouseenter', 'stations-lowmarkers', expect.any(Function));
      expect(mockMap.off).toHaveBeenCalledWith('mouseleave', 'stations-lowmarkers', expect.any(Function));

      // Should remove hover handler
      expect(mockMap.off).toHaveBeenCalledWith('mousemove', 'stations-lowmarkers', expect.any(Function));
    });
  });

  describe('Style Updates', () => {
    it('should update icon opacity when highlighting changes', () => {
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

      // Should update icon opacity
      expect(mockMap.setPaintProperty).toHaveBeenCalledWith(
        'stations-lowmarkers',
        'icon-opacity',
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

      // Should set opacity to 0.3 (dimmed)
      expect(mockMap.setPaintProperty).toHaveBeenCalledWith(
        'stations-lowmarkers',
        'icon-opacity',
        0.3
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
