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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { StationLayer } from '../StationLayer';
import type { Map as MapboxMap } from 'mapbox-gl';
import * as useStationMarkersHook from '../hooks/useStationMarkers';

// Mock useStationMarkers hook
vi.mock('../hooks/useStationMarkers');

// Mock mapbox-gl types
type MockSource = {
  type: string;
  data: any;
  setData: ReturnType<typeof vi.fn>;
};

type MockLayer = {
  id: string;
  type: string;
  source: string;
  filter?: any;
  paint?: any;
};

describe('StationLayer', () => {
  let mockMap: MapboxMap;
  let mockSources: Map<string, MockSource>;
  let mockLayers: Map<string, MockLayer>;
  let mockEventHandlers: Map<string, Map<string, any>>;

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
      addSource: vi.fn((id: string, config: any) => {
        mockSources.set(id, {
          ...config,
          setData: vi.fn((data: any) => {
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
      addLayer: vi.fn((config: any) => {
        mockLayers.set(config.id, config);
      }),
      removeLayer: vi.fn((id: string) => {
        mockLayers.delete(id);
      }),
      setPaintProperty: vi.fn((layerId: string, property: string, value: any) => {
        const layer = mockLayers.get(layerId);
        if (layer) {
          layer.paint = layer.paint || {};
          layer.paint[property] = value;
        }
      }),
      on: vi.fn((event: string, layerIdOrCallback: string | Function, callback?: Function) => {
        const eventKey = typeof layerIdOrCallback === 'string' ? layerIdOrCallback : 'map';
        const handler = callback || layerIdOrCallback;

        if (!mockEventHandlers.has(event)) {
          mockEventHandlers.set(event, new Map());
        }
        mockEventHandlers.get(event)!.set(eventKey, handler);
      }),
      off: vi.fn((event: string, layerIdOrCallback: string | Function, callback?: Function) => {
        const eventKey = typeof layerIdOrCallback === 'string' ? layerIdOrCallback : 'map';
        const handlers = mockEventHandlers.get(event);
        if (handlers) {
          handlers.delete(eventKey);
        }
      }),
      getCanvas: vi.fn(() => ({
        style: {
          cursor: '',
        },
      })),
      queryRenderedFeatures: vi.fn(() => []),
    } as unknown as MapboxMap;
  });

  afterEach(() => {
    cleanup();
  });

  describe('Layer Creation', () => {
    it('should add source and three circle layers on mount', () => {
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

      // Should add three layers
      expect(mockMap.addLayer).toHaveBeenCalledTimes(3);

      // Check layer IDs
      expect(mockMap.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'stations-circles-single',
          type: 'circle',
          source: 'stations-source',
        })
      );

      expect(mockMap.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'stations-circles-multi-outer',
          type: 'circle',
          source: 'stations-source',
        })
      );

      expect(mockMap.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'stations-circles-multi-inner',
          type: 'circle',
          source: 'stations-source',
        })
      );
    });

    it('should apply pitch alignment properties to all layers', () => {
      render(
        <StationLayer
          map={mockMap}
          highlightedLineIds={[]}
          highlightMode="none"
          onStationClick={vi.fn()}
        />
      );

      // Get all addLayer calls
      const calls = (mockMap.addLayer as ReturnType<typeof vi.fn>).mock.calls;

      // All three layers should have pitch alignment
      calls.forEach((call: any) => {
        const layerConfig = call[0];
        expect(layerConfig.paint).toHaveProperty('circle-pitch-alignment', 'map');
        expect(layerConfig.paint).toHaveProperty('circle-pitch-scale', 'map');
      });
    });

    it('should filter single-line and multi-line stations correctly', () => {
      render(
        <StationLayer
          map={mockMap}
          highlightedLineIds={[]}
          highlightMode="none"
          onStationClick={vi.fn()}
        />
      );

      // Single-line layer should filter OUT multi-line stations
      const singleLineCall = (mockMap.addLayer as ReturnType<typeof vi.fn>).mock.calls.find(
        (call: any) => call[0].id === 'stations-circles-single'
      );
      expect(singleLineCall[0].filter).toEqual(['!', ['get', 'isMultiLine']]);

      // Multi-line layers should filter FOR multi-line stations
      const multiOuterCall = (mockMap.addLayer as ReturnType<typeof vi.fn>).mock.calls.find(
        (call: any) => call[0].id === 'stations-circles-multi-outer'
      );
      expect(multiOuterCall[0].filter).toEqual(['get', 'isMultiLine']);

      const multiInnerCall = (mockMap.addLayer as ReturnType<typeof vi.fn>).mock.calls.find(
        (call: any) => call[0].id === 'stations-circles-multi-inner'
      );
      expect(multiInnerCall[0].filter).toEqual(['get', 'isMultiLine']);
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
      mockLayers.set('stations-circles-single', {
        id: 'stations-circles-single',
        type: 'circle',
        source: 'stations-source',
      });
      mockLayers.set('stations-circles-multi-outer', {
        id: 'stations-circles-multi-outer',
        type: 'circle',
        source: 'stations-source',
      });
      mockLayers.set('stations-circles-multi-inner', {
        id: 'stations-circles-multi-inner',
        type: 'circle',
        source: 'stations-source',
      });
      mockSources.set('stations-source', {
        type: 'geojson',
        data: null,
        setData: vi.fn(),
      });

      unmount();

      expect(mockMap.removeLayer).toHaveBeenCalledWith('stations-circles-multi-inner');
      expect(mockMap.removeLayer).toHaveBeenCalledWith('stations-circles-multi-outer');
      expect(mockMap.removeLayer).toHaveBeenCalledWith('stations-circles-single');
      expect(mockMap.removeSource).toHaveBeenCalledWith('stations-source');
    });
  });

  describe('Event Handlers', () => {
    it('should register click handlers on both layer types', () => {
      render(
        <StationLayer
          map={mockMap}
          highlightedLineIds={[]}
          highlightMode="none"
          onStationClick={vi.fn()}
        />
      );

      // Mock that layers exist
      (mockMap.getLayer as ReturnType<typeof vi.fn>).mockReturnValue(true);

      // Should register click handlers
      expect(mockMap.on).toHaveBeenCalledWith(
        'click',
        'stations-circles-single',
        expect.any(Function)
      );
      expect(mockMap.on).toHaveBeenCalledWith(
        'click',
        'stations-circles-multi-outer',
        expect.any(Function)
      );
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

      // Mock that layers exist
      (mockMap.getLayer as ReturnType<typeof vi.fn>).mockReturnValue(true);

      // Should register mouseenter handlers
      expect(mockMap.on).toHaveBeenCalledWith(
        'mouseenter',
        'stations-circles-single',
        expect.any(Function)
      );
      expect(mockMap.on).toHaveBeenCalledWith(
        'mouseenter',
        'stations-circles-multi-outer',
        expect.any(Function)
      );

      // Should register mouseleave handlers
      expect(mockMap.on).toHaveBeenCalledWith(
        'mouseleave',
        'stations-circles-single',
        expect.any(Function)
      );
      expect(mockMap.on).toHaveBeenCalledWith(
        'mouseleave',
        'stations-circles-multi-outer',
        expect.any(Function)
      );
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

      // Mock that layers exist
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
      const clickHandler = mockEventHandlers.get('click')?.get('stations-circles-single');
      expect(clickHandler).toBeDefined();

      // Simulate click
      clickHandler({ point: { x: 100, y: 100 } });

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

      // Mock that layers exist
      (mockMap.getLayer as ReturnType<typeof vi.fn>).mockReturnValue(true);

      // Should register mousemove handlers
      expect(mockMap.on).toHaveBeenCalledWith(
        'mousemove',
        'stations-circles-single',
        expect.any(Function)
      );
      expect(mockMap.on).toHaveBeenCalledWith(
        'mousemove',
        'stations-circles-multi-outer',
        expect.any(Function)
      );
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

      // Mock that layers exist
      (mockMap.getLayer as ReturnType<typeof vi.fn>).mockReturnValue(true);

      unmount();

      // Should remove click handlers
      expect(mockMap.off).toHaveBeenCalledWith(
        'click',
        'stations-circles-single',
        expect.any(Function)
      );
      expect(mockMap.off).toHaveBeenCalledWith(
        'click',
        'stations-circles-multi-outer',
        expect.any(Function)
      );

      // Should remove mouse handlers
      expect(mockMap.off).toHaveBeenCalledWith(
        'mouseenter',
        'stations-circles-single',
        expect.any(Function)
      );
      expect(mockMap.off).toHaveBeenCalledWith(
        'mouseleave',
        'stations-circles-single',
        expect.any(Function)
      );

      // Should remove hover handlers
      expect(mockMap.off).toHaveBeenCalledWith(
        'mousemove',
        'stations-circles-single',
        expect.any(Function)
      );
    });
  });

  describe('Style Updates', () => {
    it('should update paint properties when highlighting changes', () => {
      const { rerender } = render(
        <StationLayer
          map={mockMap}
          highlightedLineIds={[]}
          highlightMode="none"
          onStationClick={vi.fn()}
        />
      );

      // Mock that layers exist
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

      // Should update paint properties
      expect(mockMap.setPaintProperty).toHaveBeenCalled();
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

      // Mock that layers exist
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
        expect.any(String),
        'circle-opacity',
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
