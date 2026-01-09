/**
 * BusStopLayer Component
 * Feature: 006-metro-bus-integration
 *
 * Renders Barcelona Bus stop markers as Mapbox GL layers.
 * Uses smaller circle markers colored by route with stop names at high zoom.
 */

import { useEffect, useState, useCallback } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import { loadBusStops } from '../../lib/metro/dataLoader';
import type { MetroStationCollection } from '../../types/metro';
import { useMapStyleReady } from '../../hooks/useMapStyleReady';

export interface BusStopLayerProps {
  map: MapboxMap;
  visible?: boolean;
  /** Routes to highlight/isolate (e.g., ['H10', 'V15']) */
  highlightedRoutes?: string[];
  /** When true, only show stops on highlighted routes */
  isolateMode?: boolean;
  onStopClick?: (stopId: string, stopName: string) => void;
}

const SOURCE_ID = 'bus-stops-source';
const CIRCLE_LAYER_ID = 'bus-stops-circles';
const LABEL_LAYER_ID = 'bus-stops-labels';

export function BusStopLayer({
  map,
  visible = true,
  highlightedRoutes = [],
  isolateMode = false,
  onStopClick,
}: BusStopLayerProps) {
  const [geoJSON, setGeoJSON] = useState<MetroStationCollection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const styleReady = useMapStyleReady(map);

  // Load Bus stop data
  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        setIsLoading(true);
        setError(null);
        const data = await loadBusStops();
        if (!cancelled) {
          setGeoJSON(data);
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load Bus stops');
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

      // Circle layer for bus stop markers (smaller than metro stations)
      map.addLayer({
        id: CIRCLE_LAYER_ID,
        type: 'circle',
        source: SOURCE_ID,
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10, 2,
            13, 3,
            15, 5,
            18, 8,
          ],
          'circle-color': ['get', 'primary_color'],
          'circle-stroke-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10, 0.5,
            15, 1,
            18, 2,
          ],
          'circle-stroke-color': '#ffffff',
          'circle-opacity': visible ? 0.8 : 0,
          'circle-stroke-opacity': visible ? 0.8 : 0,
        },
        // Only show bus stops at higher zoom levels
        minzoom: 13,
      });

      // Label layer for stop names (high zoom only)
      map.addLayer({
        id: LABEL_LAYER_ID,
        type: 'symbol',
        source: SOURCE_ID,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Bold'],
          'text-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            15, 9,
            16, 10,
            18, 12,
          ],
          'text-anchor': 'top',
          'text-offset': [0, 0.6],
          'text-allow-overlap': false,
          'text-optional': true,
        },
        paint: {
          'text-color': '#333333',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1,
          'text-opacity': [
            'step',
            ['zoom'],
            0,
            15, visible ? 0.9 : 0,
          ],
        },
        minzoom: 15,
      });

    } catch {
      // Layer addition failed - source may have been removed
    }

    // Cleanup on unmount
    return () => {
      if (!map.isStyleLoaded()) return;

      try {
        if (map.getLayer(LABEL_LAYER_ID)) {
          map.removeLayer(LABEL_LAYER_ID);
        }
        if (map.getLayer(CIRCLE_LAYER_ID)) {
          map.removeLayer(CIRCLE_LAYER_ID);
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

  // Update visibility and filtering when props change
  useEffect(() => {
    if (!map) return;
    // Skip isStyleLoaded check - if layers exist, we can update them
    if (!map.getLayer(CIRCLE_LAYER_ID) || !map.getLayer(LABEL_LAYER_ID)) return;

    const hasHighlight = highlightedRoutes.length > 0;

    // Build filter for isolate mode
    // Stop data has "lines" array property - check if any highlighted route is in it
    let filter: mapboxgl.FilterSpecification | null = null;
    if (isolateMode && hasHighlight) {
      // Create filter: show stop if ANY of its lines match ANY highlighted route
      const routeFilters = highlightedRoutes.map((routeCode) => [
        'in',
        routeCode,
        ['get', 'lines'],
      ]);
      filter = ['any', ...routeFilters] as mapboxgl.FilterSpecification;
    }

    // Apply filter to both layers
    map.setFilter(CIRCLE_LAYER_ID, filter);
    map.setFilter(LABEL_LAYER_ID, filter);

    // Build opacity based on highlight state
    // Bus stops use slightly lower base opacity (0.8) to reduce visual clutter
    let circleOpacity: mapboxgl.Expression | number;
    let strokeOpacity: mapboxgl.Expression | number;
    let textOpacity: mapboxgl.Expression | number;

    if (!visible) {
      circleOpacity = 0;
      strokeOpacity = 0;
      textOpacity = 0;
    } else if (hasHighlight && !isolateMode) {
      // Highlight mode: dim stops that don't serve highlighted routes
      const isHighlighted: mapboxgl.Expression = [
        'any',
        ...highlightedRoutes.map((routeCode) => ['in', routeCode, ['get', 'lines']]),
      ];
      circleOpacity = ['case', isHighlighted, 0.8, 0.3];
      strokeOpacity = ['case', isHighlighted, 0.8, 0.3];
      textOpacity = ['step', ['zoom'], 0, 15, ['case', isHighlighted, 0.9, 0.3]];
    } else {
      circleOpacity = 0.8;
      strokeOpacity = 0.8;
      textOpacity = ['step', ['zoom'], 0, 15, 0.9];
    }

    // Update visibility
    if (map.getLayer(CIRCLE_LAYER_ID)) {
      map.setPaintProperty(CIRCLE_LAYER_ID, 'circle-opacity', circleOpacity);
      map.setPaintProperty(CIRCLE_LAYER_ID, 'circle-stroke-opacity', strokeOpacity);
    }
    if (map.getLayer(LABEL_LAYER_ID)) {
      map.setPaintProperty(LABEL_LAYER_ID, 'text-opacity', textOpacity);
    }
  }, [map, visible, highlightedRoutes, isolateMode]);

  // Click handler
  const handleClick = useCallback(
    (e: mapboxgl.MapMouseEvent) => {
      if (!onStopClick) return;

      const features = map.queryRenderedFeatures(e.point, {
        layers: [CIRCLE_LAYER_ID],
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
    [map, onStopClick]
  );

  // Register click handlers
  useEffect(() => {
    if (!map || !onStopClick) return;
    if (!map.isStyleLoaded() || !map.getLayer(CIRCLE_LAYER_ID)) return;

    const handleMouseEnter = () => {
      map.getCanvas().style.cursor = 'pointer';
    };

    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = '';
    };

    map.on('click', CIRCLE_LAYER_ID, handleClick);
    map.on('mouseenter', CIRCLE_LAYER_ID, handleMouseEnter);
    map.on('mouseleave', CIRCLE_LAYER_ID, handleMouseLeave);

    return () => {
      map.off('click', CIRCLE_LAYER_ID, handleClick);
      map.off('mouseenter', CIRCLE_LAYER_ID, handleMouseEnter);
      map.off('mouseleave', CIRCLE_LAYER_ID, handleMouseLeave);
    };
  }, [map, handleClick, onStopClick]);

  return null;
}
