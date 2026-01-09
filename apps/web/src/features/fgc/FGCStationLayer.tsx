/**
 * FGCStationLayer Component
 * Feature: 006-metro-bus-integration
 *
 * Renders FGC (Ferrocarrils de la Generalitat de Catalunya) station markers
 * as Mapbox GL layers. Uses circle markers with station names at high zoom.
 */

import { useEffect, useState, useCallback } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import { loadFgcStations } from '../../lib/metro/dataLoader';
import type { MetroStationCollection } from '../../types/metro';
import { useMapStyleReady } from '../../hooks/useMapStyleReady';

export interface FGCStationLayerProps {
  map: MapboxMap;
  visible?: boolean;
  /** Lines to highlight/isolate (e.g., ['S1', 'S2']) */
  highlightedLines?: string[];
  /** When true, only show stations on highlighted lines */
  isolateMode?: boolean;
  onStationClick?: (stationId: string, stationName: string) => void;
}

const SOURCE_ID = 'fgc-stations-source';
const CIRCLE_LAYER_ID = 'fgc-stations-circles';
const LABEL_LAYER_ID = 'fgc-stations-labels';

// FGC orange color (fallback)
const FGC_COLOR = '#e67300';

export function FGCStationLayer({
  map,
  visible = true,
  highlightedLines = [],
  isolateMode = false,
  onStationClick,
}: FGCStationLayerProps) {
  const [geoJSON, setGeoJSON] = useState<MetroStationCollection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const styleReady = useMapStyleReady(map);

  // Load FGC station data
  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        setIsLoading(true);
        setError(null);
        const data = await loadFgcStations();
        if (!cancelled) {
          setGeoJSON(data);
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load FGC stations');
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

      // Circle layer for station markers
      map.addLayer({
        id: CIRCLE_LAYER_ID,
        type: 'circle',
        source: SOURCE_ID,
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10, 3,
            13, 5,
            15, 8,
            18, 12,
          ],
          'circle-color': ['coalesce', ['get', 'primary_color'], FGC_COLOR],
          'circle-stroke-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10, 1,
            15, 2,
            18, 3,
          ],
          'circle-stroke-color': '#ffffff',
          'circle-opacity': visible ? 1 : 0,
          'circle-stroke-opacity': visible ? 1 : 0,
        },
      });

      // Label layer for station names (high zoom only)
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
            14, 10,
            16, 12,
            18, 14,
          ],
          'text-anchor': 'top',
          'text-offset': [0, 0.8],
          'text-allow-overlap': false,
          'text-optional': true,
        },
        paint: {
          'text-color': '#1a1a1a',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.5,
          'text-opacity': [
            'step',
            ['zoom'],
            0,
            14, visible ? 1 : 0,
          ],
        },
        minzoom: 13.5,
      });

    } catch {
      // Layer addition failed
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
        // Cleanup failed
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

    const hasHighlight = highlightedLines.length > 0;

    // Build filter for isolate mode
    // Station data has "lines" array property - check if any highlighted line is in it
    let filter: mapboxgl.FilterSpecification | null = null;
    if (isolateMode && hasHighlight) {
      // Create filter: show station if ANY of its lines match ANY highlighted line
      const lineFilters = highlightedLines.map((lineId) => [
        'in',
        lineId,
        ['get', 'lines'],
      ]);
      filter = ['any', ...lineFilters] as mapboxgl.FilterSpecification;
    }

    // Apply filter to both layers
    map.setFilter(CIRCLE_LAYER_ID, filter);
    map.setFilter(LABEL_LAYER_ID, filter);

    // Build opacity based on highlight state
    let circleOpacity: mapboxgl.Expression | number;
    let strokeOpacity: mapboxgl.Expression | number;
    let textOpacity: mapboxgl.Expression | number;

    if (!visible) {
      circleOpacity = 0;
      strokeOpacity = 0;
      textOpacity = 0;
    } else if (hasHighlight && !isolateMode) {
      // Highlight mode: dim stations that don't serve highlighted lines
      const isHighlighted: mapboxgl.Expression = [
        'any',
        ...highlightedLines.map((lineId) => ['in', lineId, ['get', 'lines']]),
      ];
      circleOpacity = ['case', isHighlighted, 1.0, 0.4];
      strokeOpacity = ['case', isHighlighted, 1.0, 0.4];
      textOpacity = ['step', ['zoom'], 0, 14, ['case', isHighlighted, 1.0, 0.4]];
    } else {
      circleOpacity = 1;
      strokeOpacity = 1;
      textOpacity = ['step', ['zoom'], 0, 14, 1];
    }

    // Update visibility
    if (map.getLayer(CIRCLE_LAYER_ID)) {
      map.setPaintProperty(CIRCLE_LAYER_ID, 'circle-opacity', circleOpacity);
      map.setPaintProperty(CIRCLE_LAYER_ID, 'circle-stroke-opacity', strokeOpacity);
    }
    if (map.getLayer(LABEL_LAYER_ID)) {
      map.setPaintProperty(LABEL_LAYER_ID, 'text-opacity', textOpacity);
    }
  }, [map, visible, highlightedLines, isolateMode]);

  // Click handler
  const handleClick = useCallback(
    (e: mapboxgl.MapMouseEvent) => {
      if (!onStationClick) return;

      const features = map.queryRenderedFeatures(e.point, {
        layers: [CIRCLE_LAYER_ID],
      });

      if (features.length > 0) {
        const feature = features[0];
        const stationId = feature.properties?.id;
        const stationName = feature.properties?.name;
        if (stationId && stationName) {
          onStationClick(stationId, stationName);
        }
      }
    },
    [map, onStationClick]
  );

  // Register click handlers
  useEffect(() => {
    if (!map || !onStationClick) return;
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
  }, [map, handleClick, onStationClick]);

  return null;
}
