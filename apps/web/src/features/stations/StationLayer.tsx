/**
 * StationLayer Component
 * Feature: 004-station-visualization
 *
 * Renders station markers as Mapbox GL layers.
 * Manages station source, circle layers, and event handlers.
 *
 * Tasks: T024-T031
 */

import { useEffect, useState } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import { useStationMarkers } from './hooks/useStationMarkers';
import { useMapStyleReady } from '../../hooks/useMapStyleReady';
// import { useStationHover } from './hooks/useStationHover'; // TODO: Re-enable when hover is active

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

  /** Whether station layer is visible (controlled by transport filter) */
  visible?: boolean;
}

const SOURCE_ID = 'stations-source';
const LAYER_ID_LOW = 'stations-lowmarkers';
const TEARDROP_IMAGE_ID = 'station-lowzoom-pin';
const TRAIN_LAYER_ID = 'train-layer-3d';

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
  visible = true,
}: StationLayerProps) {
  // Load station data with offsets
  const { geoJSON, isLoading, error } = useStationMarkers({
    map,
    highlightedLineIds,
    highlightMode,
  });
  const [isClickable, setIsClickable] = useState(false);
  const styleReady = useMapStyleReady(map);

  useEffect(() => {
    if (!map) return;
    const updateClickability = () => {
      setIsClickable(map.getZoom() >= 15);
    };
    updateClickability();
    map.on('zoomend', updateClickability);
    return () => {
      map.off('zoomend', updateClickability);
    };
  }, [map]);

  // Add hover tooltip functionality (desktop only)
  // Only enable hover when stations are clickable (zoom >= 15)
  // TODO: Disabled for now - may re-enable in future
  // useStationHover({
  //   map: isClickable ? map : null,
  //   layerIds: [LAYER_ID_LOW],
  //   onStationHover: onStationHover,
  // });

  // Add source and layers when data is ready
  useEffect(() => {
    if (!map || !geoJSON || isLoading || error) return;

    // Guard against map being in invalid state (style not loaded or removed)
    if (!styleReady) return;

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

    // Station teardrop marker layer (all zoom levels)
    // At low zoom (< 15): small marker, no text
    // At high zoom (≥ 15): larger marker with full station name
    map.addLayer({
      id: LAYER_ID_LOW,
      type: 'symbol',
      source: SOURCE_ID,
      layout: {
        'icon-image': TEARDROP_IMAGE_ID,
        'icon-anchor': 'bottom',
        'icon-size': [
          'step',
          ['zoom'],
          0.8, // Below zoom 13.5
          13.5,
          1.1, // Zoom 13.5 to 15
          15,
          1.8, // At zoom 15 and above
        ],
        'icon-allow-overlap': true,
        'symbol-placement': 'point',
        'text-field': [
          'step',
          ['zoom'],
          '', // Below zoom 15: no text
          15,
          ['get', 'name'], // At zoom 15 and above: show full name
        ],
        'text-font': ['Open Sans Bold'],
        'text-transform': 'uppercase',
        'text-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          15,
          12,
          18.5,
          18,
        ],
        'text-letter-spacing': 0.25,
        'text-anchor': 'bottom',
        'text-offset': [
          'interpolate',
          ['linear'],
          ['zoom'],
          15,
          ['literal', [0, -5.5]],
          18.5,
          ['literal', [0, -8.0]],
        ],
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': '#1a1a1a',
        'text-halo-color': '#ffffff',
        'text-halo-width': 2.5,
        'text-halo-blur': 1,
        'text-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          14.5,
          0,
          15,
          1.0,
        ],
      },
    });


    // Cleanup on unmount
    return () => {
      // Guard against map being in invalid state during cleanup
      if (!map.isStyleLoaded()) return;

      if (map.getLayer(LAYER_ID_LOW)) {
        map.removeLayer(LAYER_ID_LOW);
      }
      if (map.getSource(SOURCE_ID)) {
        map.removeSource(SOURCE_ID);
      }
    };
  }, [map, geoJSON, isLoading, error, styleReady]);

  // Update layer styles when highlighting changes
  useEffect(() => {
    if (!map || !styleReady || !map.getLayer(LAYER_ID_LOW)) return;

    const isAnyLineHighlighted = highlightMode !== 'none' && highlightedLineIds.length > 0;
    const isDimmed = highlightMode === 'isolate' && isAnyLineHighlighted;
    const iconOpacity = isDimmed ? 0.3 : 1.0;

    map.setPaintProperty(LAYER_ID_LOW, 'icon-opacity', iconOpacity);
  }, [map, highlightedLineIds, highlightMode, styleReady]);

  // Control layer visibility based on transport filter
  useEffect(() => {
    if (!map || !styleReady || !map.getLayer(LAYER_ID_LOW)) return;

    map.setLayoutProperty(LAYER_ID_LOW, 'visibility', visible ? 'visible' : 'none');
  }, [map, visible, styleReady]);

  // Add click handlers
  useEffect(() => {
    if (!map || !styleReady || !map.getLayer(LAYER_ID_LOW)) return;

    const interactiveLayers = [LAYER_ID_LOW];

    const handleClick = (e: mapboxgl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: interactiveLayers,
      });

      const feature = features[0];
      const stationId =
        feature && feature.properties && typeof feature.properties.id === 'string'
          ? feature.properties.id
          : null;

      if (stationId) {
        onStationClick(stationId);
      }
    };

    const handleMouseEnter = () => {
      map.getCanvas().style.cursor = 'pointer';
    };

    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = '';
    };

    const registerHandlers = () => {
      interactiveLayers.forEach((layerId) => {
        map.on('click', layerId, handleClick);
        map.on('mouseenter', layerId, handleMouseEnter);
        map.on('mouseleave', layerId, handleMouseLeave);
      });
    };

    const unregisterHandlers = () => {
      interactiveLayers.forEach((layerId) => {
        map.off('click', layerId, handleClick);
        map.off('mouseenter', layerId, handleMouseEnter);
        map.off('mouseleave', layerId, handleMouseLeave);
      });
    };

    if (isClickable) {
      registerHandlers();
    }

    return () => {
      unregisterHandlers();
    };
  }, [map, geoJSON, isLoading, error, onStationClick, isClickable, styleReady]);

  // Add hover handlers if provided
  useEffect(() => {
    if (!map || !onStationHover || !isClickable) return;
    if (!styleReady || !map.getLayer(LAYER_ID_LOW)) return;

    const interactiveLayers = [LAYER_ID_LOW];

    const handleHover = (e: mapboxgl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: interactiveLayers,
      });

      const feature = features[0];
      const stationId =
        feature && feature.properties && typeof feature.properties.id === 'string'
          ? feature.properties.id
          : null;

      onStationHover(stationId);
    };

    const handleMouseLeave = () => {
      onStationHover(null);
    };

    const registerHandlers = () => {
      interactiveLayers.forEach((layerId) => {
        map.on('mousemove', layerId, handleHover);
        map.on('mouseleave', layerId, handleMouseLeave);
      });
    };

    const unregisterHandlers = () => {
      interactiveLayers.forEach((layerId) => {
        map.off('mousemove', layerId, handleHover);
        map.off('mouseleave', layerId, handleMouseLeave);
      });
    };

    registerHandlers();

    return () => {
      unregisterHandlers();
    };
  }, [map, geoJSON, isLoading, error, onStationHover, isClickable, styleReady]);


  // Register teardrop icon for station markers
  // Larger base size for better clickability at high zoom
  useEffect(() => {
    if (!map || map.hasImage(TEARDROP_IMAGE_ID)) {
      return;
    }
    const size = 80; // Increased from 64 for larger base icon
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return undefined;
    }

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#EE7F00';
    ctx.beginPath();
    // Larger teardrop shape
    ctx.arc(size / 2, size / 2 - 10, 18, Math.PI, 0, false);
    ctx.lineTo(size / 2 + 14, size - 15);
    ctx.lineTo(size / 2, size - 5);
    ctx.lineTo(size / 2 - 14, size - 15);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2 - 10, 9, 0, Math.PI * 2);
    ctx.fill();

    const imageData = ctx.getImageData(0, 0, size, size);
    map.addImage(TEARDROP_IMAGE_ID, imageData, { pixelRatio: 2 });

    return () => {
      if (map.hasImage(TEARDROP_IMAGE_ID)) {
        map.removeImage(TEARDROP_IMAGE_ID);
      }
    };
  }, [map]);

  // Keep station layer beneath 3D trains so models always overlay markers.
  useEffect(() => {
    if (!map) return;

    const moveStationsBelowTrains = () => {
      // Guard against map being in invalid state
      if (!map.isStyleLoaded()) return;

      if (!map.getLayer(TRAIN_LAYER_ID)) {
        return;
      }
      if (map.getLayer(LAYER_ID_LOW)) {
        map.moveLayer(LAYER_ID_LOW, TRAIN_LAYER_ID);
      }
    };

    map.on('idle', moveStationsBelowTrains);
    moveStationsBelowTrains();

    return () => {
      map.off('idle', moveStationsBelowTrains);
    };
  }, [map, geoJSON, isLoading, error]);

  // No DOM rendering - this is a pure Mapbox layer component
  return null;
}
