/**
 * GenericLineLayer Component
 *
 * A unified Mapbox line layer component for all transit networks.
 * Supports Metro, Bus, Tram, FGC with network-specific styling.
 *
 * This component eliminates ~700 lines of duplicate code across
 * MetroLineLayer, BusLineLayer, TramLineLayer, and FGCLineLayer.
 */

import { useEffect, useState, useMemo } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import type { MetroLineCollection } from '../../types/metro';
import { useMapStyleReady } from '../../hooks/useMapStyleReady';

// ============================================================================
// Types
// ============================================================================

/**
 * Line width configuration for zoom interpolation
 */
export interface LineWidthConfig {
  /** Width at zoom 10 */
  zoom10: number;
  /** Width at zoom 13 */
  zoom13: number;
  /** Width at zoom 15 */
  zoom15: number;
  /** Width at zoom 18 */
  zoom18: number;
}

/**
 * Opacity configuration for normal and highlight states
 */
export interface OpacityConfig {
  /** Normal line opacity (no highlight) */
  line: number;
  /** Normal casing opacity */
  casing: number;
  /** Highlighted line opacity */
  highlightedLine: number;
  /** Non-highlighted line opacity in highlight mode */
  dimmedLine: number;
  /** Highlighted casing opacity */
  highlightedCasing: number;
  /** Non-highlighted casing opacity in isolate mode */
  dimmedCasing: number;
}

/**
 * Configuration for a line layer
 */
export interface LineLayerConfig {
  /** Unique source ID for Mapbox */
  sourceId: string;
  /** Main line layer ID */
  lineLayerId: string;
  /** Casing layer ID */
  casingLayerId: string;
  /** GeoJSON property name for line/route code */
  lineCodeProperty: string;
  /** Line width configuration */
  lineWidth: LineWidthConfig;
  /** Casing width configuration */
  casingWidth: LineWidthConfig;
  /** Opacity configuration */
  opacity: OpacityConfig;
}

export interface GenericLineLayerProps {
  map: MapboxMap;
  /** Function to load GeoJSON data */
  loadData: () => Promise<MetroLineCollection>;
  /** Layer configuration */
  config: LineLayerConfig;
  /** Whether the layer is visible */
  visible?: boolean;
  /** Line codes to highlight */
  highlightedLines?: string[];
  /** Whether to dim non-highlighted lines */
  isolateMode?: boolean;
  /** Optional: filter function for features */
  filterFeatures?: (features: MetroLineCollection['features']) => MetroLineCollection['features'];
}

// ============================================================================
// Default Configurations
// ============================================================================

const DEFAULT_LINE_WIDTH: LineWidthConfig = {
  zoom10: 2,
  zoom13: 3,
  zoom15: 5,
  zoom18: 10,
};

const DEFAULT_CASING_WIDTH: LineWidthConfig = {
  zoom10: 3,
  zoom13: 5,
  zoom15: 8,
  zoom18: 14,
};

const DEFAULT_OPACITY: OpacityConfig = {
  line: 0.9,
  casing: 0.8,
  highlightedLine: 0.95,
  dimmedLine: 0.2,
  highlightedCasing: 0.8,
  dimmedCasing: 0.1,
};

// ============================================================================
// Preset Configurations for Each Network
// ============================================================================

export const METRO_LINE_CONFIG: LineLayerConfig = {
  sourceId: 'metro-lines-source',
  lineLayerId: 'metro-lines',
  casingLayerId: 'metro-lines-casing',
  lineCodeProperty: 'line_code',
  lineWidth: DEFAULT_LINE_WIDTH,
  casingWidth: DEFAULT_CASING_WIDTH,
  opacity: DEFAULT_OPACITY,
};

export const BUS_LINE_CONFIG: LineLayerConfig = {
  sourceId: 'bus-routes-source',
  lineLayerId: 'bus-routes',
  casingLayerId: 'bus-routes-casing',
  lineCodeProperty: 'route_code',
  lineWidth: { zoom10: 1, zoom13: 2, zoom15: 3, zoom18: 6 },
  casingWidth: { zoom10: 2, zoom13: 3, zoom15: 5, zoom18: 10 },
  opacity: {
    line: 0.7,
    casing: 0.6,
    highlightedLine: 0.85,
    dimmedLine: 0.15,
    highlightedCasing: 0.6,
    dimmedCasing: 0.1,
  },
};

export const TRAM_LINE_CONFIG: LineLayerConfig = {
  sourceId: 'tram-lines-source',
  lineLayerId: 'tram-lines',
  casingLayerId: 'tram-lines-casing',
  lineCodeProperty: 'line_code',
  lineWidth: DEFAULT_LINE_WIDTH,
  casingWidth: DEFAULT_CASING_WIDTH,
  opacity: DEFAULT_OPACITY,
};

export const FGC_LINE_CONFIG: LineLayerConfig = {
  sourceId: 'fgc-lines-source',
  lineLayerId: 'fgc-lines',
  casingLayerId: 'fgc-lines-casing',
  lineCodeProperty: 'line_code',
  lineWidth: DEFAULT_LINE_WIDTH,
  casingWidth: DEFAULT_CASING_WIDTH,
  opacity: DEFAULT_OPACITY,
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a zoom-based width interpolation expression
 */
function createWidthExpression(config: LineWidthConfig): mapboxgl.Expression {
  return [
    'interpolate',
    ['exponential', 1.5],
    ['zoom'],
    10, config.zoom10,
    13, config.zoom13,
    15, config.zoom15,
    18, config.zoom18,
  ];
}

/**
 * Create a highlighted width expression
 */
function createHighlightedWidthExpression(
  config: LineWidthConfig,
  lineCodeProperty: string,
  highlightedLines: string[]
): mapboxgl.Expression {
  const isHighlighted: mapboxgl.Expression = [
    'in',
    ['get', lineCodeProperty],
    ['literal', highlightedLines],
  ];

  // Highlighted lines are 50% wider
  return [
    'interpolate',
    ['exponential', 1.5],
    ['zoom'],
    10, ['case', isHighlighted, config.zoom10 * 1.5, config.zoom10],
    13, ['case', isHighlighted, config.zoom13 * 1.5, config.zoom13],
    15, ['case', isHighlighted, config.zoom15 * 1.4, config.zoom15],
    18, ['case', isHighlighted, config.zoom18 * 1.4, config.zoom18],
  ];
}

// ============================================================================
// Component
// ============================================================================

export function GenericLineLayer({
  map,
  loadData,
  config,
  visible = true,
  highlightedLines = [],
  isolateMode = false,
  filterFeatures,
}: GenericLineLayerProps) {
  const [rawGeoJSON, setRawGeoJSON] = useState<MetroLineCollection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [layersReady, setLayersReady] = useState(false);
  const styleReady = useMapStyleReady(map);

  const { sourceId, lineLayerId, casingLayerId, lineCodeProperty, lineWidth, casingWidth, opacity } =
    config;

  // Apply optional filtering to GeoJSON
  const geoJSON = useMemo(() => {
    if (!rawGeoJSON) return null;
    if (!filterFeatures) return rawGeoJSON;

    return {
      ...rawGeoJSON,
      features: filterFeatures(rawGeoJSON.features),
    };
  }, [rawGeoJSON, filterFeatures]);

  // Load line geometries
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setIsLoading(true);
        setError(null);
        const data = await loadData();
        if (!cancelled) {
          setRawGeoJSON(data);
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load line data');
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

      // Line casing (outer stroke for contrast)
      map.addLayer({
        id: casingLayerId,
        type: 'line',
        source: sourceId,
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#ffffff',
          'line-width': createWidthExpression(casingWidth),
          'line-opacity': 0, // Start hidden
        },
      });

      // Main line layer
      map.addLayer({
        id: lineLayerId,
        type: 'line',
        source: sourceId,
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': createWidthExpression(lineWidth),
          'line-opacity': 0, // Start hidden
        },
      });

      setLayersReady(true);
    } catch {
      // Layer addition failed
    }

    // Cleanup on unmount
    return () => {
      setLayersReady(false);
      if (!map.isStyleLoaded()) return;

      try {
        if (map.getLayer(lineLayerId)) {
          map.removeLayer(lineLayerId);
        }
        if (map.getLayer(casingLayerId)) {
          map.removeLayer(casingLayerId);
        }
        if (map.getSource(sourceId)) {
          map.removeSource(sourceId);
        }
      } catch {
        // Cleanup failed
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, geoJSON, isLoading, error, styleReady, sourceId, lineLayerId, casingLayerId]);

  // Update visibility and highlighting
  useEffect(() => {
    if (!map || !layersReady) return;
    if (!map.getLayer(lineLayerId) || !map.getLayer(casingLayerId)) return;

    const hasHighlight = highlightedLines.length > 0;

    // Build opacity expression based on highlight state
    let lineOpacity: mapboxgl.Expression | number;
    let casingOpacity: mapboxgl.Expression | number;

    if (!visible) {
      lineOpacity = 0;
      casingOpacity = 0;
    } else if (hasHighlight && isolateMode) {
      // In isolate mode, dim non-highlighted lines
      lineOpacity = [
        'case',
        ['in', ['get', lineCodeProperty], ['literal', highlightedLines]],
        opacity.highlightedLine,
        opacity.dimmedLine,
      ];
      casingOpacity = [
        'case',
        ['in', ['get', lineCodeProperty], ['literal', highlightedLines]],
        opacity.highlightedCasing,
        opacity.dimmedCasing,
      ];
    } else if (hasHighlight) {
      // In highlight mode, all lines visible but highlighted are brighter
      lineOpacity = [
        'case',
        ['in', ['get', lineCodeProperty], ['literal', highlightedLines]],
        opacity.highlightedLine,
        opacity.line * 0.8,
      ];
      casingOpacity = opacity.casing;
    } else {
      lineOpacity = opacity.line;
      casingOpacity = opacity.casing;
    }

    map.setPaintProperty(lineLayerId, 'line-opacity', lineOpacity);
    map.setPaintProperty(casingLayerId, 'line-opacity', casingOpacity);

    // Adjust line width for highlighted lines
    if (hasHighlight) {
      const widthExpression = createHighlightedWidthExpression(
        lineWidth,
        lineCodeProperty,
        highlightedLines
      );
      map.setPaintProperty(lineLayerId, 'line-width', widthExpression);
    } else {
      map.setPaintProperty(lineLayerId, 'line-width', createWidthExpression(lineWidth));
    }
  }, [
    map,
    visible,
    highlightedLines,
    isolateMode,
    layersReady,
    lineLayerId,
    casingLayerId,
    lineCodeProperty,
    lineWidth,
    opacity,
  ]);

  return null;
}
