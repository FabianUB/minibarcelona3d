import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import type { FeatureCollection } from 'geojson';

import 'mapbox-gl/dist/mapbox-gl.css';
import '../../styles/map.css';

import { useMapActions, useMapHighlightSelectors, useMapState } from '../../state/map';
import { loadLineGeometryCollection } from '../../lib/rodalies/dataLoader';
import { useDefaultViewport } from './useDefaultViewport';
import { RecenterControl } from './controls/RecenterControl';
import { getLinePaintProperties } from './layers/lineLayers';
import type { MapViewport } from '../../types/rodalies';
import { startMetric, endMetric } from '../../lib/analytics/perf';
// import { TrainMarkers } from '../trains/TrainMarkers'; // Phase B - replaced by TrainLayer3D
import { TrainLayer3D, type RaycastDebugInfo } from '../trains/TrainLayer3D';
import { TrainLoadingSkeleton } from '../trains/TrainLoadingSkeleton';
import { setModelOrigin } from '../../lib/map/coordinates';

// Using streets-v12 for 3D buildings and natural colors (parks, water)
// Similar to MiniTokyo3D's custom style but with built-in 3D building support
const MAPBOX_STYLE_URL = 'mapbox://styles/mapbox/streets-v12';
const MAPBOX_TOKEN =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_MAPBOX_TOKEN) ||
  '';

const RODALIES_LINE_SOURCE_ID = 'rodalies-lines';
const RODALIES_LINE_LAYER_ID = 'rodalies-lines-outline';
const SHOW_CAMERA_DEBUG = false;
const SHOW_RAYCAST_DEBUG = true;

type MapboxWindow = Window & { __MAPBOX_INSTANCE__?: mapboxgl.Map };

function getGlobalWindow(): MapboxWindow {
  return window as MapboxWindow;
}

function normaliseHexColor(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith('#')) {
    return trimmed.length === 4 || trimmed.length === 7
      ? trimmed
      : undefined;
  }
  const hexPattern = /^[0-9a-f]{6}$/i;
  if (hexPattern.test(trimmed)) {
    return `#${trimmed}`;
  }
  return undefined;
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
  const [isTrainDataLoading, setIsTrainDataLoading] = useState(true);

  const { setMapInstance, setMapLoaded, setViewport } = useMapActions();
  const { highlightMode, highlightedLineId, highlightedLineIds } = useMapHighlightSelectors();
  const { ui, mapInstance, isMapLoaded } = useMapState();
  const {
    effectiveViewport,
    error: viewportError,
    recenter,
  } = useDefaultViewport();

  const isHighContrast = ui.isHighContrast;

  if (!initialViewportRef.current) {
    initialViewportRef.current = effectiveViewport;
  }

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
      maxPitch: 60,
      attributionControl: true,
    });

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

    const attachLineGeometry = async () => {
      try {
        startMetric('geometry-load');
        const collection = await loadLineGeometryCollection();
        const normalisedCollection: FeatureCollection = {
          type: 'FeatureCollection',
          features: collection.features.map((feature) => {
            const properties = feature.properties ?? {};
            const normalisedColor = normaliseHexColor(properties.brand_color);
            return {
              ...feature,
              properties: {
                ...properties,
                ...(normalisedColor ? { brand_color: normalisedColor } : {}),
              },
            } as typeof feature;
          }),
        };
        const existingSource = map.getSource(
          RODALIES_LINE_SOURCE_ID,
        ) as mapboxgl.GeoJSONSource | undefined;

        if (existingSource) {
          existingSource.setData(normalisedCollection);
        } else {
          map.addSource(RODALIES_LINE_SOURCE_ID, {
            type: 'geojson',
            data: normalisedCollection,
          });
          // Add line layer with initial paint properties
          map.addLayer({
            id: RODALIES_LINE_LAYER_ID,
            type: 'line',
            source: RODALIES_LINE_SOURCE_ID,
            layout: {
              'line-join': 'round',
              'line-cap': 'round',
            },
            paint: getLinePaintProperties({
              highlightMode: 'none',
              highlightedLineId: null,
              highlightedLineIds: [],
              isHighContrast,
            }),
          });
        }
        endMetric('geometry-load', {
          featureCount: normalisedCollection.features.length,
        });
        setGeometryWarning(null);
      } catch (err) {
        endMetric('geometry-load', { error: true });
        setGeometryWarning(
          'Rodalies line geometry failed to load. Base map shown only.',
        );
        if (typeof console !== 'undefined') {
          console.error('Failed loading Rodalies line geometry', err);
        }
      } finally {
        setStatusMessage(null);
      }
    };

    const handleLoad = () => {
      endMetric('initial-render');
      setMapLoaded(true);

      // Initialize model origin for Three.js coordinate system (T052e)
      // MUST be called before any 3D objects are positioned
      setModelOrigin(map.getCenter());
      updateCameraSnapshot();

      // Add 3D buildings layer explicitly (similar to MiniTokyo3D)
      const layers = map.getStyle().layers;
      // Find the first symbol layer to insert buildings before labels
      const firstSymbolId = layers?.find((layer) => layer.type === 'symbol')?.id;

      // Hide POI and building labels for cleaner view
      const labelsToHide = [
        'poi-label',
        'transit-label',
        'airport-label',
        'settlement-subdivision-label',
      ];

      layers?.forEach((layer) => {
        if (labelsToHide.some((label) => layer.id.includes(label))) {
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

      setStatusMessage('Loading Rodalies network…');
      void attachLineGeometry();
      const baseViewport =
        initialViewportRef.current ?? effectiveViewport;
      setViewport(getViewportFromMap(map, baseViewport));
    };

    // Handle tile load errors
    const handleTileError = (event: { error?: Error; tile?: { tileID: { canonical: { x: number; y: number; z: number } } }; source?: { id: string } }) => {
      const errorCount = tileErrorCount + 1;
      setTileErrorCount(errorCount);

      if (errorCount <= 3) {
        // Show warning for first 3 errors
        setTileError(`Map tiles failed to load (attempt ${errorCount}/3). Retrying...`);
        console.warn('Tile load error:', event.error?.message || 'Unknown tile error');
      } else {
        // After 3 errors, show persistent error message
        setTileError('Map tiles failed to load. Check your internet connection.');
      }
    };

    map.on('error', handleTileError);
    map.on('load', handleLoad);
    map.on('moveend', updateCameraSnapshot);

    return () => {
      map.off('error', handleTileError);
      map.off('load', handleLoad);
      map.off('moveend', updateCameraSnapshot);
      if (map.getLayer(RODALIES_LINE_LAYER_ID)) {
        map.removeLayer(RODALIES_LINE_LAYER_ID);
      }
      if (map.getSource(RODALIES_LINE_SOURCE_ID)) {
        map.removeSource(RODALIES_LINE_SOURCE_ID);
      }
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
  }, [effectiveViewport, setMapInstance, setMapLoaded, setViewport, tileErrorCount, isHighContrast, updateCameraSnapshot]);

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
    setTimeout(() => {
      skipMoveSyncRef.current = false;
    }, 0);
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

  // Update line layer styling when highlight state or contrast mode changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer(RODALIES_LINE_LAYER_ID)) {
      return;
    }

    // Get dynamic paint properties based on current highlight state
    const paintProperties = getLinePaintProperties({
      highlightMode,
      highlightedLineId,
      highlightedLineIds,
      isHighContrast,
    });

    // Update each paint property
    Object.entries(paintProperties).forEach(([property, value]) => {
      map.setPaintProperty(RODALIES_LINE_LAYER_ID, property as any, value);
    });
  }, [highlightMode, highlightedLineId, highlightedLineIds, isHighContrast]);

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
      {SHOW_RAYCAST_DEBUG && raycastDebugInfo ? (
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
      {/* T099: Show skeleton UI while initial train data is loading */}
      {isTrainDataLoading && mapInstance && isMapLoaded ? <TrainLoadingSkeleton /> : null}
      {/* Phase B 2D markers replaced by Phase C 3D models */}
      {/* {mapInstance && isMapLoaded ? <TrainMarkers map={mapInstance} /> : null} */}
      {mapInstance && isMapLoaded ? (
        <TrainLayer3D
          map={mapInstance}
          onRaycastResult={SHOW_RAYCAST_DEBUG ? setRaycastDebugInfo : undefined}
          onLoadingChange={setIsTrainDataLoading}
        />
      ) : null}
    </div>
  );
}
