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
  onStopClick?: (stopId: string, stopName: string) => void;
}

const SOURCE_ID = 'bus-stops-source';
const CIRCLE_LAYER_ID = 'bus-stops-circles';
const LABEL_LAYER_ID = 'bus-stops-labels';

export function BusStopLayer({
  map,
  visible = true,
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

  // Update visibility when prop changes
  useEffect(() => {
    if (!map || !map.isStyleLoaded()) return;

    if (map.getLayer(CIRCLE_LAYER_ID)) {
      map.setPaintProperty(CIRCLE_LAYER_ID, 'circle-opacity', visible ? 0.8 : 0);
      map.setPaintProperty(CIRCLE_LAYER_ID, 'circle-stroke-opacity', visible ? 0.8 : 0);
    }
    if (map.getLayer(LABEL_LAYER_ID)) {
      map.setPaintProperty(LABEL_LAYER_ID, 'text-opacity', [
        'step',
        ['zoom'],
        0,
        15, visible ? 0.9 : 0,
      ]);
    }
  }, [map, visible]);

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
  }, [map, handleClick, onStopClick, geoJSON]);

  return null;
}
