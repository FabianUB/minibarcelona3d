/**
 * StationLayer Component
 * Feature: 004-station-visualization
 *
 * Renders station markers as Mapbox GL layers.
 * Manages station source, circle layers, and event handlers.
 *
 * Tasks: T024-T031
 */

import { useEffect } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import { useStationMarkers } from './hooks/useStationMarkers';
import { getStationMarkerStyles, getMultiLineInnerCircleStyles } from '../../lib/stations/markerStyles';

export interface StationLayerProps {
  /** Mapbox GL map instance (must be loaded) */
  map: MapboxMap;

  /** Currently highlighted line IDs (from MapStateProvider) */
  highlightedLineIds: string[];

  /** Highlight mode: 'none' | 'highlight' | 'isolate' */
  highlightMode: 'none' | 'highlight' | 'isolate';

  /** Callback when user clicks a station marker */
  onStationClick: (stationId: string) => void;

  /** Callback when user hovers over a station marker (desktop only) */
  onStationHover?: (stationId: string | null) => void;
}

const SOURCE_ID = 'stations-source';
const LAYER_ID_SINGLE = 'stations-circles-single';
const LAYER_ID_MULTI_OUTER = 'stations-circles-multi-outer';
const LAYER_ID_MULTI_INNER = 'stations-circles-multi-inner';

/**
 * StationLayer - Renders station markers on the map
 *
 * Responsibilities:
 * - Load station data via useStationMarkers hook
 * - Add Mapbox GL source + layers for station markers
 * - Handle click/hover events on markers
 * - Apply radial offset positioning for overlapping stations
 * - Integrate with line highlighting system
 *
 * Acceptance Criteria:
 * - FR-001: Display all stations from Station.geojson
 * - FR-004: Visually differentiate single vs multi-line stations
 * - FR-012: Prevent overlapping via radial offset
 * - SC-003: Maintain 30+ FPS with 200+ stations
 */
export function StationLayer({
  map,
  highlightedLineIds,
  highlightMode,
  onStationClick,
  onStationHover,
}: StationLayerProps) {
  // Load station data with offsets
  const { geoJSON, isLoading, error } = useStationMarkers({
    map,
    highlightedLineIds,
    highlightMode,
  });

  // Add source and layers when data is ready
  useEffect(() => {
    if (!map || !geoJSON || isLoading || error) return;

    // Check if source already exists
    if (map.getSource(SOURCE_ID)) {
      // Update existing source
      const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource;
      source.setData(geoJSON);
      return;
    }

    // Add source
    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: geoJSON,
    });

    // Determine styling based on highlight mode
    const isAnyLineHighlighted = highlightMode !== 'none' && highlightedLineIds.length > 0;
    const isDimmed = highlightMode === 'isolate' && isAnyLineHighlighted;

    const singleLineStyles = getStationMarkerStyles(false, isDimmed);
    const multiLineStyles = getStationMarkerStyles(false, isDimmed);
    const innerCircleStyles = getMultiLineInnerCircleStyles();

    // Add single-line station layer
    map.addLayer({
      id: LAYER_ID_SINGLE,
      type: 'circle',
      source: SOURCE_ID,
      filter: ['!', ['get', 'isMultiLine']],
      paint: {
        ...singleLineStyles,
        'circle-pitch-alignment': 'map', // Align to map surface (perpendicular to ground)
        'circle-pitch-scale': 'map', // Scale with map pitch
      },
    });

    // Add multi-line station outer circle layer
    map.addLayer({
      id: LAYER_ID_MULTI_OUTER,
      type: 'circle',
      source: SOURCE_ID,
      filter: ['get', 'isMultiLine'],
      paint: {
        ...multiLineStyles,
        'circle-pitch-alignment': 'map', // Align to map surface (perpendicular to ground)
        'circle-pitch-scale': 'map', // Scale with map pitch
      },
    });

    // Add multi-line station inner circle layer
    map.addLayer({
      id: LAYER_ID_MULTI_INNER,
      type: 'circle',
      source: SOURCE_ID,
      filter: ['get', 'isMultiLine'],
      paint: {
        ...innerCircleStyles,
        'circle-pitch-alignment': 'map', // Align to map surface (perpendicular to ground)
        'circle-pitch-scale': 'map', // Scale with map pitch
      },
    });

    // Cleanup on unmount
    return () => {
      if (map.getLayer(LAYER_ID_MULTI_INNER)) {
        map.removeLayer(LAYER_ID_MULTI_INNER);
      }
      if (map.getLayer(LAYER_ID_MULTI_OUTER)) {
        map.removeLayer(LAYER_ID_MULTI_OUTER);
      }
      if (map.getLayer(LAYER_ID_SINGLE)) {
        map.removeLayer(LAYER_ID_SINGLE);
      }
      if (map.getSource(SOURCE_ID)) {
        map.removeSource(SOURCE_ID);
      }
    };
  }, [map, geoJSON, isLoading, error, highlightedLineIds, highlightMode]);

  // Update layer styles when highlighting changes
  useEffect(() => {
    if (!map || !map.getLayer(LAYER_ID_SINGLE)) return;

    const isAnyLineHighlighted = highlightMode !== 'none' && highlightedLineIds.length > 0;
    const isDimmed = highlightMode === 'isolate' && isAnyLineHighlighted;

    const singleLineStyles = getStationMarkerStyles(false, isDimmed);
    const multiLineStyles = getStationMarkerStyles(false, isDimmed);

    // Update paint properties
    Object.entries(singleLineStyles).forEach(([property, value]) => {
      map.setPaintProperty(LAYER_ID_SINGLE, property as any, value);
    });

    Object.entries(multiLineStyles).forEach(([property, value]) => {
      map.setPaintProperty(LAYER_ID_MULTI_OUTER, property as any, value);
    });
  }, [map, highlightedLineIds, highlightMode]);

  // Add click handlers
  useEffect(() => {
    if (!map || !map.getLayer(LAYER_ID_SINGLE)) return;

    const handleClick = (e: mapboxgl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: [LAYER_ID_SINGLE, LAYER_ID_MULTI_OUTER],
      });

      if (features.length > 0 && features[0].properties) {
        onStationClick(features[0].properties.id);
      }
    };

    map.on('click', LAYER_ID_SINGLE, handleClick);
    map.on('click', LAYER_ID_MULTI_OUTER, handleClick);

    // Change cursor on hover
    const handleMouseEnter = () => {
      map.getCanvas().style.cursor = 'pointer';
    };

    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = '';
    };

    map.on('mouseenter', LAYER_ID_SINGLE, handleMouseEnter);
    map.on('mouseenter', LAYER_ID_MULTI_OUTER, handleMouseEnter);
    map.on('mouseleave', LAYER_ID_SINGLE, handleMouseLeave);
    map.on('mouseleave', LAYER_ID_MULTI_OUTER, handleMouseLeave);

    return () => {
      map.off('click', LAYER_ID_SINGLE, handleClick);
      map.off('click', LAYER_ID_MULTI_OUTER, handleClick);
      map.off('mouseenter', LAYER_ID_SINGLE, handleMouseEnter);
      map.off('mouseenter', LAYER_ID_MULTI_OUTER, handleMouseEnter);
      map.off('mouseleave', LAYER_ID_SINGLE, handleMouseLeave);
      map.off('mouseleave', LAYER_ID_MULTI_OUTER, handleMouseLeave);
    };
  }, [map, onStationClick]);

  // Add hover handlers if provided
  useEffect(() => {
    if (!map || !map.getLayer(LAYER_ID_SINGLE) || !onStationHover) return;

    const handleHover = (e: mapboxgl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: [LAYER_ID_SINGLE, LAYER_ID_MULTI_OUTER],
      });

      if (features.length > 0 && features[0].properties) {
        onStationHover(features[0].properties.id);
      } else {
        onStationHover(null);
      }
    };

    const handleMouseLeave = () => {
      onStationHover(null);
    };

    map.on('mousemove', LAYER_ID_SINGLE, handleHover);
    map.on('mousemove', LAYER_ID_MULTI_OUTER, handleHover);
    map.on('mouseleave', LAYER_ID_SINGLE, handleMouseLeave);
    map.on('mouseleave', LAYER_ID_MULTI_OUTER, handleMouseLeave);

    return () => {
      map.off('mousemove', LAYER_ID_SINGLE, handleHover);
      map.off('mousemove', LAYER_ID_MULTI_OUTER, handleHover);
      map.off('mouseleave', LAYER_ID_SINGLE, handleMouseLeave);
      map.off('mouseleave', LAYER_ID_MULTI_OUTER, handleMouseLeave);
    };
  }, [map, onStationHover]);

  // No DOM rendering - this is a pure Mapbox layer component
  return null;
}
