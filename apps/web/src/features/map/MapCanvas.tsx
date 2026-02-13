import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';

import 'mapbox-gl/dist/mapbox-gl.css';
import '../../styles/map.css';

import { useMapActions, useMapHighlightSelectors, useMapCore, useMapUI, useMapNetwork } from '../../state/map';
import { useDefaultViewport } from './useDefaultViewport';
import { RecenterControl } from './controls/RecenterControl';
import { ServiceUnavailable } from './ServiceUnavailable';
import { LoadingOverlay, type LoadingStages } from './LoadingOverlay';
import type { MapViewport } from '../../types/rodalies';
import { startMetric, endMetric } from '../../lib/analytics/perf';
// import { TrainMarkers } from '../trains/TrainMarkers'; // Phase B - replaced by TrainLayer3D
import { TrainLayer3D, type RaycastDebugInfo } from '../trains/TrainLayer3D';
import { RodaliesLineLayer } from '../trains/RodaliesLineLayer';
import { ControlPanel } from '../controlPanel';
import type { TrainPosition } from '../../types/trains';
import { setModelOrigin } from '../../lib/map/coordinates';
import { StationLayer } from '../stations/StationLayer';
import { MetroLineLayer, MetroStationLayer } from '../metro';
import { BusLineLayer, BusStopLayer } from '../bus';
import { TramLineLayer, TramStopLayer } from '../tram';
import { FGCLineLayer, FGCStationLayer } from '../fgc';
// TransportFilterButton replaced by ControlPanel
import { TransitVehicleLayer3D } from '../transit';
import { DataFreshnessIndicator } from '../status';
import { AlertBadge } from './AlertBadge';
import type { MapActions as MapActionsType } from '../../state/map/types';
import { VehicleClickCoordinator } from '../../lib/map/VehicleClickCoordinator';

// Using streets-v12 for 3D buildings and natural colors (parks, water)
// Similar to MiniTokyo3D's custom style but with built-in 3D building support
const MAPBOX_STYLE_URL = 'mapbox://styles/mapbox/streets-v12';
const MAPBOX_TOKEN =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_MAPBOX_TOKEN) ||
  '';

const SHOW_CAMERA_DEBUG = false;
const DEBUG_TOGGLE_EVENT = 'debug-tools-toggle';

type MapboxWindow = Window & {
  __MAPBOX_INSTANCE__?: mapboxgl.Map;
  __MAP_ACTIONS__?: Partial<MapActionsType>;
};

function getGlobalWindow(): MapboxWindow {
  return window as MapboxWindow;
}

function getViewportFromMap(map: mapboxgl.Map, base: MapViewport): MapViewport {
  const center = map.getCenter();
  return {
    center: { lat: center.lat, lng: center.lng },
    zoom: map.getZoom(),
    max_bounds: base.max_bounds,
    padding: base.padding,
  };
}

function areViewportsEqual(a: MapViewport, b: MapViewport, tolerance = 1e-6) {
  return (
    Math.abs(a.center.lat - b.center.lat) <= tolerance &&
    Math.abs(a.center.lng - b.center.lng) <= tolerance &&
    Math.abs(a.zoom - b.zoom) <= tolerance
  );
}

export function MapCanvas() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const recenterControlRef = useRef<RecenterControl | null>(null);
  const latestRecenterRef = useRef<() => void>(() => {});
  const initialViewportRef = useRef<MapViewport | null>(null);
  const skipMoveSyncRef = useRef(false);

  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [geometryWarning, setGeometryWarning] = useState<string | null>(null);
  const [tileError, setTileError] = useState<string | null>(null);
  const [tileErrorCount, setTileErrorCount] = useState(0);
  const [cameraSnapshot, setCameraSnapshot] = useState<string>('');
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const copyFeedbackTimeoutRef = useRef<number | null>(null);
  const [raycastDebugInfo, setRaycastDebugInfo] = useState<RaycastDebugInfo | null>(null);
  const [isStationDebugMode, setIsStationDebugMode] = useState(false);
  const [trainPositions, setTrainPositions] = useState<TrainPosition[]>([]);
  const [loadingStages, setLoadingStages] = useState<LoadingStages>({
    map: false,
    models: false,
    trains: false,
  });

  // Mesh position getters from each layer (for VehicleListView click-to-zoom)
  const meshPositionGettersRef = useRef<Map<string, (vehicleKey: string) => [number, number] | null>>(new Map());

  // Single click coordinator for all 3D vehicle layers
  const clickCoordinatorRef = useRef(new VehicleClickCoordinator());
  const [debugToolsEnabled, setDebugToolsEnabled] = useState(
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')
  );
  const [serviceUnavailable, setServiceUnavailable] = useState<{
    type: 'rate-limit' | 'auth' | 'network' | 'unknown';
  } | null>(() => {
    // Debug: Allow testing ServiceUnavailable page via URL parameter
    // Usage: ?service-error=rate-limit or ?service-error=auth or ?service-error=network
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const errorType = params.get('service-error');
      if (errorType === 'rate-limit' || errorType === 'auth' || errorType === 'network') {
        return { type: errorType };
      }
    }
    return null;
  });

  const mapActions = useMapActions();
  const {
    setMapInstance,
    setMapLoaded,
    setViewport,
  } = mapActions;
  // Note: useMapHighlightSelectors still needed for backwards compatibility with other components
  useMapHighlightSelectors();
  const { mapInstance, isMapLoaded } = useMapCore();
  const { isHighContrast, showStations } = useMapUI();
  const { transportFilters, networkHighlights, modelSizes, showOnlyTopBusLines, activeControlTab } = useMapNetwork();
  const {
    effectiveViewport,
    error: viewportError,
    recenter,
  } = useDefaultViewport();

  // Keep a ref to current transportFilters for use in closures
  const transportFiltersRef = useRef(transportFilters);
  transportFiltersRef.current = transportFilters;

  // Callbacks to register mesh position getters from each layer
  const handleRodaliesMeshPositionGetterReady = useCallback(
    (getter: (vehicleKey: string) => [number, number] | null) => {
      meshPositionGettersRef.current.set('rodalies', getter);
    },
    []
  );

  const handleMetroMeshPositionGetterReady = useCallback(
    (getter: (vehicleKey: string) => [number, number] | null) => {
      meshPositionGettersRef.current.set('metro', getter);
    },
    []
  );

  const handleBusMeshPositionGetterReady = useCallback(
    (getter: (vehicleKey: string) => [number, number] | null) => {
      meshPositionGettersRef.current.set('bus', getter);
    },
    []
  );

  const handleTramMeshPositionGetterReady = useCallback(
    (getter: (vehicleKey: string) => [number, number] | null) => {
      meshPositionGettersRef.current.set('tram', getter);
    },
    []
  );

  const handleFgcMeshPositionGetterReady = useCallback(
    (getter: (vehicleKey: string) => [number, number] | null) => {
      meshPositionGettersRef.current.set('fgc', getter);
    },
    []
  );

  // Callback for TrainLayer3D loading stage changes
  const handleTrainLoadingStageChange = useCallback(
    (stages: { models: boolean; trains: boolean }) => {
      setLoadingStages((prev) => ({
        ...prev,
        models: stages.models,
        trains: stages.trains,
      }));
    },
    []
  );

  // Coordinated click handler: one click handler for all vehicle layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const canvas = map.getCanvas();
    const coordinator = clickCoordinatorRef.current;

    const handleClick = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const point = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };

      const result = coordinator.resolveClick(point, 4);
      if (result) {
        void result.onSelect(result.hit);
      }
    };

    canvas.addEventListener('click', handleClick);
    return () => {
      canvas.removeEventListener('click', handleClick);
    };
  }, [mapInstance]);

  // Aggregated getMeshPosition function that queries all registered layers
  const getMeshPosition = useCallback(
    (vehicleKey: string): [number, number] | null => {
      // Try each layer's getter until one returns a position
      for (const getter of meshPositionGettersRef.current.values()) {
        const position = getter(vehicleKey);
        if (position) {
          return position;
        }
      }
      return null;
    },
    []
  );

  if (!initialViewportRef.current) {
    initialViewportRef.current = effectiveViewport;
  }

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const handler = (event: Event) => {
        const detail = (event as CustomEvent<{ enabled: boolean }>).detail;
        if (detail && typeof detail.enabled === 'boolean') {
          setDebugToolsEnabled(detail.enabled);
        }
      };
      window.addEventListener(DEBUG_TOGGLE_EVENT, handler as EventListener);
      return () => window.removeEventListener(DEBUG_TOGGLE_EVENT, handler as EventListener);
    }
  }, []);

  useEffect(() => {
    if (!debugToolsEnabled && isStationDebugMode) {
      setIsStationDebugMode(false);
    }
  }, [debugToolsEnabled, isStationDebugMode]);

  useEffect(() => {
    if (!initialViewportRef.current) {
      initialViewportRef.current = effectiveViewport;
      return;
    }
    if (!areViewportsEqual(initialViewportRef.current, effectiveViewport)) {
      initialViewportRef.current = effectiveViewport;
    }
  }, [effectiveViewport]);

  latestRecenterRef.current = recenter;

  const statusSegments = useMemo(() => {
    const messages: string[] = [];
    if (viewportError) {
      messages.push(viewportError);
    }
    if (statusMessage) {
      messages.push(statusMessage);
    }
    if (geometryWarning && geometryWarning !== viewportError) {
      messages.push(geometryWarning);
    }
    if (tileError) {
      messages.push(tileError);
    }
    return Array.from(new Set(messages));
  }, [geometryWarning, statusMessage, viewportError, tileError]);

  const hasStatus = statusSegments.length > 0;
  const statusText = statusSegments.join(' • ');
  const statusIsWarning = Boolean(viewportError || geometryWarning || tileError);

  const handleCopyCameraSnapshot = useCallback(
    (event: React.MouseEvent<HTMLInputElement>) => {
      if (!cameraSnapshot) {
        return;
      }

      event.currentTarget.select();
      event.currentTarget.setSelectionRange(0, cameraSnapshot.length);

      const copyText = async () => {
        if (navigator && 'clipboard' in navigator && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(cameraSnapshot);
        } else {
          throw new Error('Clipboard API not available');
        }
      };

      copyText()
        .then(() => {
          setCopyFeedback('Copied!');
        })
        .catch(() => {
          setCopyFeedback('Copy failed');
        })
        .finally(() => {
          if (copyFeedbackTimeoutRef.current !== null) {
            window.clearTimeout(copyFeedbackTimeoutRef.current);
          }
          copyFeedbackTimeoutRef.current = window.setTimeout(() => {
            setCopyFeedback(null);
            copyFeedbackTimeoutRef.current = null;
          }, 1500);
        });
    },
    [cameraSnapshot],
  );

  useEffect(() => {
    return () => {
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
        copyFeedbackTimeoutRef.current = null;
      }
    };
  }, []);

  // Apply high contrast theme to document root
  useEffect(() => {
    const root = document.documentElement;
    if (isHighContrast) {
      root.setAttribute('data-map-theme', 'high-contrast');
    } else {
      root.removeAttribute('data-map-theme');
    }
  }, [isHighContrast]);

  useEffect(() => {
    const globalWindow = getGlobalWindow();
    globalWindow.__MAP_ACTIONS__ = {
      selectStation: mapActions.selectStation,
      highlightLine: mapActions.highlightLine,
      isolateLine: mapActions.isolateLine,
      clearHighlightedLine: mapActions.clearHighlightedLine,
      toggleLine: mapActions.toggleLine,
    };
    return () => {
      if (globalWindow.__MAP_ACTIONS__) {
        delete globalWindow.__MAP_ACTIONS__;
      }
    };
  }, [mapActions]);

  const updateCameraSnapshot = useCallback(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const center = map.getCenter();
    const snapshot = {
      center: {
        lat: Number(center.lat.toFixed(6)),
        lng: Number(center.lng.toFixed(6)),
      },
      zoom: Number(map.getZoom().toFixed(2)),
      pitch: Number(map.getPitch().toFixed(2)),
      bearing: Number(map.getBearing().toFixed(2)),
    };

    setCameraSnapshot(JSON.stringify(snapshot));
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    if (!MAPBOX_TOKEN) {
      setError(
        'Missing Mapbox token. Add VITE_MAPBOX_TOKEN=your_token_here to your .env file. Get your token at https://account.mapbox.com/access-tokens/',
      );
      return;
    }

    // Validate token format (basic check)
    if (!MAPBOX_TOKEN.startsWith('pk.') && !MAPBOX_TOKEN.startsWith('sk.')) {
      setError(
        'Invalid Mapbox token format. Tokens should start with "pk." (public) or "sk." (secret). Check your VITE_MAPBOX_TOKEN value.',
      );
      return;
    }

    mapboxgl.accessToken = MAPBOX_TOKEN;
    setError(null);

    // Start tracking initial map render time
    startMetric('initial-render', { viewport: initialViewportRef.current });

    // Use minimum 2x pixel ratio for crisp rendering on all displays
    // This improves quality on lower DPI monitors at slight GPU cost
    const pixelRatio = Math.max(window.devicePixelRatio, 2);

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAPBOX_STYLE_URL,
      center: [
        initialViewportRef.current!.center.lng,
        initialViewportRef.current!.center.lat,
      ],
      zoom: initialViewportRef.current!.zoom,
      pitch: 60, // MiniTokyo3D style 3D perspective
      bearing: 0,
      maxBounds: initialViewportRef.current!.max_bounds,
      minZoom: 8,
      maxZoom: 16.5,
      maxPitch: 60,
      attributionControl: true,
      pixelRatio, // Valid option, not in types
    } as mapboxgl.MapOptions);

    map.addControl(
      new mapboxgl.NavigationControl({
        showCompass: true, // Enable compass for 3D view navigation
        visualizePitch: true,
      }),
      'top-right',
    );

    const recenterControl = new RecenterControl(() => {
      latestRecenterRef.current();
    });
    map.addControl(recenterControl, 'top-right');
    recenterControlRef.current = recenterControl;

    const globalWindow = getGlobalWindow();
    globalWindow.__MAPBOX_INSTANCE__ = map;

    mapRef.current = map;
    setMapInstance(map);
    setMapLoaded(false);
    updateCameraSnapshot();

    // NOTE: Rodalies line geometry is now loaded by RodaliesLineLayer component
    // which uses GenericLineLayer for consistency with other transit networks.

    const handleLoad = () => {
      endMetric('initial-render');
      setMapLoaded(true);
      // Update loading stages for the loading overlay
      setLoadingStages((prev) => ({ ...prev, map: true }));

      // Initialize model origin for Three.js coordinate system (T052e)
      // MUST be called before any 3D objects are positioned
      setModelOrigin(map.getCenter());
      updateCameraSnapshot();

      // Add 3D buildings layer explicitly (similar to MiniTokyo3D)
      const layers = map.getStyle().layers;
      // Find the first symbol layer to insert buildings before labels
      const firstSymbolId = layers?.find((layer) => layer.type === 'symbol')?.id;

      // Hide POI, building numbers, and other labels for cleaner view
      const labelsToHide = [
        'poi-label',
        'transit-label',
        'airport-label',
        'settlement-subdivision-label',
        'settlement-minor-label',
        'settlement-major-label',
        'state-label',
        'country-label',
        'place-label',
        'natural-point-label',
        'natural-line-label',
        'water-point-label',
        'water-line-label',
        'waterway-label',
        'road-label',
        'road-number',
        'road-exit',
      ];

      layers?.forEach((layer) => {
        if (layer.type === 'symbol' && labelsToHide.some((label) => layer.id.includes(label))) {
          map.setLayoutProperty(layer.id, 'visibility', 'none');
        }
      });

      // Add 3D building extrusions if not already present
      const buildingLayerId = '3d-buildings';

      if (!map.getLayer(buildingLayerId)) {
        map.addLayer(
          {
            id: buildingLayerId,
            source: 'composite',
            'source-layer': 'building',
            filter: ['==', 'extrude', 'true'],
            type: 'fill-extrusion',
            minzoom: 14,
            paint: {
              'fill-extrusion-color': [
                'interpolate',
                ['linear'],
                ['get', 'height'],
                0,
                'rgba(200, 200, 200, 0.8)',
                50,
                'rgba(180, 180, 180, 0.8)',
                100,
                'rgba(160, 160, 160, 0.8)',
              ],
              'fill-extrusion-height': [
                'interpolate',
                ['linear'],
                ['zoom'],
                14,
                0,
                14.5,
                ['get', 'height'],
              ],
              'fill-extrusion-base': [
                'interpolate',
                ['linear'],
                ['zoom'],
                14,
                0,
                14.5,
                ['get', 'min_height'],
              ],
              'fill-extrusion-opacity': 0.45,
            },
          },
          firstSymbolId,
        );
      }

      // T052f: Reduce opacity to 40-50% for better train visibility
      if (map.getLayer(buildingLayerId)) {
        map.setPaintProperty(buildingLayerId, 'fill-extrusion-opacity', 0.45);
      }

      // Rodalies line geometry is now loaded by RodaliesLineLayer component
      const baseViewport =
        initialViewportRef.current ?? effectiveViewport;
      setViewport(getViewportFromMap(map, baseViewport));
    };

    // Handle map errors including rate limits and auth issues
    const handleMapError = (event: { error?: Error & { status?: number }; tile?: { tileID: { canonical: { x: number; y: number; z: number } } }; source?: { id: string } }) => {
      const status = event.error?.status;
      const message = event.error?.message || '';

      // Check for rate limit (429) or unauthorized (401) errors
      if (status === 429 || message.includes('429') || message.toLowerCase().includes('rate limit')) {
        console.error('Mapbox rate limit exceeded:', message);
        setServiceUnavailable({ type: 'rate-limit' });
        return;
      }

      if (status === 401 || status === 403 || message.includes('401') || message.includes('403') || message.toLowerCase().includes('unauthorized')) {
        console.error('Mapbox authentication error:', message);
        setServiceUnavailable({ type: 'auth' });
        return;
      }

      // Check for network errors
      if (message.toLowerCase().includes('network') || message.toLowerCase().includes('failed to fetch')) {
        setTileErrorCount((prev) => {
          const errorCount = prev + 1;
          if (errorCount > 5) {
            setServiceUnavailable({ type: 'network' });
          }
          return errorCount;
        });
        return;
      }

      // Handle regular tile errors
      setTileErrorCount((prev) => {
        const errorCount = prev + 1;

        if (errorCount <= 3) {
          // Show warning for first 3 errors
          setTileError(`Map tiles failed to load (attempt ${errorCount}/3). Retrying...`);
          console.warn('Tile load error:', event.error?.message || 'Unknown tile error');
        } else {
          // After 3 errors, show persistent error message
          setTileError('Map tiles failed to load. Check your internet connection.');
        }

        return errorCount;
      });
    };

    map.on('error', handleMapError);
    map.on('load', handleLoad);
    map.on('moveend', updateCameraSnapshot);

    return () => {
      map.off('error', handleMapError);
      map.off('load', handleLoad);
      map.off('moveend', updateCameraSnapshot);

      // NOTE: Rodalies line layer cleanup is now handled by RodaliesLineLayer component
      if (recenterControlRef.current) {
        map.removeControl(recenterControlRef.current);
        recenterControlRef.current = null;
      }
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
      setMapInstance(null);
      setStatusMessage(null);
      setGeometryWarning(null);
      setTileError(null);
      setTileErrorCount(0);
      if (globalWindow.__MAPBOX_INSTANCE__ === map) {
        delete globalWindow.__MAPBOX_INSTANCE__;
      }
    };
  // Note: tileErrorCount intentionally excluded - we don't want to recreate the map on tile errors
  }, [effectiveViewport, setMapInstance, setMapLoaded, setViewport, isHighContrast, updateCameraSnapshot]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    skipMoveSyncRef.current = true;
    map.setMaxBounds(effectiveViewport.max_bounds);
    map.setPadding(effectiveViewport.padding);
    map.jumpTo({
      center: [effectiveViewport.center.lng, effectiveViewport.center.lat],
      zoom: effectiveViewport.zoom,
    });
    map.resize();
    updateCameraSnapshot();
    map.once('moveend', () => {
      skipMoveSyncRef.current = false;
    });
    // Fallback timeout in case moveend doesn't fire - tracked to prevent memory leak
    const fallbackTimeout = setTimeout(() => {
      skipMoveSyncRef.current = false;
    }, 0);

    return () => {
      clearTimeout(fallbackTimeout);
    };
  }, [effectiveViewport, updateCameraSnapshot]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const handleViewportChange = () => {
      if (skipMoveSyncRef.current) {
        return;
      }
      const baseViewport =
        initialViewportRef.current ?? effectiveViewport;
      setViewport(getViewportFromMap(map, baseViewport));
      updateCameraSnapshot();
    };

    map.on('moveend', handleViewportChange);

    return () => {
      map.off('moveend', handleViewportChange);
    };
  }, [effectiveViewport, setViewport, updateCameraSnapshot]);

  // NOTE: Rodalies line layer styling and visibility are now handled by RodaliesLineLayer
  // component via GenericLineLayer, which receives highlightedLines, isolateMode, and visible props.

  const handleRetryTiles = () => {
    const map = mapRef.current;
    if (!map) return;

    // Reset tile error state
    setTileError(null);
    setTileErrorCount(0);

    // Force reload of map tiles by calling map.resize() and triggering a re-render
    map.resize();

    // Optionally reload style to force fresh tile requests
    const currentStyle = map.getStyle();
    if (currentStyle) {
      map.setStyle(currentStyle);
    }
  };

  useEffect(() => {
    if (!mapInstance || !isStationDebugMode) {
      return;
    }

    const handleDebugClick = (event: mapboxgl.MapMouseEvent) => {
      const { lng, lat } = event.lngLat;
      const point = mapInstance.project(event.lngLat);
      const message = `Station Debug
================
Lng: ${lng.toFixed(6)}
Lat: ${lat.toFixed(6)}
Pixel X: ${point.x.toFixed(2)}
Pixel Y: ${point.y.toFixed(2)}
Zoom: ${mapInstance.getZoom().toFixed(2)}`;

      console.info(message);

      if (navigator?.clipboard?.writeText) {
        navigator.clipboard.writeText(message).catch(() => {
          // Ignore clipboard failures
        });
      }
    };

    mapInstance.on('click', handleDebugClick);
    const targetZoom = Math.min(mapInstance.getMaxZoom(), 17);
    mapInstance.easeTo({ zoom: targetZoom });

    return () => {
      mapInstance.off('click', handleDebugClick);
    };
  }, [mapInstance, isStationDebugMode]);

  const toggleStationDebug = () => {
    setIsStationDebugMode((prev) => !prev);
  };

  const handleServiceRetry = useCallback(() => {
    setServiceUnavailable(null);
    setTileError(null);
    setTileErrorCount(0);
    // Reload the page to reinitialize Mapbox
    window.location.reload();
  }, []);

  // Show service unavailable page when Mapbox limits are exceeded
  if (serviceUnavailable) {
    return (
      <ServiceUnavailable
        errorType={serviceUnavailable.type}
        onRetry={handleServiceRetry}
      />
    );
  }

  return (
    <div className="map-canvas">
      {error ? (
        <div className="map-canvas__error" role="alert">
          {error}
        </div>
      ) : null}
      {hasStatus ? (
        <div
          className={`map-canvas__status${
            statusIsWarning ? ' map-canvas__status--warning' : ''
          }`}
          role="status"
          data-testid="map-status-banner"
        >
          {statusText}
          {tileError && tileErrorCount > 3 ? (
            <button
              onClick={handleRetryTiles}
              className="map-canvas__retry-button"
              data-testid="tile-retry-button"
              aria-label="Retry loading map tiles"
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      {SHOW_CAMERA_DEBUG && cameraSnapshot ? (
        <div className="map-canvas__camera-debug">
          <label className="map-canvas__camera-debug-label" htmlFor="camera-debug-input">
            Camera snapshot
          </label>
          <input
            id="camera-debug-input"
            className="map-canvas__camera-debug-input"
            type="text"
            readOnly
            value={cameraSnapshot}
            onClick={handleCopyCameraSnapshot}
            onFocus={(event) => event.currentTarget.select()}
          />
          <span className="map-canvas__camera-debug-hint">
            Click to copy current map center/zoom ({copyFeedback ?? 'click to copy'})
          </span>
        </div>
      ) : null}
      {debugToolsEnabled && raycastDebugInfo ? (
        <div className="map-canvas__raycast-debug">
          <div className="map-canvas__raycast-debug-title">Raycast debug</div>
          <div className="map-canvas__raycast-debug-row">
            <span>Status:</span>
            <strong>{raycastDebugInfo.hit ? 'hit' : 'miss'}</strong>
          </div>
          <div className="map-canvas__raycast-debug-row">
            <span>Meshes checked:</span>
            <span>{raycastDebugInfo.objectsHit}</span>
          </div>
          <div className="map-canvas__raycast-debug-row">
            <span>Vehicle:</span>
            <span>{raycastDebugInfo.vehicleKey ?? '—'}</span>
          </div>
          <div className="map-canvas__raycast-debug-row">
            <span>Route:</span>
            <span>{raycastDebugInfo.routeId ?? '—'}</span>
          </div>
          <div className="map-canvas__raycast-debug-row map-canvas__raycast-debug-timestamp">
            <span>Timestamp:</span>
            <span>{new Date(raycastDebugInfo.timestamp).toLocaleTimeString()}</span>
          </div>
        </div>
      ) : null}
      <div
        ref={containerRef}
        className="map-canvas__container"
        data-testid="map-canvas"
        aria-hidden={Boolean(error)}
      />
      {/* Loading overlay - covers app until essential assets are loaded */}
      <LoadingOverlay stages={loadingStages} />
      {/* Metro line geometries (below stations) */}
      {mapInstance && isMapLoaded ? (
        <MetroLineLayer
          map={mapInstance}
          visible={transportFilters.metro}
          highlightedLines={networkHighlights.metro.selectedLineIds}
          isolateMode={networkHighlights.metro.highlightMode === 'isolate'}
        />
      ) : null}
      {/* Metro station markers */}
      {mapInstance && isMapLoaded ? (
        <MetroStationLayer
          map={mapInstance}
          visible={transportFilters.metro && showStations}
          highlightedLines={networkHighlights.metro.selectedLineIds}
          isolateMode={networkHighlights.metro.highlightMode === 'isolate'}
          onStationClick={(stationId, stationName) => {
            console.log('Metro station clicked:', stationId, stationName);
          }}
        />
      ) : null}
      {/* Metro vehicle layer (3D simulated trains) */}
      {mapInstance && isMapLoaded ? (
        <TransitVehicleLayer3D
          map={mapInstance}
          networkType="metro"
          visible={transportFilters.metro}
          modelScale={modelSizes.metro}
          highlightedLineIds={networkHighlights.metro.selectedLineIds}
          isolateMode={networkHighlights.metro.highlightMode === 'isolate'}
          onMeshPositionGetterReady={handleMetroMeshPositionGetterReady}
          clickCoordinator={clickCoordinatorRef.current}
        />
      ) : null}
      {/* Bus route lines (below stops) */}
      {mapInstance && isMapLoaded ? (
        <BusLineLayer
          map={mapInstance}
          visible={transportFilters.bus}
          highlightedRoutes={networkHighlights.bus.selectedLineIds}
          isolateMode={networkHighlights.bus.highlightMode === 'isolate'}
          filterTopLinesOnly={showOnlyTopBusLines}
        />
      ) : null}
      {/* Bus stop markers */}
      {mapInstance && isMapLoaded ? (
        <BusStopLayer
          map={mapInstance}
          visible={transportFilters.bus && showStations}
          highlightedRoutes={networkHighlights.bus.selectedLineIds}
          isolateMode={networkHighlights.bus.highlightMode === 'isolate'}
          filterTopLinesOnly={showOnlyTopBusLines}
          onStopClick={(stopId, stopName) => {
            console.log('Bus stop clicked:', stopId, stopName);
          }}
        />
      ) : null}
      {/* Bus vehicle layer (3D simulated buses) */}
      {mapInstance && isMapLoaded ? (
        <TransitVehicleLayer3D
          map={mapInstance}
          networkType="bus"
          visible={transportFilters.bus}
          modelScale={modelSizes.bus}
          highlightedLineIds={networkHighlights.bus.selectedLineIds}
          isolateMode={networkHighlights.bus.highlightMode === 'isolate'}
          onMeshPositionGetterReady={handleBusMeshPositionGetterReady}
          clickCoordinator={clickCoordinatorRef.current}
        />
      ) : null}
      {/* TRAM line geometries */}
      {mapInstance && isMapLoaded ? (
        <TramLineLayer
          map={mapInstance}
          visible={transportFilters.tram}
          highlightedLines={networkHighlights.tram.selectedLineIds}
          isolateMode={networkHighlights.tram.highlightMode === 'isolate'}
        />
      ) : null}
      {/* TRAM stop markers */}
      {mapInstance && isMapLoaded ? (
        <TramStopLayer
          map={mapInstance}
          visible={transportFilters.tram && showStations}
          highlightedLines={networkHighlights.tram.selectedLineIds}
          isolateMode={networkHighlights.tram.highlightMode === 'isolate'}
          onStopClick={(stopId, stopName) => {
            console.log('TRAM stop clicked:', stopId, stopName);
          }}
        />
      ) : null}
      {/* TRAM vehicle layer (3D simulated trams) */}
      {mapInstance && isMapLoaded ? (
        <TransitVehicleLayer3D
          map={mapInstance}
          networkType="tram"
          visible={transportFilters.tram}
          modelScale={modelSizes.tram}
          highlightedLineIds={networkHighlights.tram.selectedLineIds}
          isolateMode={networkHighlights.tram.highlightMode === 'isolate'}
          onMeshPositionGetterReady={handleTramMeshPositionGetterReady}
          clickCoordinator={clickCoordinatorRef.current}
        />
      ) : null}
      {/* FGC line geometries */}
      {mapInstance && isMapLoaded ? (
        <FGCLineLayer
          map={mapInstance}
          visible={transportFilters.fgc}
          highlightedLines={networkHighlights.fgc.selectedLineIds}
          isolateMode={networkHighlights.fgc.highlightMode === 'isolate'}
        />
      ) : null}
      {/* FGC station markers */}
      {mapInstance && isMapLoaded ? (
        <FGCStationLayer
          map={mapInstance}
          visible={transportFilters.fgc && showStations}
          highlightedLines={networkHighlights.fgc.selectedLineIds}
          isolateMode={networkHighlights.fgc.highlightMode === 'isolate'}
          onStationClick={(stationId, stationName) => {
            console.log('FGC station clicked:', stationId, stationName);
          }}
        />
      ) : null}
      {/* FGC vehicle layer (3D simulated trains) */}
      {mapInstance && isMapLoaded ? (
        <TransitVehicleLayer3D
          map={mapInstance}
          networkType="fgc"
          visible={transportFilters.fgc}
          modelScale={modelSizes.fgc}
          highlightedLineIds={networkHighlights.fgc.selectedLineIds}
          isolateMode={networkHighlights.fgc.highlightMode === 'isolate'}
          onMeshPositionGetterReady={handleFgcMeshPositionGetterReady}
          clickCoordinator={clickCoordinatorRef.current}
        />
      ) : null}
      {/* Rodalies line geometries */}
      {mapInstance && isMapLoaded ? (
        <RodaliesLineLayer
          map={mapInstance}
          visible={transportFilters.rodalies}
          highlightedLines={networkHighlights.rodalies.selectedLineIds}
          isolateMode={networkHighlights.rodalies.highlightMode === 'isolate'}
        />
      ) : null}
      {/* Rodalies station markers layer */}
      {mapInstance && isMapLoaded ? (
        <StationLayer
          map={mapInstance}
          highlightedLineIds={networkHighlights.rodalies.selectedLineIds}
          highlightMode={networkHighlights.rodalies.highlightMode}
          visible={transportFilters.rodalies && showStations}
        />
      ) : null}
      {/* Phase B 2D markers replaced by Phase C 3D models */}
      {/* {mapInstance && isMapLoaded ? <TrainMarkers map={mapInstance} /> : null} */}
      {mapInstance && isMapLoaded ? (
        <TrainLayer3D
          map={mapInstance}
          onRaycastResult={debugToolsEnabled ? setRaycastDebugInfo : undefined}
          onLoadingStageChange={handleTrainLoadingStageChange}
          onTrainsChange={setTrainPositions}
          visible={transportFilters.rodalies}
          highlightedLineIds={networkHighlights.rodalies.selectedLineIds}
          isolateMode={networkHighlights.rodalies.highlightMode === 'isolate'}
          modelScale={modelSizes.rodalies}
          onMeshPositionGetterReady={handleRodaliesMeshPositionGetterReady}
          clickCoordinator={clickCoordinatorRef.current}
        />
      ) : null}
      {/* Unified Control Panel - replaces VehicleListButton and TransportFilterButton */}
      {mapInstance && isMapLoaded ? (
        <ControlPanel rodaliesTrains={trainPositions} map={mapInstance} getMeshPosition={getMeshPosition} />
      ) : null}
      {/* Data Freshness Indicator - bottom right */}
      {mapInstance && isMapLoaded ? (
        <div className="map-canvas__freshness-indicator">
          <DataFreshnessIndicator
            onClick={() => window.location.href = '/status'}
          />
        </div>
      ) : null}
      {/* Alert badge - top right, only on Rodalies tab */}
      {mapInstance && isMapLoaded && activeControlTab === 'rodalies' ? <AlertBadge /> : null}
      {process.env.NODE_ENV !== 'production' && debugToolsEnabled ? (
        <>
          <button
            type="button"
            onClick={toggleStationDebug}
            style={{
              position: 'fixed',
              bottom: '1rem',
              left: '1rem',
              zIndex: 50,
              padding: '0.5rem 0.75rem',
              borderRadius: '0.375rem',
              border: '1px solid rgba(255,255,255,0.3)',
              backgroundColor: isStationDebugMode ? '#fde047' : 'rgba(15,23,42,0.75)',
              color: isStationDebugMode ? '#1f2937' : '#f1f5f9',
              fontSize: '0.9rem',
              fontWeight: 600,
              backdropFilter: 'blur(6px)',
            }}
          >
            {isStationDebugMode ? 'Exit Station Debug' : 'Station Debug'}
          </button>
          {isStationDebugMode ? (
            <div
              style={{
                position: 'fixed',
                bottom: '4.5rem',
                left: '1rem',
                zIndex: 50,
                padding: '0.75rem 1rem',
                borderRadius: '0.5rem',
                backgroundColor: 'rgba(15,23,42,0.85)',
                color: '#f1f5f9',
                maxWidth: '18rem',
                fontSize: '0.8rem',
                lineHeight: 1.4,
                boxShadow: '0 10px 25px rgba(0,0,0,0.35)',
              }}
            >
              Station debug on: click anywhere (max zoom) to log coordinates. Output is copied to clipboard.
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
