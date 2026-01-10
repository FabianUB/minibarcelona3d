/**
 * GenericStopLayer Component
 *
 * A unified Mapbox stop/station layer component for all transit networks.
 * Supports Metro, Bus, Tram, FGC with network-specific styling.
 *
 * This component eliminates ~800 lines of duplicate code across
 * MetroStationLayer, BusStopLayer, TramStopLayer, and FGCStationLayer.
 */

import { useEffect, useState, useCallback } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import type { MetroStationCollection } from '../../types/metro';
import { useMapStyleReady } from '../../hooks/useMapStyleReady';

// ============================================================================
// Types
// ============================================================================

/**
 * Circle radius configuration for zoom interpolation
 */
export interface CircleRadiusConfig {
  zoom10: number;
  zoom13: number;
  zoom15: number;
  zoom18: number;
}

/**
 * Stroke width configuration for zoom interpolation
 */
export interface StrokeWidthConfig {
  zoom10: number;
  zoom15: number;
  zoom18: number;
}

/**
 * Label text size configuration for zoom interpolation
 */
export interface LabelSizeConfig {
  zoom14: number;
  zoom16: number;
  zoom18: number;
}

/**
 * Opacity configuration for normal and highlight states
 */
export interface StopOpacityConfig {
  /** Normal circle opacity */
  circle: number;
  /** Normal stroke opacity */
  stroke: number;
  /** Highlighted circle opacity */
  highlightedCircle: number;
  /** Dimmed circle opacity */
  dimmedCircle: number;
}

/**
 * Configuration for a stop layer
 */
export interface StopLayerConfig {
  /** Unique source ID for Mapbox */
  sourceId: string;
  /** Circle layer ID */
  circleLayerId: string;
  /** Label layer ID */
  labelLayerId: string;
  /** Circle radius configuration */
  circleRadius: CircleRadiusConfig;
  /** Stroke width configuration */
  strokeWidth: StrokeWidthConfig;
  /** Label text size configuration */
  labelSize: LabelSizeConfig;
  /** Opacity configuration */
  opacity: StopOpacityConfig;
  /** Fallback color if primary_color not present */
  fallbackColor?: string;
  /** Minimum zoom for circle layer */
  circleMinZoom?: number;
  /** Minimum zoom for label layer */
  labelMinZoom: number;
  /** Zoom at which labels start appearing */
  labelStartZoom: number;
  /** Text offset for label */
  labelOffset: number;
  /** Allow text overlap at high zoom */
  textAllowOverlap?: boolean;
  /** Make text optional (can be hidden for space) */
  textOptional?: boolean;
}

export interface GenericStopLayerProps {
  map: MapboxMap;
  /** Function to load GeoJSON data */
  loadData: () => Promise<MetroStationCollection>;
  /** Layer configuration */
  config: StopLayerConfig;
  /** Whether the layer is visible */
  visible?: boolean;
  /** Line codes to highlight */
  highlightedLines?: string[];
  /** Whether to only show stops on highlighted lines */
  isolateMode?: boolean;
  /** Click handler for stops */
  onStopClick?: (stopId: string, stopName: string) => void;
}

// ============================================================================
// Default Configurations
// ============================================================================

const DEFAULT_CIRCLE_RADIUS: CircleRadiusConfig = {
  zoom10: 3,
  zoom13: 5,
  zoom15: 8,
  zoom18: 12,
};

const DEFAULT_STROKE_WIDTH: StrokeWidthConfig = {
  zoom10: 1,
  zoom15: 2,
  zoom18: 3,
};

const DEFAULT_LABEL_SIZE: LabelSizeConfig = {
  zoom14: 10,
  zoom16: 12,
  zoom18: 14,
};

const DEFAULT_OPACITY: StopOpacityConfig = {
  circle: 1,
  stroke: 1,
  highlightedCircle: 1,
  dimmedCircle: 0.4,
};

// ============================================================================
// Preset Configurations for Each Network
// ============================================================================

export const METRO_STOP_CONFIG: StopLayerConfig = {
  sourceId: 'metro-stations-source',
  circleLayerId: 'metro-stations-circles',
  labelLayerId: 'metro-stations-labels',
  circleRadius: DEFAULT_CIRCLE_RADIUS,
  strokeWidth: DEFAULT_STROKE_WIDTH,
  labelSize: DEFAULT_LABEL_SIZE,
  opacity: DEFAULT_OPACITY,
  labelMinZoom: 13.5,
  labelStartZoom: 14,
  labelOffset: 0.8,
  textAllowOverlap: true,
  textOptional: false,
};

export const BUS_STOP_CONFIG: StopLayerConfig = {
  sourceId: 'bus-stops-source',
  circleLayerId: 'bus-stops-circles',
  labelLayerId: 'bus-stops-labels',
  circleRadius: { zoom10: 2, zoom13: 3, zoom15: 5, zoom18: 8 },
  strokeWidth: { zoom10: 0.5, zoom15: 1, zoom18: 2 },
  labelSize: { zoom14: 9, zoom16: 10, zoom18: 12 },
  opacity: { circle: 0.8, stroke: 0.8, highlightedCircle: 0.8, dimmedCircle: 0.3 },
  circleMinZoom: 13,
  labelMinZoom: 15,
  labelStartZoom: 15,
  labelOffset: 0.6,
  textAllowOverlap: false,
  textOptional: true,
};

export const TRAM_STOP_CONFIG: StopLayerConfig = {
  sourceId: 'tram-stops-source',
  circleLayerId: 'tram-stops-circles',
  labelLayerId: 'tram-stops-labels',
  circleRadius: { zoom10: 3, zoom13: 5, zoom15: 7, zoom18: 10 },
  strokeWidth: DEFAULT_STROKE_WIDTH,
  labelSize: DEFAULT_LABEL_SIZE,
  opacity: DEFAULT_OPACITY,
  fallbackColor: '#009933', // TRAM green
  labelMinZoom: 13.5,
  labelStartZoom: 14,
  labelOffset: 0.8,
  textAllowOverlap: false,
  textOptional: true,
};

export const FGC_STOP_CONFIG: StopLayerConfig = {
  sourceId: 'fgc-stations-source',
  circleLayerId: 'fgc-stations-circles',
  labelLayerId: 'fgc-stations-labels',
  circleRadius: DEFAULT_CIRCLE_RADIUS,
  strokeWidth: DEFAULT_STROKE_WIDTH,
  labelSize: DEFAULT_LABEL_SIZE,
  opacity: DEFAULT_OPACITY,
  fallbackColor: '#e67300', // FGC orange
  labelMinZoom: 13.5,
  labelStartZoom: 14,
  labelOffset: 0.8,
  textAllowOverlap: false,
  textOptional: true,
};

// ============================================================================
// Component
// ============================================================================

export function GenericStopLayer({
  map,
  loadData,
  config,
  visible = true,
  highlightedLines = [],
  isolateMode = false,
  onStopClick,
}: GenericStopLayerProps) {
  const [geoJSON, setGeoJSON] = useState<MetroStationCollection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const styleReady = useMapStyleReady(map);

  const {
    sourceId,
    circleLayerId,
    labelLayerId,
    circleRadius,
    strokeWidth,
    labelSize,
    opacity,
    fallbackColor,
    circleMinZoom,
    labelMinZoom,
    labelStartZoom,
    labelOffset,
    textAllowOverlap = false,
    textOptional = true,
  } = config;

  // Load stop data
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setIsLoading(true);
        setError(null);
        const data = await loadData();
        if (!cancelled) {
          setGeoJSON(data);
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load stop data');
          setIsLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [loadData]);

  // Add source and layers when data is ready
  useEffect(() => {
    if (!map || !geoJSON || isLoading || error || !styleReady) return;

    try {
      // Check if source already exists
      if (map.getSource(sourceId)) {
        const source = map.getSource(sourceId) as mapboxgl.GeoJSONSource;
        source.setData(geoJSON);
        return;
      }

      // Add source
      map.addSource(sourceId, {
        type: 'geojson',
        data: geoJSON,
      });

      // Circle layer for stop markers
      const circleLayerSpec: mapboxgl.CircleLayerSpecification = {
        id: circleLayerId,
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10, circleRadius.zoom10,
            13, circleRadius.zoom13,
            15, circleRadius.zoom15,
            18, circleRadius.zoom18,
          ],
          'circle-color': fallbackColor
            ? ['coalesce', ['get', 'primary_color'], fallbackColor]
            : ['get', 'primary_color'],
          'circle-stroke-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10, strokeWidth.zoom10,
            15, strokeWidth.zoom15,
            18, strokeWidth.zoom18,
          ],
          'circle-stroke-color': '#ffffff',
          'circle-opacity': visible ? opacity.circle : 0,
          'circle-stroke-opacity': visible ? opacity.stroke : 0,
        },
      };

      if (circleMinZoom !== undefined) {
        circleLayerSpec.minzoom = circleMinZoom;
      }

      map.addLayer(circleLayerSpec);

      // Label layer for stop names
      map.addLayer({
        id: labelLayerId,
        type: 'symbol',
        source: sourceId,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Bold'],
          'text-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            14, labelSize.zoom14,
            16, labelSize.zoom16,
            18, labelSize.zoom18,
          ],
          'text-anchor': 'top',
          'text-offset': [0, labelOffset],
          'text-allow-overlap': textAllowOverlap
            ? ['step', ['zoom'], false, 17, true]
            : false,
          'text-optional': textOptional
            ? ['step', ['zoom'], true, 17, false]
            : true,
        },
        paint: {
          'text-color': '#1a1a1a',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.5,
          'text-opacity': ['step', ['zoom'], 0, labelStartZoom, visible ? 1 : 0],
        },
        minzoom: labelMinZoom,
      });
    } catch {
      // Layer addition failed
    }

    // Cleanup on unmount
    return () => {
      if (!map.isStyleLoaded()) return;

      try {
        if (map.getLayer(labelLayerId)) {
          map.removeLayer(labelLayerId);
        }
        if (map.getLayer(circleLayerId)) {
          map.removeLayer(circleLayerId);
        }
        if (map.getSource(sourceId)) {
          map.removeSource(sourceId);
        }
      } catch {
        // Cleanup failed
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, geoJSON, isLoading, error, styleReady, sourceId, circleLayerId, labelLayerId]);

  // Update visibility and filtering when props change
  useEffect(() => {
    if (!map) return;
    if (!map.getLayer(circleLayerId) || !map.getLayer(labelLayerId)) return;

    const hasHighlight = highlightedLines.length > 0;

    // Build filter for isolate mode
    let filter: mapboxgl.FilterSpecification | null = null;
    if (isolateMode && hasHighlight) {
      const lineFilters = highlightedLines.map((lineId) => ['in', lineId, ['get', 'lines']]);
      filter = ['any', ...lineFilters] as mapboxgl.FilterSpecification;
    }

    // Apply filter to both layers
    map.setFilter(circleLayerId, filter);
    map.setFilter(labelLayerId, filter);

    // Build opacity based on highlight state
    let circleOpacity: mapboxgl.Expression | number;
    let strokeOpacity: mapboxgl.Expression | number;
    let textOpacity: mapboxgl.Expression | number;

    if (!visible) {
      circleOpacity = 0;
      strokeOpacity = 0;
      textOpacity = 0;
    } else if (hasHighlight && !isolateMode) {
      // Highlight mode: dim stops that don't serve highlighted lines
      const isHighlighted: mapboxgl.Expression = [
        'any',
        ...highlightedLines.map((lineId) => ['in', lineId, ['get', 'lines']]),
      ];
      circleOpacity = ['case', isHighlighted, opacity.highlightedCircle, opacity.dimmedCircle];
      strokeOpacity = ['case', isHighlighted, opacity.stroke, opacity.dimmedCircle];
      textOpacity = [
        'step',
        ['zoom'],
        0,
        labelStartZoom,
        ['case', isHighlighted, 1.0, opacity.dimmedCircle],
      ];
    } else {
      circleOpacity = opacity.circle;
      strokeOpacity = opacity.stroke;
      textOpacity = ['step', ['zoom'], 0, labelStartZoom, 1];
    }

    // Update visibility
    if (map.getLayer(circleLayerId)) {
      map.setPaintProperty(circleLayerId, 'circle-opacity', circleOpacity);
      map.setPaintProperty(circleLayerId, 'circle-stroke-opacity', strokeOpacity);
    }
    if (map.getLayer(labelLayerId)) {
      map.setPaintProperty(labelLayerId, 'text-opacity', textOpacity);
    }
  }, [
    map,
    visible,
    highlightedLines,
    isolateMode,
    circleLayerId,
    labelLayerId,
    opacity,
    labelStartZoom,
  ]);

  // Click handler
  const handleClick = useCallback(
    (e: mapboxgl.MapMouseEvent) => {
      if (!onStopClick) return;

      const features = map.queryRenderedFeatures(e.point, {
        layers: [circleLayerId],
      });

      if (features.length > 0) {
        const feature = features[0];
        const stopId = feature.properties?.id;
        const stopName = feature.properties?.name;
        if (stopId && stopName) {
          onStopClick(stopId, stopName);
        }
      }
    },
    [map, onStopClick, circleLayerId]
  );

  // Register click handlers
  useEffect(() => {
    if (!map || !onStopClick) return;
    if (!map.isStyleLoaded() || !map.getLayer(circleLayerId)) return;

    const handleMouseEnter = () => {
      map.getCanvas().style.cursor = 'pointer';
    };

    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = '';
    };

    map.on('click', circleLayerId, handleClick);
    map.on('mouseenter', circleLayerId, handleMouseEnter);
    map.on('mouseleave', circleLayerId, handleMouseLeave);

    return () => {
      map.off('click', circleLayerId, handleClick);
      map.off('mouseenter', circleLayerId, handleMouseEnter);
      map.off('mouseleave', circleLayerId, handleMouseLeave);
    };
  }, [map, handleClick, onStopClick, circleLayerId]);

  return null;
}
