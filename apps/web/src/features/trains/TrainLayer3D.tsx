/**
 * TrainLayer3D Component
 *
 * Renders 3D train models on the Mapbox map using Three.js via Custom Layer API.
 * Replaces 2D markers from Phase B with realistic 3D train models.
 *
 * Features:
 * - WebGL rendering via Three.js integrated with Mapbox GL JS
 * - 3D train models loaded from GLB files
 * - Models oriented toward next station using bearing calculations
 * - Smooth position interpolation between updates
 * - Screen-space hit testing for accurate hover/click detection
 * - Optimized for 100+ concurrent trains at 60fps
 *
 * Implementation: Phase C (User Story 1 Enhanced)
 * Related tasks: T043, T044, T045
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { Train, TrainPosition, RawTrainPosition } from '../../types/trains';
import type { Station } from '../../types/rodalies';
import { fetchTrainPositions, fetchTrainByKey } from '../../lib/api/trains';
import { preloadAllTrainModels } from '../../lib/trains/modelLoader';
import { TrainMeshManager, type GeoBounds } from '../../lib/trains/trainMeshManager';
import { loadManifest, loadStations, loadLineGeometryCollection, loadRodaliesLines } from '../../lib/rodalies/dataLoader';
import { buildLineColorMap } from '../../lib/trains/outlineManager';
import { getModelOrigin } from '../../lib/map/coordinates';
import { preprocessRailwayLine, type PreprocessedRailwayLine } from '../../lib/trains/geometry';
import { extractLineFromRouteId } from '../../config/trainModels';
import { useTrainActions } from '../../state/trains';
import { useMapActions, useMapUI } from '../../state/map';
import { useTransitActions } from '../../state/transit';
import type { VehicleClickCoordinator } from '../../lib/map/VehicleClickCoordinator';
import { TrainErrorDisplay } from './TrainErrorDisplay';
import { TrainDebugPanel } from './TrainDebugPanel';
import { trainDebug } from '../../lib/trains/debugLogger';
import { useHitDetectionMode } from '../../hooks/useHitDetectionMode';
import { usePageVisibility } from '../../hooks/usePageVisibility';
import { raycastHitTest } from '../../lib/map/RaycastHitResolver';

export interface TrainLayer3DProps {
  /**
   * Mapbox GL Map instance to render 3D models on
   * Must be initialized and loaded before passing to this component
   */
  map: MapboxMap;

  /**
   * Layer ID to insert train layer before (z-index control)
   * If not provided, trains will render on top of all layers
   *
   * Example: 'line-pattern-layer' to render trains above lines
   */
  beforeId?: string;

  /**
   * Debug callback invoked whenever the screen-space picker resolves a selection
   * Useful for verifying hover/click detection during development
   */
  onRaycastResult?: (result: RaycastDebugInfo) => void;

  /**
   * Callback invoked when loading state changes
   * Task: T099 - Expose loading state for skeleton UI
   */
  onLoadingChange?: (isLoading: boolean) => void;

  /**
   * Callback invoked when loading stages change
   * Task: T013 - Expose detailed loading stages for loading overlay
   */
  onLoadingStageChange?: (stages: { models: boolean; trains: boolean }) => void;

  /**
   * Callback invoked when train data changes
   * Used to expose train list to parent component (MapCanvas)
   * to avoid re-render issues with StationLayer
   */
  onTrainsChange?: (trains: TrainPosition[]) => void;

  /**
   * Callback to expose the mesh position getter for external use.
   * The getter returns the actual rendered position [lng, lat] for a given vehicleKey,
   * which may differ from API GPS coordinates due to railway snapping and parking.
   */
  onMeshPositionGetterReady?: (getter: (vehicleKey: string) => [number, number] | null) => void;

  /**
   * Whether train layer is visible (controlled by transport filter)
   * When false, trains are hidden and API polling is paused for performance
   */
  visible?: boolean;

  /**
   * Highlighted line IDs for filtering trains
   * When lines are selected, only trains on those lines are fully visible
   */
  highlightedLineIds?: string[];

  /**
   * Whether isolate mode is active (hide non-highlighted vs dim them)
   * - false: dim non-highlighted trains to 25% opacity (highlight mode)
   * - true: hide non-highlighted trains completely (isolate mode)
   */
  isolateMode?: boolean;

  /**
   * User-controlled model scale multiplier (from control panel slider)
   * Range: 0.5 to 2.0, default 1.0
   */
  modelScale?: number;

  /** View mode scale boost (e.g. larger models in bird's eye view) */
  viewModeScale?: number;

  /**
   * Shared click coordinator for cross-layer hit resolution.
   * When provided, this layer registers its hit resolver with the coordinator
   * instead of attaching its own click handler to the canvas.
   */
  clickCoordinator?: VehicleClickCoordinator;
}

export interface RaycastDebugInfo {
  hit: boolean;
  vehicleKey?: string;
  routeId?: string;
  objectsHit: number;
  timestamp: number;
}

/**
 * Polling interval in milliseconds (30 seconds)
 * Matches acceptance criteria for US1
 */
const POLLING_INTERVAL_MS = 30000;

/**
 * Stale data threshold in milliseconds (60 seconds)
 * Task: T097 - Mark data as stale if polledAt is older than 60s
 */
const STALE_DATA_THRESHOLD_MS = 60000;

/**
 * Custom Layer ID for Mapbox layer management
 */
const LAYER_ID = 'train-layer-3d';
const DEBUG_TOGGLE_EVENT = 'debug-tools-toggle';

/**
 * Three.js camera parameters for Mapbox coordinate system
 * These constants transform geographic coordinates to 3D scene coordinates
 * Note: Currently using Mapbox's projection matrix directly, but kept for reference
 */
// const CAMERA_CONFIG = {
//   mercatorBounds: {
//     left: -20037508.34,
//     bottom: -20037508.34,
//     right: 20037508.34,
//     top: 20037508.34,
//   },
//   fov: 45,
// };

/**
 * TrainLayer3D Component
 *
 * Displays real-time train positions as 3D models on the map.
 * Automatically updates every 30 seconds by polling the backend API.
 *
 * Task: T043 - Component skeleton
 * Task: T044 - Mapbox Custom Layer interface implementation
 * Task: T045 - Load 3D train models using GLTFLoader
 * Task: T046 - Create model instances based on route mapping
 * Task: T047 - Apply bearing-based rotation
 */
export function TrainLayer3D({
  map,
  beforeId,
  onRaycastResult,
  onLoadingChange,
  onLoadingStageChange,
  onTrainsChange,
  onMeshPositionGetterReady,
  visible = true,
  highlightedLineIds = [],
  isolateMode = false,
  modelScale = 1.0,
  viewModeScale = 1.0,
  clickCoordinator,
}: TrainLayer3DProps) {
  const { selectTrain } = useTrainActions();
  const { setActivePanel } = useMapActions();
  const { setDataSource } = useTransitActions();
  const { enableTrainParking } = useMapUI();
  const [hitDetectionMode] = useHitDetectionMode();
  const pageVisible = usePageVisibility();

  // Ref for render loop access (avoids stale closure in Mapbox custom layer)
  const pageVisibleRef = useRef(pageVisible);
  pageVisibleRef.current = pageVisible;

  const [trains, setTrains] = useState<TrainPosition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [stationsLoaded, setStationsLoaded] = useState(false);
  const [railwaysLoaded, setRailwaysLoaded] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [meshManagerReady, setMeshManagerReady] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [isDataStale, setIsDataStale] = useState(false);
  const [lastPollTime, setLastPollTime] = useState<number>(Date.now());
  const [isPollingPaused, setIsPollingPaused] = useState(false);
  const [areDebugToolsEnabled, setAreDebugToolsEnabled] = useState(
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')
  );

  // Phase 5: Line color map for hover outlines
  const lineColorMapRef = useRef<Map<string, THREE.Color> | null>(null);

  // Keep ref to current visibility for use in closures
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  // References for Three.js scene components
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  // Snapshot of the projection matrix inverse captured every render frame.
  // The camera's own projectionMatrix gets reset to identity between frames,
  // so we store our computed inverse separately for use by the raycaster.
  const projMatrixInverseRef = useRef(new THREE.Matrix4());
  const pmremGeneratorRef = useRef<THREE.PMREMGenerator | null>(null);
  const environmentRTRef = useRef<THREE.WebGLRenderTarget | null>(null);

  // Reference for stations data (T047)
  const stationsRef = useRef<Station[]>([]);
  const railwaysRef = useRef<Map<string, PreprocessedRailwayLine>>(new Map());

  // Fast station lookup for STOPPED_AT coordinate fallbacks
  const stationMapRef = useRef<Map<string, Station>>(new Map());

  // Reference for train mesh manager (T046, T047)
  const meshManagerRef = useRef<TrainMeshManager | null>(null);
  // Ref to hold current enableTrainParking value for use in render callback
  const enableTrainParkingRef = useRef(enableTrainParking);
  // Ref to track previous enableTrainParking value for detecting toggle-off
  const prevEnableTrainParkingRef = useRef(enableTrainParking);
  const previousPositionsRef = useRef<Map<string, TrainPosition>>(new Map());
  const lastPositionsRef = useRef<Map<string, TrainPosition>>(new Map());
  const loggedDistinctPreviousRef = useRef(false);
  const pollTimestampsRef = useRef<{ current?: number; previous?: number; receivedAt?: number }>({});

  // Reference for Three.js Raycaster for click detection (T049)

  // Store polling interval reference for cleanup
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  // Store retry timeout reference for cleanup (T097)
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isPollingPausedRef = useRef(false);
  // Ref to track retry count for use in fetchTrains closure (avoids stale closure)
  const retryCountRef = useRef(0);
  // Keep retry count ref in sync with state for stable closure access
  retryCountRef.current = retryCount;
  // Keep enableTrainParking ref in sync for use in render callback
  enableTrainParkingRef.current = enableTrainParking;

  // Track if layer has been added to map
  const layerAddedRef = useRef(false);
  // Store styledata listener for cleanup
  const ensureOnTopRef = useRef<(() => void) | null>(null);

  // Track if component is mounted to prevent state updates after unmount
  const isMountedRef = useRef(true);

  // Performance monitoring (T054)
  const performanceRef = useRef({
    frameCount: 0,
    lastFrameTime: performance.now(),
    frameTimes: new Array<number>(60).fill(16.67), // Pre-allocated circular buffer
    frameTimeIndex: 0, // Current position in circular buffer
    fps: 60,
    avgFrameTime: 16.67,
    lastLogTime: performance.now(),
    renderCount: 0,
  });

  // Reusable matrix instances for render loop (avoid allocations per frame)
  const matrixRef = useRef({
    mapboxMatrix: new THREE.Matrix4(),
    modelTransform: new THREE.Matrix4(),
    resultMatrix: new THREE.Matrix4(),
    scaleVector: new THREE.Vector3(1, -1, 1),
  });

  /**
   * Helper function to get train opacity based on line selection
   * Task: T089 - Filter trains by selected line IDs
   *
   * Rules:
   * - No selection: All trains at 100% opacity
   * - Highlight mode: Selected lines at 100%, others at 25%
   * - Isolate mode: Selected lines at 100%, others at 0% (invisible)
   */
  const getTrainOpacity = useCallback((train: TrainPosition): number => {
    // If no lines are highlighted, show all trains at full opacity
    if (highlightedLineIds.length === 0) {
      return 1.0;
    }

    // Extract line code from route ID using existing utility function
    const lineCode = extractLineFromRouteId(train.routeId);
    if (!lineCode) {
      // If we can't extract a line code, show at full opacity
      return 1.0;
    }

    // Check if this train's line is highlighted
    const isHighlighted = highlightedLineIds.includes(lineCode);

    if (isHighlighted) {
      return 1.0; // Full opacity for selected lines
    } else if (isolateMode) {
      return 0.0; // Invisible for non-selected lines in isolate mode
    } else {
      return 0.25; // 25% opacity for non-selected lines in highlight mode
    }
  }, [highlightedLineIds, isolateMode]);

  /**
   * Memoized train opacities map
   * Only recalculates when trains or highlight state changes
   * Performance: Avoids recalculating opacities on every render
   */
  const trainOpacities = useMemo(() => {
    if (highlightedLineIds.length === 0) {
      return null; // No opacity map needed when no highlighting
    }
    const opacities = new Map<string, number>();
    trains.forEach(train => {
      opacities.set(train.vehicleKey, getTrainOpacity(train));
    });
    return opacities;
  }, [trains, highlightedLineIds, getTrainOpacity]);

  /**
   * Fetches latest train positions from the API
   * Updates state and handles errors with exponential backoff retry
   * Task: T096 - Error handling with retry mechanism
   */
  const resolveTrainPosition = useCallback((train: TrainPosition): TrainPosition => {
    const rawTrain = train as RawTrainPosition;
    const stopIds = {
      current: train.currentStopId ?? rawTrain.current_stop_id ?? null,
      next: train.nextStopId ?? rawTrain.next_stop_id ?? null,
      previous: train.previousStopId ?? rawTrain.previous_stop_id ?? null,
    };
    const hasCoords = train.latitude !== null && train.longitude !== null;
    const stationIdForStop =
      stopIds.current ?? stopIds.next ?? stopIds.previous ?? null;
    const isStoppedAtStation = train.status === 'STOPPED_AT' && !!stationIdForStop;

    if (!hasCoords && isStoppedAtStation) {
      const station = stationMapRef.current.get(stationIdForStop!);
      if (station) {
        const [lng, lat] = station.geometry.coordinates;
        return {
          ...train,
          currentStopId: stopIds.current,
          nextStopId: stopIds.next,
          previousStopId: stopIds.previous,
          latitude: lat,
          longitude: lng,
        };
      }
    }

    // Normalize stop IDs even when coordinates are present
    if (
      stopIds.current !== train.currentStopId ||
      stopIds.next !== train.nextStopId ||
      stopIds.previous !== train.previousStopId
    ) {
      return {
        ...train,
        currentStopId: stopIds.current,
        nextStopId: stopIds.next,
        previousStopId: stopIds.previous,
      };
    }

    return train;
  }, []);

  const fetchTrains = useCallback(async () => {
    try {
      if (isMountedRef.current) setIsLoading(true);
      const response = await fetchTrainPositions();
      // Bail out early if component unmounted during fetch
      if (!isMountedRef.current) return;
      const previousPolledAtMs = pollTimestampsRef.current.current;
      const parsedPolledAt = Date.parse(response.polledAt);
      pollTimestampsRef.current.current = Number.isFinite(parsedPolledAt) ? parsedPolledAt : undefined;

      let resolvedPreviousPolledAt: number | undefined;
      if (response.previousPolledAt) {
        const parsedPrevious = Date.parse(response.previousPolledAt);
        if (Number.isFinite(parsedPrevious)) {
          resolvedPreviousPolledAt = parsedPrevious;
        }
      }

      let filledFromStation = 0;
      const resolvedPositions = response.positions.map((train) => {
        const resolved = resolveTrainPosition(train);
        if (
          resolved !== train &&
          (train.latitude === null || train.longitude === null) &&
          resolved.latitude !== null &&
          resolved.longitude !== null
        ) {
          filledFromStation += 1;
        }
        return resolved;
      });

      const resolvedPreviousPositions = response.previousPositions?.map(resolveTrainPosition);

      const snapshotPreviousPositions = new Map<string, TrainPosition>();
      if (response.previousPositions) {
        resolvedPreviousPositions?.forEach((position) => {
          if (position.latitude !== null && position.longitude !== null) {
            snapshotPreviousPositions.set(position.vehicleKey, position);
          }
        });
      }

      if (snapshotPreviousPositions.size === 0 && lastPositionsRef.current.size > 0) {
        lastPositionsRef.current.forEach((position, key) => {
          snapshotPreviousPositions.set(key, position);
        });
        if (!resolvedPreviousPolledAt && previousPolledAtMs !== undefined) {
          resolvedPreviousPolledAt = previousPolledAtMs;
        }
      }

      if (!loggedDistinctPreviousRef.current && snapshotPreviousPositions.size > 0) {
        // O(1) lookup instead of O(n) .find() per previous position
        const currentByKey = new Map(resolvedPositions.map(p => [p.vehicleKey, p]));
        const previousStats = Array.from(snapshotPreviousPositions.values()).reduce(
          (acc, previous) => {
            const current = currentByKey.get(previous.vehicleKey);
            if (
              current &&
              current.latitude !== null &&
              current.longitude !== null &&
              previous.latitude !== null &&
              previous.longitude !== null
            ) {
              const unchanged =
                current.latitude === previous.latitude && current.longitude === previous.longitude;
              return {
                total: acc.total + 1,
                unchanged: acc.unchanged + (unchanged ? 1 : 0),
              };
            }
            return acc;
          },
          { total: 0, unchanged: 0 }
        );

        if (previousStats.total > 0) {
          const changedCount = previousStats.total - previousStats.unchanged;
          console.log('TrainLayer3D: previous snapshot comparison', {
            totalCompared: previousStats.total,
            unchangedCount: previousStats.unchanged,
            changedCount,
          });
          if (changedCount > 0) {
            loggedDistinctPreviousRef.current = true;
          }
        }
      }

      pollTimestampsRef.current.previous = resolvedPreviousPolledAt;
      pollTimestampsRef.current.receivedAt = Date.now();

      previousPositionsRef.current = snapshotPreviousPositions;

      // Single-pass: filter valid trains and collect stats simultaneously
      const validTrains: TrainPosition[] = [];
      const nullCoordTrains: TrainPosition[] = [];
      let nullRouteCount = 0;
      let stoppedAtCount = 0, inTransitCount = 0, incomingAtCount = 0;
      const stoppedAtNullRoute: TrainPosition[] = [];

      for (const train of resolvedPositions) {
        if (train.latitude === null || train.longitude === null) {
          nullCoordTrains.push(train);
          continue;
        }
        validTrains.push(train);
        if (train.routeId === null) nullRouteCount++;
        if (train.status === 'STOPPED_AT') {
          stoppedAtCount++;
          if (train.routeId === null) stoppedAtNullRoute.push(train);
        } else if (train.status === 'IN_TRANSIT_TO') {
          inTransitCount++;
        } else if (train.status === 'INCOMING_AT') {
          incomingAtCount++;
        }
      }

      const previousKeys = new Set(lastPositionsRef.current.keys());
      const currentKeys = new Set(validTrains.map(t => t.vehicleKey));
      const disappearedTrains = [...previousKeys].filter(key => !currentKeys.has(key));
      const newTrainKeys = [...currentKeys].filter(key => !previousKeys.has(key));

      // Use structured poll summary
      trainDebug.startPollSummary();
      trainDebug.updatePollSummary({
        totalTrains: resolvedPositions.length,
        validTrains: validTrains.length,
        filteredOut: nullCoordTrains.length,
        nullRouteId: nullRouteCount,
        stoppedAt: stoppedAtCount,
        inTransit: inTransitCount,
        incomingAt: incomingAtCount,
        filledFromStation,
        newTrains: newTrainKeys,
        removedTrains: disappearedTrains,
      });

      // Add issues for problematic trains
      for (const train of nullCoordTrains) {
        trainDebug.addPollIssue(train.vehicleKey, 'null coordinates', {
          status: train.status,
          routeId: train.routeId,
          nextStopId: train.nextStopId,
        });
      }

      for (const train of stoppedAtNullRoute) {
        trainDebug.addPollIssue(train.vehicleKey, 'STOPPED_AT with null routeId', {
          coords: `${train.latitude?.toFixed(4)}, ${train.longitude?.toFixed(4)}`,
          nextStopId: train.nextStopId,
        });
      }

      trainDebug.endPollSummary();

      const currentPositionsMap = new Map<string, TrainPosition>();
      validTrains.forEach((train) => {
        currentPositionsMap.set(train.vehicleKey, train);
      });
      lastPositionsRef.current = currentPositionsMap;

      if (isMountedRef.current) {
        setTrains(validTrains);
        setError(null);
        setRetryCount(0);
        setLastPollTime(Date.now()); // Update poll time for countdown display
      }
    } catch (err) {
      // Bail out if component unmounted
      if (!isMountedRef.current) return;

      const errorMessage =
        err instanceof Error ? err.message : 'Failed to fetch train positions';
      setError(errorMessage);
      console.error('Error fetching train positions:', err);

      // T097: Implement exponential backoff retry
      // Retry with increasing delays: 2s, 4s, 8s, 16s, 32s (max)
      // Use ref to avoid stale closure - retryCountRef is kept in sync with state
      const currentRetryCount = retryCountRef.current;
      const nextRetryCount = currentRetryCount + 1;
      const maxRetries = 5;

      if (nextRetryCount <= maxRetries) {
        if (isPollingPausedRef.current || !isMountedRef.current) {
          // Do not schedule retries while polling is paused or component is unmounted
          if (isMountedRef.current) setRetryCount(0);
          return;
        }
        const retryDelayMs = Math.min(2000 * Math.pow(2, currentRetryCount), 32000);
        console.log(`TrainLayer3D: Retrying in ${retryDelayMs / 1000}s (attempt ${nextRetryCount}/${maxRetries})`);

        if (isMountedRef.current) setRetryCount(nextRetryCount);

        // Clear any existing retry timeout
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current);
        }

        // Schedule retry
        retryTimeoutRef.current = setTimeout(() => {
          void fetchTrains();
        }, retryDelayMs);
      } else {
        console.error(`TrainLayer3D: Max retries (${maxRetries}) reached, giving up`);
      }
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  }, [resolveTrainPosition]);

  /**
   * Manual retry function for user-initiated retry
   * Task: T096 - Allow users to manually retry failed requests
   */
  const handleManualRetry = useCallback(() => {
    setRetryCount(0);
    setError(null);
    void fetchTrains();
  }, [fetchTrains]);

  const handleManualPoll = useCallback(() => {
    void fetchTrains();
  }, [fetchTrains]);

  const handleTogglePolling = useCallback(() => {
    setIsPollingPaused((prev) => !prev);
  }, []);

  const handleSecretDebugToggle = useCallback(
    (next?: boolean) => {
      setAreDebugToolsEnabled((prev) => (typeof next === 'boolean' ? next : !prev));
    },
    []
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const emit = (enabled: boolean) => {
      window.dispatchEvent(new CustomEvent(DEBUG_TOGGLE_EVENT, { detail: { enabled } }));
    };

    emit(areDebugToolsEnabled);

    return () => {
      // No-op cleanup
    };
  }, [areDebugToolsEnabled]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ enabled: boolean }>).detail;
      if (detail && typeof detail.enabled === 'boolean') {
        setAreDebugToolsEnabled(detail.enabled);
      }
    };

    window.addEventListener(DEBUG_TOGGLE_EVENT, handler as EventListener);
    return () => window.removeEventListener(DEBUG_TOGGLE_EVENT, handler as EventListener);
  }, []);

  /**
   * Converts geographic coordinates (lng, lat) to Mercator meters
   * Mapbox uses Mercator projection for coordinate system
   * Note: Not currently used as TrainMeshManager handles coordinate transformation
   */
  // const lngLatToMeters = (lng: number, lat: number): [number, number] => {
  //   const x = (lng * 20037508.34) / 180;
  //   let y = Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180);
  //   y = (y * 20037508.34) / 180;
  //   return [x, y];
  // };

  const resolveScreenHit = useCallback(
    (point: { x: number; y: number }, paddingPx: number) => {
      const meshManager = meshManagerRef.current;
      if (!meshManager) {
        return null;
      }

      const candidates = meshManager.getScreenCandidates(map);
      let nearest: {
        vehicleKey: string;
        routeId: string | null;
        distance: number;
      } | null = null;

      for (const candidate of candidates) {
        const { screenPoint, orientedRect } = candidate;

        // Transform click point to rectangle's local coordinate system
        const dx = point.x - screenPoint.x;
        const dy = point.y - screenPoint.y;

        // Add padding to rectangle dimensions
        const halfWidth = orientedRect.halfWidthPx + paddingPx;
        const halfLength = orientedRect.halfLengthPx + paddingPx;

        // Rotate point to align with rectangle axes (inverse rotation)
        const cos = Math.cos(-orientedRect.rotation);
        const sin = Math.sin(-orientedRect.rotation);
        const localX = dx * cos - dy * sin;
        const localY = dx * sin + dy * cos;

        // Check if point is inside the padded oriented rectangle
        const isInside = Math.abs(localX) <= halfLength && Math.abs(localY) <= halfWidth;

        if (isInside) {
          // Calculate "distance" as normalized distance from center (0 = center, 1 = edge)
          // This allows selecting the train closest to cursor when overlapping
          const normalizedDistance = Math.sqrt(
            (localX / halfLength) ** 2 + (localY / halfWidth) ** 2
          );

          if (!nearest || normalizedDistance < nearest.distance) {
            nearest = {
              vehicleKey: candidate.vehicleKey,
              routeId: candidate.routeId,
              distance: normalizedDistance,
            };
          }
        }
      }

      return nearest;
    },
    [map]
  );

  const resolveRaycastHit = useCallback(
    (point: { x: number; y: number }) => {
      const scene = sceneRef.current;
      if (!scene) return null;

      const canvas = map.getCanvas();
      return raycastHitTest(
        projMatrixInverseRef.current,
        scene.children,
        canvas.clientWidth,
        canvas.clientHeight,
        point.x,
        point.y,
      );
    },
    [map],
  );

  const hoveredVehicleRef = useRef<string | null>(null);
  const lastMouseMoveTime = useRef<number>(0);
  const MOUSE_MOVE_THROTTLE_MS = 100; // Throttle to max 10 FPS

  useEffect(() => {
    const meshManager = meshManagerRef.current;
    if (!meshManager) {
      return;
    }
    const hoveredKey = hoveredVehicleRef.current;
    if (!hoveredKey) {
      return;
    }
    const stillPresent = trains.some((train) => train.vehicleKey === hoveredKey);
    if (!stillPresent) {
      hoveredVehicleRef.current = null;
      meshManager.setHighlightedTrain(undefined);
    }
  }, [trains]);

  // Debug overlay canvas (can be toggled with URL parameter ?debug=true)
  const debugCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const debugEnabledRef = useRef(areDebugToolsEnabled);
  const debugRafIdRef = useRef<number | null>(null);

  // Cleanup on unmount - set isMountedRef to false to prevent state updates
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    isPollingPausedRef.current = isPollingPaused;
  }, [isPollingPaused]);

  useEffect(() => {
    debugEnabledRef.current = areDebugToolsEnabled;
  }, [areDebugToolsEnabled]);

  // Detect when train parking is toggled and animate accordingly
  useEffect(() => {
    const wasEnabled = prevEnableTrainParkingRef.current;
    const isEnabled = enableTrainParking;

    if (wasEnabled && !isEnabled && meshManagerRef.current) {
      // Parking was just disabled - animate parked trains back to normal
      meshManagerRef.current.resetParkingVisuals();
    } else if (!wasEnabled && isEnabled && meshManagerRef.current) {
      // Parking was just enabled - apply parking to trains already at stations
      meshManagerRef.current.applyParkingToStoppedTrains();
    }

    prevEnableTrainParkingRef.current = isEnabled;
  }, [enableTrainParking]);

  useEffect(() => {
    if (!debugEnabledRef.current) {
      // Cleanup any existing overlay and RAF when disabling
      if (debugRafIdRef.current !== null) {
        cancelAnimationFrame(debugRafIdRef.current);
        debugRafIdRef.current = null;
      }
      if (debugCanvasRef.current && debugCanvasRef.current.parentNode) {
        debugCanvasRef.current.parentNode.removeChild(debugCanvasRef.current);
      }
      debugCanvasRef.current = null;
      return;
    }

    const canvas = document.createElement('canvas');
    const mapCanvas = map.getCanvas();
    const dpr = window.devicePixelRatio || 1;

    // Set canvas to match map size in CSS pixels, with DPR-scaled resolution
    const cssWidth = mapCanvas.clientWidth;
    const cssHeight = mapCanvas.clientHeight;
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '1000';
    map.getCanvasContainer().appendChild(canvas);
    debugCanvasRef.current = canvas;

    // Trigger initial draw after a microtask to ensure canvas is fully attached
    // The draw function will then continue via requestAnimationFrame
    queueMicrotask(() => {
      if (debugCanvasRef.current && meshManagerRef.current) {
        // Start debug overlay drawing loop
        const startDrawing = () => {
          if (!debugEnabledRef.current || !debugCanvasRef.current) return;
          const ctx = debugCanvasRef.current.getContext('2d');
          if (!ctx || !meshManagerRef.current) return;

          const mapCanvas = map.getCanvas();
          const dpr = window.devicePixelRatio || 1;
          const cssW = mapCanvas.clientWidth;
          const cssH = mapCanvas.clientHeight;

          if (debugCanvasRef.current.width !== cssW * dpr) {
            debugCanvasRef.current.width = cssW * dpr;
            debugCanvasRef.current.height = cssH * dpr;
            debugCanvasRef.current.style.width = `${cssW}px`;
            debugCanvasRef.current.style.height = `${cssH}px`;
          }

          ctx.clearRect(0, 0, debugCanvasRef.current.width, debugCanvasRef.current.height);
          ctx.save();
          ctx.scale(dpr, dpr);

          const candidates = meshManagerRef.current!.getScreenCandidates(map);

          candidates.forEach((candidate) => {
            const { screenPoint, orientedRect } = candidate;
            ctx.save();
            ctx.translate(screenPoint.x, screenPoint.y);
            ctx.rotate(orientedRect.rotation);
            ctx.beginPath();
            ctx.rect(
              -orientedRect.halfLengthPx,
              -orientedRect.halfWidthPx,
              orientedRect.halfLengthPx * 2,
              orientedRect.halfWidthPx * 2
            );
            ctx.strokeStyle = '#ff0000';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = 'rgba(255, 0, 0, 0.15)';
            ctx.fill();
            ctx.restore();

            // Center dot
            ctx.beginPath();
            ctx.arc(screenPoint.x, screenPoint.y, 4, 0, 2 * Math.PI);
            ctx.fillStyle = '#ffff00';
            ctx.fill();
          });

          ctx.restore();
          if (debugEnabledRef.current) {
            debugRafIdRef.current = requestAnimationFrame(startDrawing);
          }
        };
        startDrawing();
      }
    });

    return () => {
      // Cancel pending RAF to prevent memory leak
      if (debugRafIdRef.current !== null) {
        cancelAnimationFrame(debugRafIdRef.current);
        debugRafIdRef.current = null;
      }
      if (debugCanvasRef.current && debugCanvasRef.current.parentNode) {
        debugCanvasRef.current.parentNode.removeChild(debugCanvasRef.current);
      }
      debugCanvasRef.current = null;
    };
  }, [map, areDebugToolsEnabled]);

  const drawDebugOverlay = useCallback(() => {
    // Early exit if debug disabled or canvas removed
    if (!debugEnabledRef.current || !debugCanvasRef.current) {
      debugRafIdRef.current = null;
      return;
    }

    const canvas = debugCanvasRef.current;
    if (!meshManagerRef.current) {
      debugRafIdRef.current = null;
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      debugRafIdRef.current = null;
      return;
    }

    const mapCanvas = map.getCanvas();
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = mapCanvas.clientWidth;
    const cssHeight = mapCanvas.clientHeight;

    // Update canvas size if it changed (e.g., window resize)
    if (canvas.width !== cssWidth * dpr || canvas.height !== cssHeight * dpr) {
      canvas.width = cssWidth * dpr;
      canvas.height = cssHeight * dpr;
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Scale context by DPR so coordinates in CSS pixels work correctly
    ctx.save();
    ctx.scale(dpr, dpr);

    const candidates = meshManagerRef.current.getScreenCandidates(map);

    candidates.forEach((candidate) => {
      const isHovered = hoveredVehicleRef.current === candidate.vehicleKey;
      const { screenPoint, orientedRect } = candidate;

      // Draw oriented rectangle
      ctx.save();
      ctx.translate(screenPoint.x, screenPoint.y);
      ctx.rotate(orientedRect.rotation);

      ctx.beginPath();
      ctx.rect(
        -orientedRect.halfLengthPx,
        -orientedRect.halfWidthPx,
        orientedRect.halfLengthPx * 2,
        orientedRect.halfWidthPx * 2
      );
      ctx.strokeStyle = isHovered ? '#00ff00' : '#ff0000';
      ctx.lineWidth = isHovered ? 3 : 2;
      ctx.stroke();

      // Fill with semi-transparent color to make it more visible
      ctx.fillStyle = isHovered ? 'rgba(0, 255, 0, 0.2)' : 'rgba(255, 0, 0, 0.15)';
      ctx.fill();

      ctx.restore();

      // Draw center point
      ctx.beginPath();
      ctx.arc(screenPoint.x, screenPoint.y, 4, 0, 2 * Math.PI);
      ctx.fillStyle = isHovered ? '#00ff00' : '#ffff00';
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.stroke();

      if (isHovered) {
        ctx.fillStyle = 'white';
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 3;
        ctx.font = 'bold 14px monospace';
        const text = `${candidate.vehicleKey} (${candidate.routeId}) [${orientedRect.halfLengthPx.toFixed(0)}x${orientedRect.halfWidthPx.toFixed(0)}px]`;
        ctx.strokeText(text, screenPoint.x + 10, screenPoint.y - 10);
        ctx.fillText(text, screenPoint.x + 10, screenPoint.y - 10);
      }
    });

    ctx.restore(); // Restore from DPR scale

    // Store RAF ID for cleanup
    debugRafIdRef.current = requestAnimationFrame(drawDebugOverlay);
  }, [map]);

  // Start debug overlay drawing when debug is enabled AND canvas exists
  // Must depend on areDebugToolsEnabled to trigger when user toggles debug
  useEffect(() => {
    if (areDebugToolsEnabled && debugCanvasRef.current) {
      drawDebugOverlay();
    }
  }, [areDebugToolsEnabled, drawDebugOverlay]);

/**
 * Screen-space helpers for hover/click
 *
 * Projects train coordinates into screen space and does simple
 * distance checks to determine hover/click candidates.
 */
  const handlePointerMove = useCallback(
    (event: MouseEvent) => {
      // Throttle mousemove to reduce performance impact
      const now = Date.now();
      if (now - lastMouseMoveTime.current < MOUSE_MOVE_THROTTLE_MS) {
        return;
      }
      lastMouseMoveTime.current = now;

      const canvas = map.getCanvas();
      const rect = canvas.getBoundingClientRect();
      const point = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };

      let vehicleKey: string | null = null;
      if (hitDetectionMode === 'raycast') {
        const hit = resolveRaycastHit(point);
        vehicleKey = hit?.vehicleKey ?? null;
      } else {
        const hit = resolveScreenHit(point, 6);
        vehicleKey = hit?.vehicleKey ?? null;
      }

      if (hoveredVehicleRef.current !== vehicleKey) {
        // Hide outline from previous hovered train
        if (hoveredVehicleRef.current && lineColorMapRef.current) {
          meshManagerRef.current?.hideOutline(hoveredVehicleRef.current);
        }

        hoveredVehicleRef.current = vehicleKey;
        meshManagerRef.current?.setHighlightedTrain(vehicleKey ?? undefined);

        // Show outline for newly hovered train
        if (vehicleKey && lineColorMapRef.current) {
          meshManagerRef.current?.showOutline(vehicleKey, lineColorMapRef.current);
        }
      }
    },
    [map, resolveScreenHit, resolveRaycastHit, hitDetectionMode]
  );

  const handlePointerLeave = useCallback(() => {
    // Hide outline when leaving canvas
    if (hoveredVehicleRef.current && lineColorMapRef.current) {
      meshManagerRef.current?.hideOutline(hoveredVehicleRef.current);
    }

    hoveredVehicleRef.current = null;
    meshManagerRef.current?.setHighlightedTrain(undefined);
  }, []);

  // Click handling is now done via VehicleClickCoordinator (see registration effect below)

  /**
   * Mapbox Custom Layer Interface Implementation
   * Task: T044
   *
   * This object implements the CustomLayerInterface required by Mapbox GL JS
   * Reference: https://docs.mapbox.com/mapbox-gl-js/api/properties/#customlayerinterface
   */
  const customLayer = useMemo<mapboxgl.CustomLayerInterface>(() => ({
    id: LAYER_ID,
    type: 'custom',
    renderingMode: '3d',

    /**
     * Called once when layer is added to the map
     * Initialize Three.js scene, camera, and renderer here
     * Task: T045 - Preload train models
     * Task: T046 - Initialize mesh manager
     */
    onAdd(map: mapboxgl.Map, gl: WebGLRenderingContext) {
      // Debug: Log WebGL capabilities for diagnosing z-fighting across different GPUs
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      console.log('🔍🚂 [TrainLayer3D] WebGL Debug Info:', {
        renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'unknown',
        vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : 'unknown',
        depthBits: gl.getParameter(gl.DEPTH_BITS),
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        version: gl.getParameter(gl.VERSION),
      });

      // Create Three.js scene
      const scene = new THREE.Scene();
      sceneRef.current = scene;

      // Create camera synchronized with Mapbox camera
      const camera = new THREE.Camera();
      cameraRef.current = camera;

      // Create WebGL renderer using Mapbox's GL context
      // This shares the GPU context with Mapbox for better performance
      const renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
        antialias: true,
      });

      // Configure renderer settings
      // T103: Optimize Three.js rendering for performance
      renderer.autoClear = false; // Don't clear Mapbox's render
      renderer.shadowMap.enabled = false; // Shadows disabled for performance
      renderer.sortObjects = false; // Skip object sorting for better performance
      if ('outputColorSpace' in renderer) {
        renderer.outputColorSpace = THREE.SRGBColorSpace;
      } else {
        // @ts-expect-error outputEncoding exists on older builds
        renderer.outputEncoding = THREE.sRGBEncoding;
      }
      renderer.toneMapping = THREE.LinearToneMapping;
      renderer.toneMappingExposure = 1.0;
      rendererRef.current = renderer;

      // Apply neutral environment lighting similar to GLTF viewer
      const pmremGenerator = new THREE.PMREMGenerator(renderer);
      pmremGenerator.compileEquirectangularShader();
      pmremGeneratorRef.current = pmremGenerator;

      const neutralEnvironment = new RoomEnvironment();
      const envRenderTarget = pmremGenerator.fromScene(neutralEnvironment, 0.04);
      neutralEnvironment.dispose();
      environmentRTRef.current = envRenderTarget;
      scene.environment = envRenderTarget.texture;
      scene.background = null;

      // Add ambient light for base illumination
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
      scene.add(ambientLight);

      // Primary directional light (sun)
      const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
      keyLight.position.set(160, 200, 260);
      keyLight.target.position.set(0, 0, 0);
      scene.add(keyLight.target);
      scene.add(keyLight);

      // Secondary fill light to soften shadows slightly
      const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
      fillLight.position.set(-120, -80, 180);
      scene.add(fillLight);

      console.log('TrainLayer3D: Three.js scene initialized');

      // Mark scene as ready for mesh manager initialization
      setSceneReady(true);

      // T046, T047: Initialize train mesh manager with stations
      // Note: Manager creation deferred until stations are loaded
      // This will be handled in the mesh update effect

      // Note: Model preloading moved to separate useEffect for parallel loading
    },

    /**
     * Called on every frame when the map needs to render
     * Update camera matrices and render the Three.js scene
     *
     * Task: T048 - Animation loop integration
     * Task: T054 - Performance monitoring
     */
    render(_gl: WebGLRenderingContext, matrix: Array<number>) {
      // Skip rendering when layer hidden or tab not visible
      if (!visibleRef.current || !pageVisibleRef.current) {
        return;
      }

      const frameStartTime = performance.now();

      if (!sceneRef.current || !cameraRef.current || !rendererRef.current) {
        return;
      }

      const modelOrigin = getModelOrigin();
      if (!modelOrigin) {
        return;
      }

      const renderCamera = cameraRef.current;
      const renderer = rendererRef.current;
      if (!renderCamera) {
        return;
      }

      if (meshManagerRef.current) {
        // Compute padded geographic bounds for frustum-aware animation skip
        const mapBounds = map.getBounds();
        let geoBounds: GeoBounds | undefined;
        if (mapBounds) {
          const pad = 0.01; // ~1km padding to avoid pop-in at edges
          geoBounds = {
            west: mapBounds.getWest() - pad,
            east: mapBounds.getEast() + pad,
            south: mapBounds.getSouth() - pad,
            north: mapBounds.getNorth() + pad,
          };
        }
        meshManagerRef.current.animatePositions(geoBounds);
        // Phase 2: Apply parking visuals to stopped trains (rotate 90°)
        // Always call to process ongoing animations (including un-parking)
        // The enableParking flag controls whether NEW parking animations start
        meshManagerRef.current.applyParkingVisuals(enableTrainParkingRef.current);
      }

      // Reuse matrix instances for performance (avoid allocations per frame)
      const matrices = matrixRef.current;
      matrices.mapboxMatrix.fromArray(matrix);
      matrices.modelTransform
        .identity()
        .makeTranslation(modelOrigin.x, modelOrigin.y, modelOrigin.z ?? 0)
        .scale(matrices.scaleVector);

      // Use resultMatrix to avoid clone() allocation
      matrices.resultMatrix.copy(matrices.mapboxMatrix).multiply(matrices.modelTransform);
      renderCamera.projectionMatrix.copy(matrices.resultMatrix);
      if ('projectionMatrixInverse' in renderCamera) {
        (renderCamera as THREE.Camera & { projectionMatrixInverse: THREE.Matrix4 }).projectionMatrixInverse
          .copy(renderCamera.projectionMatrix)
          .invert();
      }
      // Snapshot the inverse for raycast use between frames
      projMatrixInverseRef.current.copy(matrices.resultMatrix).invert();
      renderCamera.matrixWorld.identity();
      renderCamera.matrixWorldInverse.identity();


      // Render the Three.js scene
      renderer.resetState();
      renderer.render(sceneRef.current, renderCamera);

      // T054: End frame time measurement and calculate performance metrics
      const frameEndTime = performance.now();
      const frameTime = frameEndTime - frameStartTime;
      const perf = performanceRef.current;

      perf.renderCount++;
      perf.frameCount++;

      // Use circular buffer for O(1) frame time tracking (avoid O(n) shift)
      perf.frameTimes[perf.frameTimeIndex] = frameTime;
      perf.frameTimeIndex = (perf.frameTimeIndex + 1) % 60;

      // Calculate FPS and average frame time
      const timeSinceLastFrame = frameStartTime - perf.lastFrameTime;
      perf.lastFrameTime = frameStartTime;
      perf.fps = timeSinceLastFrame > 0 ? 1000 / timeSinceLastFrame : 60;
      perf.avgFrameTime = perf.frameTimes.reduce((a, b) => a + b, 0) / perf.frameTimes.length;

      // T103: Log performance every 5 seconds with optimization warnings
      const timeSinceLastLog = frameStartTime - perf.lastLogTime;
      if (timeSinceLastLog >= 5000) {
        const trainCount = meshManagerRef.current?.getMeshCount() ?? 0;
        const avgFps = 1000 / perf.avgFrameTime;
        const minFrameTime = Math.min(...perf.frameTimes);
        const maxFrameTime = Math.max(...perf.frameTimes);

        console.log(`[Performance] Trains: ${trainCount} | FPS: ${avgFps.toFixed(1)} | Frame: ${perf.avgFrameTime.toFixed(2)}ms (min: ${minFrameTime.toFixed(2)}ms, max: ${maxFrameTime.toFixed(2)}ms) | Renders: ${perf.renderCount}`);

        // T046: Log scale cache performance
        if (meshManagerRef.current) {
          const cacheStats = meshManagerRef.current.getScaleManager().getCacheStats();
          console.log(`[ScaleCache] Size: ${cacheStats.size} | Hits: ${cacheStats.hits} | Misses: ${cacheStats.misses} | Hit Rate: ${(cacheStats.hitRate * 100).toFixed(1)}%`);

          // T046: Warn if cache hit rate is poor
          if (cacheStats.hitRate < 0.95 && cacheStats.hits + cacheStats.misses > 100) {
            console.warn(`[ScaleCache] Low cache hit rate (${(cacheStats.hitRate * 100).toFixed(1)}%). Expected >95% for optimal performance.`);
          }
        }

        // T103: Warn if performance is degraded
        if (avgFps < 30) {
          console.warn(`[Performance] Low FPS detected (${avgFps.toFixed(1)}). Consider reducing train count or disabling features.`);
        }
        if (maxFrameTime > 33.33) {
          console.warn(`[Performance] Frame drops detected (max: ${maxFrameTime.toFixed(2)}ms). Some frames taking >33ms.`);
        }

        perf.lastLogTime = frameStartTime;
        perf.renderCount = 0;
      }

      // Request next frame to continue animation loop
      // Only trigger repaint when layer is visible and has trains to animate
      // This prevents unnecessary render calls to all 5 custom layers when hidden
      const meshCount = meshManagerRef.current?.getMeshCount() ?? 0;
      if (visibleRef.current && meshCount > 0) {
        map.triggerRepaint();
      }
    },

    /**
     * Called when layer is removed from the map
     * Clean up Three.js resources
     */
    onRemove() {
      // Cleanup will be handled in component unmount
      console.log('TrainLayer3D: Layer removed from map');
    },
  }), [map]);

  /**
   * Effect: Load all static data in parallel (stations, railways, line colors, 3D models)
   * Fetches manifest once and passes it to dependent loaders to avoid redundant fetches.
   */
  useEffect(() => {
    // Model preload is independent of manifest — start immediately
    preloadAllTrainModels()
      .then(() => {
        setModelsLoaded(true);
        console.log('TrainLayer3D: All train models loaded and ready');
      })
      .catch((error) => {
        console.error('TrainLayer3D: Failed to load train models:', error);
        setError('Failed to load 3D train models');
      });

    // Load manifest once, then fetch all data files in parallel
    const loadData = async () => {
      try {
        const manifest = await loadManifest();
        const [stationCollection, collection, lines] = await Promise.all([
          loadStations(manifest),
          loadLineGeometryCollection(manifest),
          loadRodaliesLines(manifest),
        ]);

        // Process stations
        const stations: Station[] = stationCollection.features.map((feature) => ({
          id: feature.properties.id,
          name: feature.properties.name,
          code: feature.properties.code,
          lines: feature.properties.lines,
          geometry: feature.geometry,
        }));
        stationsRef.current = stations;
        stationMapRef.current = new Map(stations.map((station) => [station.id, station]));
        setStationsLoaded(true);
        console.log(`TrainLayer3D: Loaded ${stations.length} stations for bearing calculations`);

        // Process railway geometry
        const processed = new Map<string, PreprocessedRailwayLine>();
        collection.features.forEach((feature) => {
          const shortCode = feature.properties?.short_code ?? feature.properties?.id;
          if (!shortCode) return;
          const preprocessed = preprocessRailwayLine(feature.geometry);
          if (preprocessed) {
            processed.set(shortCode.toUpperCase(), preprocessed);
          }
        });
        railwaysRef.current = processed;
        setRailwaysLoaded(true);
        console.log(`TrainLayer3D: Preprocessed ${processed.size} railway lines for snapping`);

        // Process line colors
        const colorMap = buildLineColorMap(lines);
        lineColorMapRef.current = colorMap;
        console.log(`TrainLayer3D: Loaded ${colorMap.size} line colors for outlines`);
      } catch (err) {
        console.error('TrainLayer3D: Failed to load data:', err);
        setError('Failed to load map data');
        setRailwaysLoaded(true);
      }
    };
    void loadData();
  }, []);

  /**
   * Effect: Notify parent of loading state changes
   * Task: T099 - Expose loading state for skeleton UI
   */
  useEffect(() => {
    onLoadingChange?.(isLoading && trains.length === 0);
  }, [isLoading, trains.length, onLoadingChange]);

  /**
   * Effect: Notify parent of detailed loading stages
   * Task: T013 - Expose loading stages for loading overlay
   */
  useEffect(() => {
    onLoadingStageChange?.({
      models: modelsLoaded,
      trains: !isLoading, // Ready when API has responded, even if no trains
    });
  }, [modelsLoaded, isLoading, onLoadingStageChange]);

  /**
   * Effect: Update transit state with Rodalies data source
   * Rodalies always uses real-time API data (no simulation fallback)
   * When API fails or returns no trains, status is 'unavailable'
   */
  useEffect(() => {
    if (trains.length > 0 && !error) {
      setDataSource('rodalies', 'realtime');
    } else if (!isLoading && (error || trains.length === 0)) {
      // API has responded but either errored or returned no trains
      setDataSource('rodalies', 'unavailable');
    }
  }, [trains.length, error, isLoading, setDataSource]);

  /**
   * Effect: Notify parent of train data changes
   * Used for TrainListButton to access train data without state in TrainLayer3D
   */
  useEffect(() => {
    onTrainsChange?.(trains);
  }, [trains, onTrainsChange]);

  /**
   * Effect: Expose mesh position getter to parent component
   * Used for TrainListPanel to zoom to actual mesh position (not API GPS)
   */
  useEffect(() => {
    if (meshManagerRef.current && onMeshPositionGetterReady) {
      onMeshPositionGetterReady((vehicleKey: string) => {
        return meshManagerRef.current?.getMeshLngLat(vehicleKey) ?? null;
      });
    }
  }, [stationsLoaded, railwaysLoaded, sceneReady, onMeshPositionGetterReady]);

  /**
   * Effect: Check for stale data
   * Task: T097 - Detect when polledAt timestamp is older than 60 seconds
   */
  useEffect(() => {
    const checkStaleData = () => {
      const currentPolledAt = pollTimestampsRef.current.current;
      if (!currentPolledAt) {
        setIsDataStale(false);
        return;
      }

      const now = Date.now();
      const dataAge = now - currentPolledAt;
      const isStale = dataAge > STALE_DATA_THRESHOLD_MS;

      if (isStale && !isDataStale) {
        console.warn(`TrainLayer3D: Data is stale (age: ${Math.round(dataAge / 1000)}s)`);
      }

      setIsDataStale(isStale);
    };

    // Check immediately
    checkStaleData();

    // Check every 5 seconds
    const staleCheckInterval = setInterval(checkStaleData, 5000);

    return () => {
      clearInterval(staleCheckInterval);
    };
  }, [isDataStale]);

  /**
   * Secret command listener to toggle debug tools globally.
   * Type "toggledebug" anywhere (outside form fields) to flip,
   * or "showdebug"/"hidedebug" to force state.
   */
  useEffect(() => {
    const BUFFER_LIMIT = 32;
    let buffer = '';

    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTextInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.getAttribute('contenteditable') === 'true');
      if (isTextInput) {
        return;
      }

      if (event.key.length === 1) {
        buffer = (buffer + event.key.toLowerCase()).slice(-BUFFER_LIMIT);

        if (buffer.includes('toggledebug')) {
          handleSecretDebugToggle();
          buffer = '';
        } else if (buffer.includes('showdebug')) {
          handleSecretDebugToggle(true);
          buffer = '';
        } else if (buffer.includes('hidedebug')) {
          handleSecretDebugToggle(false);
          buffer = '';
        }
      } else if (event.key === 'Escape') {
        buffer = '';
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSecretDebugToggle]);

  /**
   * Effect: Control visibility and pause polling when layer is hidden
   * When visible=false:
   * - Pause API polling to save resources
   * - Hide all train meshes by setting their visibility to false
   */
  useEffect(() => {
    // Pause/resume polling based on visibility
    if (!visible) {
      setIsPollingPaused(true);
    } else {
      // Only resume if we were paused due to visibility (not user action)
      setIsPollingPaused(false);
    }

    // Hide/show all train meshes
    if (meshManagerRef.current) {
      meshManagerRef.current.setAllMeshesVisible(visible);
      // Trigger Mapbox repaint to reflect visibility change
      map.triggerRepaint();
    }
  }, [visible, map]);

  /**
   * Effect: Set up polling for train positions
   * Fetches on mount and every 30 seconds (unless paused or tab hidden)
   */
  useEffect(() => {
    // Pause polling when tab hidden or explicitly paused
    if (isPollingPaused || !pageVisible) {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      return;
    }

    // Initial fetch (also fires when tab becomes visible again)
    void fetchTrains();

    // Set up polling every 30 seconds
    pollingIntervalRef.current = setInterval(() => {
      void fetchTrains();
    }, POLLING_INTERVAL_MS);

    // Cleanup: clear interval and retry timeout on unmount or dependency change
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  }, [fetchTrains, isPollingPaused, pageVisible]);

  /**
   * Effect: Add custom layer to map when ready
   */
  useEffect(() => {
    console.log('TrainLayer3D: useEffect for adding layer triggered', {
      hasMap: !!map,
      layerAdded: layerAddedRef.current,
      isStyleLoaded: map?.isStyleLoaded(),
    });

    if (!map || layerAddedRef.current) {
      console.log('TrainLayer3D: Skipping layer add - map missing or layer already added');
      return;
    }

    // Wait for map style to load
    const onStyleLoad = () => {
      console.log('TrainLayer3D: onStyleLoad called, attempting to add layer...');

      try {
        // Check if layer already exists (only if style is loaded to avoid errors)
        // If style isn't loaded, skip this check and proceed to addLayer
        if (map.isStyleLoaded() && map.getLayer(LAYER_ID)) {
          console.warn('TrainLayer3D: Layer already exists, skipping add');
          return;
        }

        // Add the custom layer to the map
        console.log('TrainLayer3D: Adding custom layer to map...');
        map.addLayer(customLayer, beforeId);
        layerAddedRef.current = true;

        // Keep train layer on top whenever new layers are added (e.g. async Rodalies lines).
        // The styledata event fires when any layer/source is added or changed.
        const ensureOnTop = () => {
          if (!map.getLayer(LAYER_ID)) return;
          const layers = map.getStyle().layers ?? [];
          const lastLayer = layers[layers.length - 1];
          if (lastLayer && lastLayer.id !== LAYER_ID) {
            map.moveLayer(LAYER_ID);
          }
        };
        ensureOnTopRef.current = ensureOnTop;
        ensureOnTop();
        map.on('styledata', ensureOnTop);

        console.log(
          `TrainLayer3D: Custom layer added to map${beforeId ? ` before ${beforeId}` : ''}`
        );
      } catch (error) {
        console.error('TrainLayer3D: Failed to add custom layer:', error);
        setError('Failed to initialize 3D layer');
      }
    };

    // Add layer when map is ready
    // Use a small delay to ensure all map initialization is complete
    const timer = setTimeout(() => {
      console.log('TrainLayer3D: Adding layer after initialization delay');
      onStyleLoad();
    }, 100);

    // Cleanup: remove layer on unmount and clear timer
    return () => {
      clearTimeout(timer);

      if (ensureOnTopRef.current) {
        map.off('styledata', ensureOnTopRef.current);
        ensureOnTopRef.current = null;
      }

      if (layerAddedRef.current) {
        try {
          // Only check for layer existence if style is loaded
          if (map.isStyleLoaded() && map.getLayer(LAYER_ID)) {
            map.removeLayer(LAYER_ID);
            layerAddedRef.current = false;
            console.log('TrainLayer3D: Custom layer removed from map');
          }
        } catch (error) {
          console.error('TrainLayer3D: Failed to remove custom layer:', error);
        }
      }

      // Cleanup train meshes (T046)
      if (meshManagerRef.current) {
        meshManagerRef.current.clearAll();
        meshManagerRef.current = null;
      }

      // Cleanup Three.js resources
      if (rendererRef.current) {
        rendererRef.current.dispose();
        rendererRef.current = null;
      }
      if (environmentRTRef.current) {
        environmentRTRef.current.dispose();
        environmentRTRef.current = null;
      }
      if (pmremGeneratorRef.current) {
        pmremGeneratorRef.current.dispose();
        pmremGeneratorRef.current = null;
      }

      sceneRef.current = null;
      cameraRef.current = null;
    };
  }, [map, beforeId, customLayer]);

  /**
   * Effect: Create mesh manager when stations and scene are ready
   * Task: T047 - Initialize manager with station data
   *
   * NOTE: This effect ONLY creates the manager. Train mesh updates are handled
   * by a separate effect below to avoid double-calling updateTrainMeshes
   * which was causing train teleportation issues.
   */
  useEffect(() => {
    if (
      !stationsLoaded ||
      !railwaysLoaded ||
      !sceneReady ||
      !sceneRef.current
    ) {
      return;
    }

    if (!meshManagerRef.current) {
      meshManagerRef.current = new TrainMeshManager(
        sceneRef.current,
        stationsRef.current,
        railwaysRef.current
      );
      console.log(
        `TrainLayer3D: Mesh manager initialized with ${stationsRef.current.length} stations and ${railwaysRef.current.size} railway lines`
      );
      // Apply initial visibility state
      meshManagerRef.current.setAllMeshesVisible(visibleRef.current);
      // Signal that mesh manager is ready - this triggers train mesh update effect
      setMeshManagerReady(true);
    }
    // NOTE: Do NOT call updateTrainMeshes here - it's handled by the train update effect below
    // Calling it in both places causes double-updates which corrupt interpolation state
  }, [stationsLoaded, railwaysLoaded, sceneReady]);

  /**
   * Effect: Update train meshes when train data or models change
   * Tasks: T046 - Create and update train mesh instances
   *        T047 - Apply bearing-based rotation
   *        T089 - Filter trains by selected line IDs
   */
  useEffect(() => {
    // Only update meshes when models, stations, and manager are ready
    // meshManagerReady is a state (not ref) so this effect re-runs when manager is created
    if (!modelsLoaded || !stationsLoaded || !meshManagerReady || !meshManagerRef.current) {
      if (trains.length > 0) {
        const waiting: string[] = [];
        if (!modelsLoaded) waiting.push('models');
        if (!stationsLoaded) waiting.push('stations');
        if (!meshManagerReady) waiting.push('mesh manager');
        console.log(
          `TrainLayer3D: ${trains.length} trains fetched, waiting for ${waiting.join(', ')}...`
        );
      }
      return;
    }

    // Update train meshes based on current train positions
    // This will apply bearing-based rotation automatically (T047)
    meshManagerRef.current.updateTrainMeshes(trains, previousPositionsRef.current, {
      currentPolledAtMs: pollTimestampsRef.current.current,
      previousPolledAtMs: pollTimestampsRef.current.previous,
      receivedAtMs: pollTimestampsRef.current.receivedAt,
    });

    // Apply visibility state after updating meshes
    // Always set visibility explicitly to ensure meshes are shown/hidden correctly
    // This handles both: new trains added while hidden AND initial load with visible=true
    meshManagerRef.current.setAllMeshesVisible(visibleRef.current);

    // T089: Apply memoized train opacities based on line selection
    // Performance: Uses memoized trainOpacities map instead of recalculating
    if (trainOpacities) {
      meshManagerRef.current.setTrainOpacities(trainOpacities);
    } else {
      meshManagerRef.current.resetAllOpacities();
    }

    // CRITICAL: Trigger Mapbox repaint after updating meshes
    // Without this, Mapbox doesn't know the scene changed and won't render
    // the new train meshes until something else triggers a repaint (like map movement).
    // This fixes the bug where trains don't appear on initial load.
    map.triggerRepaint();

    if (trains.length > 0) {
      console.log(
        `TrainLayer3D: ${meshManagerRef.current.getMeshCount()} train meshes active with rotation${isDataStale ? ' (STALE)' : ''}`
      );

      // Log diagnostic info about trains that appear stuck
      const stuckTrains = meshManagerRef.current.getStuckTrainsDiagnostic();
      if (stuckTrains.length > 0) {
        console.warn(`TrainLayer3D: ${stuckTrains.length} trains appear stuck (in transit but no movement):`, stuckTrains);
      }
    }
  }, [trains, modelsLoaded, stationsLoaded, meshManagerReady, trainOpacities, map]);

  /**
   * Effect: Update train scales when zoom changes
   * Two buckets: < 15 (full size) and >= 15 (half size to avoid buildings)
   */
  useEffect(() => {
    const handleZoomChange = () => {
      if (meshManagerRef.current) {
        const currentZoom = map.getZoom();
        meshManagerRef.current.setCurrentZoom(currentZoom);
        meshManagerRef.current.applyZoomResponsiveScale();
      }
    };

    map.on('zoom', handleZoomChange);
    handleZoomChange();

    return () => {
      map.off('zoom', handleZoomChange);
    };
  }, [map]);

  /**
   * Effect: Update user-controlled model scale
   */
  useEffect(() => {
    if (meshManagerRef.current) {
      meshManagerRef.current.setUserScale(modelScale);
    }
  }, [modelScale]);

  useEffect(() => {
    if (meshManagerRef.current) {
      meshManagerRef.current.setViewModeScale(viewModeScale);
    }
  }, [viewModeScale]);

  /**
   * Effect: Handle pointer hover using screen-space distance
   */
  useEffect(() => {
    const canvas = map.getCanvas();

    canvas.addEventListener('mousemove', handlePointerMove);
    canvas.addEventListener('mouseleave', handlePointerLeave);

    return () => {
      canvas.removeEventListener('mousemove', handlePointerMove);
      canvas.removeEventListener('mouseleave', handlePointerLeave);
    };
  }, [map, handlePointerMove, handlePointerLeave]);

  /**
   * Effect: Register with VehicleClickCoordinator for coordinated click handling.
   * Hidden Rodalies trains are excluded by checking the visible prop.
   */
  useEffect(() => {
    if (!clickCoordinator) return;

    clickCoordinator.register(
      'rodalies',
      (point, paddingPx) => {
        if (hitDetectionMode === 'raycast') {
          const hit = resolveRaycastHit(point);
          if (!hit) return null;
          return {
            vehicleKey: hit.vehicleKey,
            distance: hit.distance,
            metadata: { routeId: hit.routeId },
          };
        }
        const hit = resolveScreenHit(point, paddingPx);
        if (!hit) return null;
        return {
          vehicleKey: hit.vehicleKey,
          distance: hit.distance,
          metadata: { routeId: hit.routeId },
        };
      },
      (hit) => {
        onRaycastResult?.({
          hit: true,
          vehicleKey: hit.vehicleKey,
          routeId: (hit.metadata?.routeId as string) ?? undefined,
          objectsHit: 1,
          timestamp: Date.now(),
        });

        // Show panel immediately from cached position data
        const pos = lastPositionsRef.current.get(hit.vehicleKey);
        const placeholder: Train = {
          vehicleKey: hit.vehicleKey,
          vehicleId: null,
          vehicleLabel: hit.vehicleKey,
          entityId: hit.vehicleKey,
          tripId: null,
          routeId: pos?.routeId ?? (hit.metadata?.routeId as string) ?? null,
          latitude: pos?.latitude ?? null,
          longitude: pos?.longitude ?? null,
          currentStopId: pos?.currentStopId ?? null,
          previousStopId: pos?.previousStopId ?? null,
          nextStopId: pos?.nextStopId ?? null,
          nextStopSequence: null,
          status: pos?.status ?? 'IN_TRANSIT_TO',
          arrivalDelaySeconds: null,
          departureDelaySeconds: null,
          scheduleRelationship: null,
          predictedArrivalUtc: pos?.predictedArrivalUtc ?? null,
          predictedDepartureUtc: null,
          vehicleTimestampUtc: null,
          polledAtUtc: pos?.polledAtUtc ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        selectTrain(placeholder);
        setActivePanel('trainInfo');

        // Enrich with full details in background
        fetchTrainByKey(hit.vehicleKey)
          .then((trainData) => selectTrain(trainData))
          .catch((error) => console.error('Failed to fetch train details:', error));
      },
      visible,
    );

    return () => {
      clickCoordinator.unregister('rodalies');
    };
  }, [clickCoordinator, resolveScreenHit, resolveRaycastHit, hitDetectionMode, visible, onRaycastResult, selectTrain, setActivePanel]);

  /**
   * Effect: Sync visibility with coordinator
   */
  useEffect(() => {
    if (clickCoordinator) {
      clickCoordinator.setLayerVisible('rodalies', visible);
    }
  }, [clickCoordinator, visible]);

  // T096: Display user-friendly error message when API unavailable
  // Only show error if we have no trains to display (don't disrupt working state)
  const shouldShowError = error && !isLoading && trains.length === 0;

  if (shouldShowError) {
    console.warn('TrainLayer3D error:', error);
  }

  // Train counter overlay (T094) - hidden for now, can be enabled in the future
  // Error overlay (T096) - shows when API is unavailable
  if (shouldShowError) {
    return <TrainErrorDisplay error={error!} onRetry={handleManualRetry} />;
  }

  return (
    <>
      {areDebugToolsEnabled && (
        <TrainDebugPanel
          meshManager={meshManagerRef.current}
          currentZoom={map.getZoom()}
          lastPollTime={lastPollTime}
          pollingIntervalMs={POLLING_INTERVAL_MS}
          isPollingPaused={isPollingPaused}
          onTogglePolling={handleTogglePolling}
          onManualPoll={handleManualPoll}
        />
      )}
    </>
  );
}
