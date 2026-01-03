/**
 * BusLineLayer Component
 * Feature: 006-metro-bus-integration
 *
 * Renders Barcelona Bus route geometries as Mapbox GL layers.
 * Each route is colored according to its TMB color.
 */

import { useEffect, useState } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import { loadAllBusRoutes } from '../../lib/metro/dataLoader';
import type { MetroLineCollection } from '../../types/metro';
import { useMapStyleReady } from '../../hooks/useMapStyleReady';

export interface BusLineLayerProps {
  map: MapboxMap;
  visible?: boolean;
  /** Optional: highlight specific route codes */
  highlightedRoutes?: string[];
  /** Optional: isolate mode dims non-highlighted routes */
  isolateMode?: boolean;
}

const SOURCE_ID = 'bus-routes-source';
const LINE_LAYER_ID = 'bus-routes';
const LINE_CASING_LAYER_ID = 'bus-routes-casing';

export function BusLineLayer({
  map,
  visible = true,
  highlightedRoutes = [],
  isolateMode = false,
}: BusLineLayerProps) {
  const [geoJSON, setGeoJSON] = useState<MetroLineCollection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const styleReady = useMapStyleReady(map);

  // Load Bus route geometries
  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        setIsLoading(true);
        setError(null);
        const data = await loadAllBusRoutes();
        if (!cancelled) {
          setGeoJSON(data);
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load Bus routes');
          setIsLoading(false);
        }
      }
    }

    loadData();

    return () => {
      cancelled = true;
    };
  }, []);

  // Add source and layers when data is ready
  useEffect(() => {
    if (!map || !geoJSON || isLoading || error || !styleReady) return;

    try {
      // Check if source already exists
      if (map.getSource(SOURCE_ID)) {
        const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource;
        source.setData(geoJSON);
        return;
      }

      // Add source
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: geoJSON,
      });

      // Line casing (outer stroke for contrast)
      map.addLayer({
        id: LINE_CASING_LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#ffffff',
          'line-width': [
            'interpolate',
            ['exponential', 1.5],
            ['zoom'],
            10, 2,
            13, 3,
            15, 5,
            18, 10,
          ],
          'line-opacity': visible ? 0.6 : 0,
        },
      });

      // Main line layer
      map.addLayer({
        id: LINE_LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': [
            'interpolate',
            ['exponential', 1.5],
            ['zoom'],
            10, 1,
            13, 2,
            15, 3,
            18, 6,
          ],
          'line-opacity': visible ? 0.7 : 0,
        },
      });

    } catch {
      // Layer addition failed - source may have been removed
    }

    // Cleanup on unmount
    return () => {
      if (!map.isStyleLoaded()) return;

      try {
        if (map.getLayer(LINE_LAYER_ID)) {
          map.removeLayer(LINE_LAYER_ID);
        }
        if (map.getLayer(LINE_CASING_LAYER_ID)) {
          map.removeLayer(LINE_CASING_LAYER_ID);
        }
        if (map.getSource(SOURCE_ID)) {
          map.removeSource(SOURCE_ID);
        }
      } catch {
        // Cleanup failed - map may have been removed
      }
    };
  // Note: visible intentionally excluded - visibility handled by separate effect
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, geoJSON, isLoading, error, styleReady]);

  // Update visibility and highlighting
  useEffect(() => {
    if (!map || !map.isStyleLoaded()) return;
    if (!map.getLayer(LINE_LAYER_ID) || !map.getLayer(LINE_CASING_LAYER_ID)) return;

    const hasHighlight = highlightedRoutes.length > 0;

    // Build opacity expression based on highlight state
    let lineOpacity: mapboxgl.Expression | number;
    let casingOpacity: mapboxgl.Expression | number;

    if (!visible) {
      lineOpacity = 0;
      casingOpacity = 0;
    } else if (hasHighlight && isolateMode) {
      // In isolate mode, dim non-highlighted routes
      lineOpacity = [
        'case',
        ['in', ['get', 'line_code'], ['literal', highlightedRoutes]],
        0.85,
        0.15,
      ];
      casingOpacity = [
        'case',
        ['in', ['get', 'line_code'], ['literal', highlightedRoutes]],
        0.6,
        0.1,
      ];
    } else if (hasHighlight) {
      // In highlight mode, all routes visible but highlighted are brighter
      lineOpacity = [
        'case',
        ['in', ['get', 'line_code'], ['literal', highlightedRoutes]],
        0.9,
        0.5,
      ];
      casingOpacity = 0.6;
    } else {
      lineOpacity = 0.7;
      casingOpacity = 0.6;
    }

    map.setPaintProperty(LINE_LAYER_ID, 'line-opacity', lineOpacity);
    map.setPaintProperty(LINE_CASING_LAYER_ID, 'line-opacity', casingOpacity);

    // Adjust line width for highlighted routes
    if (hasHighlight) {
      const widthExpression: mapboxgl.Expression = [
        'case',
        ['in', ['get', 'line_code'], ['literal', highlightedRoutes]],
        [
          'interpolate',
          ['exponential', 1.5],
          ['zoom'],
          10, 2,
          13, 3,
          15, 5,
          18, 10,
        ],
        [
          'interpolate',
          ['exponential', 1.5],
          ['zoom'],
          10, 1,
          13, 2,
          15, 3,
          18, 6,
        ],
      ];
      map.setPaintProperty(LINE_LAYER_ID, 'line-width', widthExpression);
    } else {
      map.setPaintProperty(LINE_LAYER_ID, 'line-width', [
        'interpolate',
        ['exponential', 1.5],
        ['zoom'],
        10, 1,
        13, 2,
        15, 3,
        18, 6,
      ]);
    }
  }, [map, visible, highlightedRoutes, isolateMode]);

  return null;
}
