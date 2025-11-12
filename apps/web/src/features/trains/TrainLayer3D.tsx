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
import type { TrainPosition } from '../../types/trains';
import type { Station } from '../../types/rodalies';
import { fetchTrainPositions, fetchTrainByKey } from '../../lib/api/trains';
import { preloadAllTrainModels } from '../../lib/trains/modelLoader';
import { TrainMeshManager } from '../../lib/trains/trainMeshManager';
import { loadStations, loadLineGeometryCollection, loadRodaliesLines } from '../../lib/rodalies/dataLoader';
import { buildLineColorMap } from '../../lib/trains/outlineManager';
import { getModelOrigin } from '../../lib/map/coordinates';
import { preprocessRailwayLine, type PreprocessedRailwayLine } from '../../lib/trains/geometry';
import { extractLineFromRouteId } from '../../config/trainModels';
import { useTrainActions } from '../../state/trains';
import { useMapActions, useMapHighlightSelectors } from '../../state/map';
import { TrainErrorDisplay } from './TrainErrorDisplay';
import { TrainDebugPanel } from './TrainDebugPanel';

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
export function TrainLayer3D({ map, beforeId, onRaycastResult, onLoadingChange }: TrainLayer3DProps) {
  const { selectTrain } = useTrainActions();
  const { setActivePanel } = useMapActions();
  const { highlightMode, highlightedLineIds, isLineHighlighted } = useMapHighlightSelectors();

  const [trains, setTrains] = useState<TrainPosition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [stationsLoaded, setStationsLoaded] = useState(false);
  const [railwaysLoaded, setRailwaysLoaded] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [isDataStale, setIsDataStale] = useState(false);

  // Phase 5: Line color map for hover outlines
  const lineColorMapRef = useRef<Map<string, THREE.Color> | null>(null);

  // References for Three.js scene components
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const pmremGeneratorRef = useRef<THREE.PMREMGenerator | null>(null);
  const environmentRTRef = useRef<THREE.WebGLRenderTarget | null>(null);

  // Reference for stations data (T047)
  const stationsRef = useRef<Station[]>([]);
  const railwaysRef = useRef<Map<string, PreprocessedRailwayLine>>(new Map());

  // Reference for train mesh manager (T046, T047)
  const meshManagerRef = useRef<TrainMeshManager | null>(null);
  const previousPositionsRef = useRef<Map<string, TrainPosition>>(new Map());
  const lastPositionsRef = useRef<Map<string, TrainPosition>>(new Map());
  const loggedDistinctPreviousRef = useRef(false);
  const pollTimestampsRef = useRef<{ current?: number; previous?: number; receivedAt?: number }>({});

  // Reference for Three.js Raycaster for click detection (T049)

  // Store polling interval reference for cleanup
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  // Store retry timeout reference for cleanup (T097)
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Track if layer has been added to map
  const layerAddedRef = useRef(false);

  // Performance monitoring (T054)
  const performanceRef = useRef({
    frameCount: 0,
    lastFrameTime: performance.now(),
    frameTimes: [] as number[],
    fps: 60,
    avgFrameTime: 16.67,
    lastLogTime: performance.now(),
    renderCount: 0,
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
    if (highlightMode === 'none' || highlightedLineIds.length === 0) {
      return 1.0;
    }

    // Extract line code from route ID using existing utility function
    const lineCode = extractLineFromRouteId(train.routeId);
    if (!lineCode) {
      // If we can't extract a line code, show at full opacity
      return 1.0;
    }

    // Check if this train's line is highlighted
    const isHighlighted = isLineHighlighted(lineCode);

    if (isHighlighted) {
      return 1.0; // Full opacity for selected lines
    } else if (highlightMode === 'highlight') {
      return 0.25; // 25% opacity for non-selected lines in highlight mode
    } else {
      return 0.0; // Invisible for non-selected lines in isolate mode
    }
  }, [highlightMode, highlightedLineIds, isLineHighlighted]);

  /**
   * Fetches latest train positions from the API
   * Updates state and handles errors with exponential backoff retry
   * Task: T096 - Error handling with retry mechanism
   */
  const fetchTrains = async () => {
    try {
      setIsLoading(true);
      const response = await fetchTrainPositions();
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

      const snapshotPreviousPositions = new Map<string, TrainPosition>();
      if (response.previousPositions) {
        response.previousPositions.forEach((position) => {
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
        const previousStats = Array.from(snapshotPreviousPositions.values()).reduce(
          (acc, previous) => {
            const current = response.positions.find((pos) => pos.vehicleKey === previous.vehicleKey);
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

      // Filter out trains without valid GPS coordinates
      const validTrains = response.positions.filter(
        (train) => train.latitude !== null && train.longitude !== null
      );

      const currentPositionsMap = new Map<string, TrainPosition>();
      validTrains.forEach((train) => {
        currentPositionsMap.set(train.vehicleKey, train);
      });
      lastPositionsRef.current = currentPositionsMap;

      setTrains(validTrains);
      setError(null);
      setRetryCount(0);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to fetch train positions';
      setError(errorMessage);
      console.error('Error fetching train positions:', err);

      // T097: Implement exponential backoff retry
      // Retry with increasing delays: 2s, 4s, 8s, 16s, 32s (max)
      const nextRetryCount = retryCount + 1;
      const maxRetries = 5;

      if (nextRetryCount <= maxRetries) {
        const retryDelayMs = Math.min(2000 * Math.pow(2, retryCount), 32000);
        console.log(`TrainLayer3D: Retrying in ${retryDelayMs / 1000}s (attempt ${nextRetryCount}/${maxRetries})`);

        setRetryCount(nextRetryCount);

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
      setIsLoading(false);
    }
  };

  /**
   * Manual retry function for user-initiated retry
   * Task: T096 - Allow users to manually retry failed requests
   */
  const handleManualRetry = useCallback(() => {
    setRetryCount(0);
    setError(null);
    void fetchTrains();
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
        routeId: string;
        distance: number;
      } | null = null;

      const debugEnabled = debugEnabledRef.current;
      if (debugEnabled) {
        console.log(`[resolveScreenHit] Checking ${candidates.length} candidates at (${point.x.toFixed(1)}, ${point.y.toFixed(1)})`);
      }

      for (const candidate of candidates) {
        const dx = candidate.screenPoint.x - point.x;
        const dy = candidate.screenPoint.y - point.y;
        const distance = Math.hypot(dx, dy);
        const threshold = Math.max(candidate.radiusPx, 14) + paddingPx;

        if (debugEnabled && distance <= threshold * 2) {
          console.log(
            `  ${candidate.vehicleKey}: distance=${distance.toFixed(1)}px, threshold=${threshold.toFixed(1)}px`,
            distance <= threshold ? '✓ HIT' : '✗ miss'
          );
        }

        if (distance <= threshold) {
          if (!nearest || distance < nearest.distance) {
            nearest = {
              vehicleKey: candidate.vehicleKey,
              routeId: candidate.routeId,
              distance,
            };
          }
        }
      }

      if (debugEnabled) {
        console.log(`[resolveScreenHit] Result:`, nearest ? `${nearest.vehicleKey} (${nearest.distance.toFixed(1)}px)` : 'none');
      }

      return nearest;
    },
    [map]
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
  const debugEnabledRef = useRef(
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')
  );

  useEffect(() => {
    if (!debugEnabledRef.current) {
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '1000';
    canvas.width = map.getCanvas().width;
    canvas.height = map.getCanvas().height;
    map.getCanvasContainer().appendChild(canvas);
    debugCanvasRef.current = canvas;

    console.log('🔍 Debug overlay enabled - red circles show click areas');

    return () => {
      if (debugCanvasRef.current && debugCanvasRef.current.parentNode) {
        debugCanvasRef.current.parentNode.removeChild(debugCanvasRef.current);
      }
    };
  }, [map]);

  const drawDebugOverlay = useCallback(() => {
    if (!debugEnabledRef.current) {
      return;
    }

    const canvas = debugCanvasRef.current;
    if (!canvas || !meshManagerRef.current) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    canvas.width = map.getCanvas().width;
    canvas.height = map.getCanvas().height;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const candidates = meshManagerRef.current.getScreenCandidates(map);

    candidates.forEach((candidate) => {
      const isHovered = hoveredVehicleRef.current === candidate.vehicleKey;

      ctx.beginPath();
      ctx.arc(candidate.screenPoint.x, candidate.screenPoint.y, candidate.radiusPx, 0, 2 * Math.PI);
      ctx.strokeStyle = isHovered ? '#00ff00' : '#ff0000';
      ctx.lineWidth = isHovered ? 3 : 1.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(candidate.screenPoint.x, candidate.screenPoint.y, 3, 0, 2 * Math.PI);
      ctx.fillStyle = isHovered ? '#00ff00' : '#ffff00';
      ctx.fill();

      if (isHovered) {
        ctx.fillStyle = 'white';
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 3;
        ctx.font = 'bold 14px monospace';
        const text = `${candidate.vehicleKey} (${candidate.routeId})`;
        ctx.strokeText(text, candidate.screenPoint.x + 10, candidate.screenPoint.y - 10);
        ctx.fillText(text, candidate.screenPoint.x + 10, candidate.screenPoint.y - 10);
      }
    });

    requestAnimationFrame(drawDebugOverlay);
  }, [map]);

  useEffect(() => {
    if (debugEnabledRef.current && debugCanvasRef.current) {
      drawDebugOverlay();
    }
  }, [drawDebugOverlay]);

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

      const hit = resolveScreenHit(point, 6);
      const vehicleKey = hit?.vehicleKey ?? null;

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
    [map, resolveScreenHit]
  );

  const handlePointerLeave = useCallback(() => {
    // Hide outline when leaving canvas
    if (hoveredVehicleRef.current && lineColorMapRef.current) {
      meshManagerRef.current?.hideOutline(hoveredVehicleRef.current);
    }

    hoveredVehicleRef.current = null;
    meshManagerRef.current?.setHighlightedTrain(undefined);
  }, []);

  const handlePointerClick = useCallback(
    async (event: MouseEvent) => {
      const canvas = map.getCanvas();
      const rect = canvas.getBoundingClientRect();
      const point = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };

      const hit = resolveScreenHit(point, 4);

      if (hit) {
        console.log(`🎯 Train clicked: ${hit.vehicleKey} (route: ${hit.routeId})`);
        onRaycastResult?.({
          hit: true,
          vehicleKey: hit.vehicleKey,
          routeId: hit.routeId,
          objectsHit: 1,
          timestamp: Date.now(),
        });

        try {
          const trainData = await fetchTrainByKey(hit.vehicleKey);
          selectTrain(trainData);
          setActivePanel('trainInfo');
        } catch (error) {
          console.error('Failed to fetch train details:', error);
        }
      } else {
        onRaycastResult?.({
          hit: false,
          objectsHit: 0,
          timestamp: Date.now(),
        });
      }
    },
    [map, onRaycastResult, resolveScreenHit, selectTrain, setActivePanel]
  );

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

      // T045: Preload all train models (447, 470, Civia)
      // Load in background to avoid blocking map initialization
      preloadAllTrainModels()
        .then(() => {
          setModelsLoaded(true);
          console.log('TrainLayer3D: All train models loaded and ready');
        })
        .catch((error) => {
          console.error('TrainLayer3D: Failed to load train models:', error);
          setError('Failed to load 3D train models');
        });
    },

    /**
     * Called on every frame when the map needs to render
     * Update camera matrices and render the Three.js scene
     *
     * Task: T048 - Animation loop integration
     * Task: T054 - Performance monitoring
     */
    render(_gl: WebGLRenderingContext, matrix: Array<number>) {
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
        meshManagerRef.current.animatePositions();
      }

      const mapboxMatrix = new THREE.Matrix4().fromArray(matrix);
      const modelTransform = new THREE.Matrix4()
        .makeTranslation(modelOrigin.x, modelOrigin.y, modelOrigin.z ?? 0)
        .scale(new THREE.Vector3(1, -1, 1));

      renderCamera.projectionMatrix.copy(mapboxMatrix.clone().multiply(modelTransform));
      if ('projectionMatrixInverse' in renderCamera) {
        (renderCamera as THREE.Camera & { projectionMatrixInverse: THREE.Matrix4 }).projectionMatrixInverse
          .copy(renderCamera.projectionMatrix)
          .invert();
      }
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
      perf.frameTimes.push(frameTime);

      // Keep only last 60 frames for rolling average
      if (perf.frameTimes.length > 60) {
        perf.frameTimes.shift();
      }

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
      map.triggerRepaint();
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
   * Effect: Load station data for bearing calculations
   * Task: T047
   */
  useEffect(() => {
    const loadStationData = async () => {
      try {
        const stationCollection = await loadStations();

        // Extract station data from GeoJSON features
        const stations: Station[] = stationCollection.features.map((feature) => ({
          id: feature.properties.id,
          name: feature.properties.name,
          code: feature.properties.code,
          lines: feature.properties.lines,
          geometry: feature.geometry,
        }));

        stationsRef.current = stations;
        setStationsLoaded(true);
        console.log(`TrainLayer3D: Loaded ${stations.length} stations for bearing calculations`);
      } catch (err) {
        console.error('TrainLayer3D: Failed to load stations:', err);
        setError('Failed to load station data');
      }
    };

    void loadStationData();
  }, []);

  /**
   * Effect: Load railway geometry and preprocess for snapping
   */
  useEffect(() => {
    const loadRailwayData = async () => {
      try {
        const collection = await loadLineGeometryCollection();
        const processed = new Map<string, PreprocessedRailwayLine>();

        collection.features.forEach((feature) => {
          const shortCode = feature.properties?.short_code ?? feature.properties?.id;
          if (!shortCode) {
            return;
          }
          const preprocessed = preprocessRailwayLine(feature.geometry);
          if (preprocessed) {
            processed.set(shortCode.toUpperCase(), preprocessed);
          }
        });

        railwaysRef.current = processed;
        console.log(`TrainLayer3D: Preprocessed ${processed.size} railway lines for snapping`);
      } catch (err) {
        console.error('TrainLayer3D: Failed to load railway geometry for snapping', err);
        setError((prev) => prev ?? 'Failed to load railway geometry data');
      } finally {
        setRailwaysLoaded(true);
      }
    };

    void loadRailwayData();
  }, []);

  /**
   * Effect: Load line data and build color map for hover outlines
   * Phase 5: User Story 3 - Line Identification on Hover
   */
  useEffect(() => {
    const loadLineData = async () => {
      try {
        const lines = await loadRodaliesLines();
        const colorMap = buildLineColorMap(lines);
        lineColorMapRef.current = colorMap;
        console.log(`TrainLayer3D: Loaded ${colorMap.size} line colors for outlines`);
      } catch (err) {
        console.error('TrainLayer3D: Failed to load line data for outlines', err);
      }
    };

    void loadLineData();
  }, []);

  /**
   * Effect: Notify parent of loading state changes
   * Task: T099 - Expose loading state for skeleton UI
   */
  useEffect(() => {
    onLoadingChange?.(isLoading && trains.length === 0);
  }, [isLoading, trains.length, onLoadingChange]);

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
   * Effect: Set up polling for train positions
   * Fetches on mount and every 30 seconds
   */
  useEffect(() => {
    // Initial fetch
    void fetchTrains();

    // Set up polling every 30 seconds
    pollingIntervalRef.current = setInterval(() => {
      void fetchTrains();
    }, POLLING_INTERVAL_MS);

    // Cleanup: clear interval and retry timeout on unmount
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
  }, []);

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
        // Check if layer already exists (shouldn't, but defensive)
        if (map.getLayer(LAYER_ID)) {
          console.warn('TrainLayer3D: Layer already exists, skipping add');
          return;
        }

        // Add the custom layer to the map
        console.log('TrainLayer3D: Adding custom layer to map...');
        map.addLayer(customLayer, beforeId);
        layerAddedRef.current = true;

        console.log(
          `TrainLayer3D: Custom layer added to map${beforeId ? ` before ${beforeId}` : ''}`
        );
      } catch (error) {
        console.error('TrainLayer3D: Failed to add custom layer:', error);
        setError('Failed to initialize 3D layer');
      }
    };

    // Add layer when map is ready
    // Since this component only renders after map.on('load'), we can add immediately
    // But we'll use a small delay to ensure all map initialization is complete
    const timer = setTimeout(() => {
      console.log('TrainLayer3D: Adding layer after initialization delay');
      onStyleLoad();
    }, 100);

    // Cleanup: remove layer on unmount and clear timer
    return () => {
      clearTimeout(timer);

      if (layerAddedRef.current && map.getLayer(LAYER_ID)) {
        try {
          map.removeLayer(LAYER_ID);
          layerAddedRef.current = false;
          console.log('TrainLayer3D: Custom layer removed from map');
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
    }

    if (modelsLoaded && trains.length > 0 && meshManagerRef.current) {
      meshManagerRef.current.updateTrainMeshes(trains, previousPositionsRef.current, {
        currentPolledAtMs: pollTimestampsRef.current.current,
        previousPolledAtMs: pollTimestampsRef.current.previous,
        receivedAtMs: pollTimestampsRef.current.receivedAt,
      });
    }
  }, [stationsLoaded, railwaysLoaded, sceneReady, modelsLoaded, trains]);

  /**
   * Effect: Update train meshes when train data or models change
   * Tasks: T046 - Create and update train mesh instances
   *        T047 - Apply bearing-based rotation
   *        T089 - Filter trains by selected line IDs
   */
  useEffect(() => {
    // Only update meshes when models, stations, and manager are ready
    if (!modelsLoaded || !stationsLoaded || !meshManagerRef.current) {
      if (trains.length > 0) {
        const waiting: string[] = [];
        if (!modelsLoaded) waiting.push('models');
        if (!stationsLoaded) waiting.push('stations');
        if (!meshManagerRef.current) waiting.push('mesh manager');
        console.log(
          `TrainLayer3D: ${trains.length} trains fetched, waiting for ${waiting.join(', ')}...`
        );
      }
      return;
    }

    // T089: Calculate opacity for each train based on line selection
    // T098: Apply visual indicator for stale data
    const trainOpacities = new Map<string, number>();
    trains.forEach(train => {
      const baseOpacity = getTrainOpacity(train);
      // If data is stale, reduce opacity by 50% to gray out trains
      const finalOpacity = isDataStale ? baseOpacity * 0.5 : baseOpacity;
      trainOpacities.set(train.vehicleKey, finalOpacity);
    });

    // Update train meshes based on current train positions
    // This will apply bearing-based rotation automatically (T047)
    meshManagerRef.current.updateTrainMeshes(trains, previousPositionsRef.current, {
      currentPolledAtMs: pollTimestampsRef.current.current,
      previousPolledAtMs: pollTimestampsRef.current.previous,
      receivedAtMs: pollTimestampsRef.current.receivedAt,
    });

    // Apply opacity to all trains based on line selection and stale state
    meshManagerRef.current.setTrainOpacities(trainOpacities);

    if (trains.length > 0) {
      console.log(
        `TrainLayer3D: ${meshManagerRef.current.getMeshCount()} train meshes active with rotation${isDataStale ? ' (STALE)' : ''}`
      );
    }
  }, [trains, modelsLoaded, stationsLoaded, getTrainOpacity, isDataStale]);

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
   * Effect: Handle pointer hover/click using screen-space distance
   */
  useEffect(() => {
    const canvas = map.getCanvas();

    canvas.addEventListener('mousemove', handlePointerMove);
    canvas.addEventListener('mouseleave', handlePointerLeave);
    canvas.addEventListener('click', handlePointerClick);

    return () => {
      canvas.removeEventListener('mousemove', handlePointerMove);
      canvas.removeEventListener('mouseleave', handlePointerLeave);
      canvas.removeEventListener('click', handlePointerClick);
    };
  }, [map, handlePointerMove, handlePointerLeave, handlePointerClick]);

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

  return <TrainDebugPanel meshManager={meshManagerRef.current} currentZoom={map.getZoom()} />;
}
