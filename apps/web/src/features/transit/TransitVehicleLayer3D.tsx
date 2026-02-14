/**
 * TransitVehicleLayer3D Component
 *
 * Renders 3D transit vehicle models (Metro, Bus) on the Mapbox map using Three.js.
 * Uses schedule-based position simulation for Metro and (future) iBus API for Bus.
 *
 * Based on TrainLayer3D patterns but simplified for schedule-based positioning.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MapboxMap, CustomLayerInterface } from 'mapbox-gl';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { TransportType } from '../../types/rodalies';
import type { VehiclePosition } from '../../types/transit';
import { TransitMeshManager } from '../../lib/transit/transitMeshManager';
import { getModelOrigin, setModelOrigin } from '../../lib/map/coordinates';
import { useMetroPositions } from './hooks/useMetroPositions';
import { useBusPositions } from './hooks/useBusPositions';
import { useTramPositions } from './hooks/useTramPositions';
import { useFgcPositions } from './hooks/useFgcPositions';
import { useMapStyleReady } from '../../hooks/useMapStyleReady';
import { useTransitActions, type DataSourceType } from '../../state/transit';
import { useMapNetwork, useMapActions } from '../../state/map';
import type { VehicleClickCoordinator } from '../../lib/map/VehicleClickCoordinator';
import { useHitDetectionMode } from '../../hooks/useHitDetectionMode';
import { raycastHitTest } from '../../lib/map/RaycastHitResolver';

export interface TransitVehicleLayer3DProps {
  /** Mapbox GL Map instance */
  map: MapboxMap;
  /** Transport network type to render */
  networkType: TransportType;
  /** Whether layer is visible */
  visible?: boolean;
  /** Layer ID to insert before (z-index control) */
  beforeId?: string;
  /** Callback when loading state changes */
  onLoadingChange?: (isLoading: boolean) => void;
  /** Model scale multiplier (0.5 to 2.0, default 1.0) */
  modelScale?: number;
  /** Highlighted line IDs for filtering vehicles */
  highlightedLineIds?: string[];
  /** Whether isolate mode is active (hide non-highlighted vs dim them) */
  isolateMode?: boolean;
  /** Callback when mesh position getter is available */
  onMeshPositionGetterReady?: (getter: (vehicleKey: string) => [number, number] | null) => void;
  /** Shared click coordinator for cross-layer hit resolution */
  clickCoordinator?: VehicleClickCoordinator;
}

/**
 * TransitVehicleLayer3D
 *
 * Displays simulated transit vehicle positions as 3D models on the map.
 */
export function TransitVehicleLayer3D({
  map,
  networkType,
  visible = true,
  beforeId,
  onLoadingChange,
  modelScale = 1.0,
  highlightedLineIds = [],
  isolateMode = false,
  onMeshPositionGetterReady,
  clickCoordinator,
}: TransitVehicleLayer3DProps) {
  const [sceneReady, setSceneReady] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const styleReady = useMapStyleReady(map);
  const [hitDetectionMode] = useHitDetectionMode();

  // Track visibility in a ref for use in render loop
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  // State for bus filtering
  const { showOnlyTopBusLines } = useMapNetwork();

  // State actions
  const { selectVehicle, setDataSource } = useTransitActions();
  const { setActivePanel } = useMapActions();

  // Three.js references
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const projMatrixInverseRef = useRef(new THREE.Matrix4());
  const meshManagerRef = useRef<TransitMeshManager | null>(null);
  const environmentRTRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const layerAddedRef = useRef(false);

  // Generation counter to handle StrictMode double-mount race condition.
  // Ensures only the current meshManager's model loading promise updates state.
  const meshManagerGenerationRef = useRef(0);

  // Store current positions for O(1) lookup on click
  const positionsMapRef = useRef<Map<string, VehiclePosition>>(new Map());

  // Hover state (using ref for performance - no re-renders on hover)
  const hoveredVehicleRef = useRef<string | null>(null);
  const lastMouseMoveTime = useRef<number>(0);
  const MOUSE_MOVE_THROTTLE_MS = 100; // Throttle to max 10 FPS

  // Reusable matrix instances for render loop (avoid allocations per frame)
  const matrixRef = useRef({
    mapboxMatrix: new THREE.Matrix4(),
    modelTransform: new THREE.Matrix4(),
    resultMatrix: new THREE.Matrix4(),
    scaleVector: new THREE.Vector3(1, -1, 1),
  });

  // Layer ID based on network type
  const layerId = `transit-${networkType}-layer-3d`;

  // Get positions based on network type
  const {
    positions: metroPositions,
    isReady: metroReady,
    isLoading: metroLoading,
    isSimulationFallback: metroSimulation,
  } = useMetroPositions({
    enabled: networkType === 'metro' && visible,
  });

  const {
    positions: busPositions,
    isReady: busReady,
    isLoading: busLoading,
    isSimulationFallback: busSimulation,
  } = useBusPositions({
    enabled: networkType === 'bus' && visible,
    filterTopLinesOnly: showOnlyTopBusLines,
  });

  const {
    positions: tramPositions,
    isReady: tramReady,
    isLoading: tramLoading,
    isSimulationFallback: tramSimulation,
  } = useTramPositions({
    enabled: networkType === 'tram' && visible,
  });

  const {
    positions: fgcPositions,
    isReady: fgcReady,
    isLoading: fgcLoading,
    isSimulationFallback: fgcSimulation,
  } = useFgcPositions({
    enabled: networkType === 'fgc' && visible,
  });

  // Use appropriate positions based on network type
  // Wrap in useMemo to avoid changing dependency on every render
  const positions = useMemo(() => {
    if (networkType === 'metro') return metroPositions;
    if (networkType === 'bus') return busPositions;
    if (networkType === 'tram') return tramPositions;
    if (networkType === 'fgc') return fgcPositions;
    return [];
  }, [networkType, metroPositions, busPositions, tramPositions, fgcPositions]);

  const isDataReady = useMemo(() => {
    if (networkType === 'metro') return metroReady;
    if (networkType === 'bus') return busReady;
    if (networkType === 'tram') return tramReady;
    if (networkType === 'fgc') return fgcReady;
    return false;
  }, [networkType, metroReady, busReady, tramReady, fgcReady]);

  const isDataLoading = useMemo(() => {
    if (networkType === 'metro') return metroLoading;
    if (networkType === 'bus') return busLoading;
    if (networkType === 'tram') return tramLoading;
    if (networkType === 'fgc') return fgcLoading;
    return false;
  }, [networkType, metroLoading, busLoading, tramLoading, fgcLoading]);

  const isSimulationFallback = useMemo(() => {
    if (networkType === 'metro') return metroSimulation;
    if (networkType === 'bus') return busSimulation;
    if (networkType === 'tram') return tramSimulation;
    if (networkType === 'fgc') return fgcSimulation;
    return false;
  }, [networkType, metroSimulation, busSimulation, tramSimulation, fgcSimulation]);

  /**
   * Calculate vehicle opacities based on line selection
   * - No selection: All vehicles at 100% opacity
   * - Highlight mode: Selected lines at 100%, others at 25%
   * - Isolate mode: Selected lines at 100%, others at 0% (invisible)
   */
  const vehicleOpacities = useMemo(() => {
    // No filtering if no lines are selected
    if (highlightedLineIds.length === 0) {
      return null;
    }

    const opacities = new Map<string, number>();
    positions.forEach((vehicle) => {
      const isHighlighted = highlightedLineIds.includes(vehicle.lineCode);
      if (isHighlighted) {
        opacities.set(vehicle.vehicleKey, 1.0);
      } else if (isolateMode) {
        opacities.set(vehicle.vehicleKey, 0.0); // Invisible in isolate mode
      } else {
        opacities.set(vehicle.vehicleKey, 0.25); // Dimmed in highlight mode
      }
    });
    return opacities;
  }, [positions, highlightedLineIds, isolateMode]);

  // Notify parent of loading state
  useEffect(() => {
    onLoadingChange?.(isDataLoading || !modelLoaded);
  }, [isDataLoading, modelLoaded, onLoadingChange]);

  // Update transit state with data source status
  // Bus/Tram/FGC are always schedule-based (no real-time GPS data available)
  // Metro is realtime only if iMetro API works (not simulation fallback)
  useEffect(() => {
    if (!isDataReady) return;

    let source: DataSourceType;
    if (networkType === 'metro') {
      // Metro can be realtime (iMetro API) or schedule (simulation fallback)
      source = isSimulationFallback ? 'schedule' : 'realtime';
    } else {
      // Bus, Tram, FGC are always schedule-based
      source = 'schedule';
    }

    setDataSource(networkType, source);
  }, [isDataReady, isSimulationFallback, networkType, setDataSource]);

  /**
   * Mapbox Custom Layer Implementation
   */
  const customLayer = useMemo<CustomLayerInterface>(
    () => ({
      id: layerId,
      type: 'custom',
      renderingMode: '3d',

      onAdd(mapInstance: mapboxgl.Map, gl: WebGLRenderingContext) {
        // Increment generation to invalidate any pending promises from previous mounts
        const currentGeneration = ++meshManagerGenerationRef.current;

        // Initialize model origin if not set
        if (!getModelOrigin()) {
          setModelOrigin(mapInstance.getCenter());
        }

        // Create Three.js scene
        const scene = new THREE.Scene();
        sceneRef.current = scene;

        // Create camera
        const camera = new THREE.Camera();
        cameraRef.current = camera;

        // Create renderer using Mapbox's GL context
        const renderer = new THREE.WebGLRenderer({
          canvas: mapInstance.getCanvas(),
          context: gl,
          antialias: true,
        });

        renderer.autoClear = false;
        renderer.shadowMap.enabled = false;
        renderer.sortObjects = false;
        if ('outputColorSpace' in renderer) {
          renderer.outputColorSpace = THREE.SRGBColorSpace;
        }
        renderer.toneMapping = THREE.LinearToneMapping;
        renderer.toneMappingExposure = 1.0;
        rendererRef.current = renderer;

        // Add environment lighting
        const pmremGenerator = new THREE.PMREMGenerator(renderer);
        pmremGenerator.compileEquirectangularShader();
        const neutralEnvironment = new RoomEnvironment();
        const envRenderTarget = pmremGenerator.fromScene(neutralEnvironment, 0.04);
        neutralEnvironment.dispose();
        environmentRTRef.current = envRenderTarget; // Store for cleanup
        scene.environment = envRenderTarget.texture;
        scene.background = null;
        pmremGenerator.dispose();

        // Add lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
        scene.add(ambientLight);

        const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
        keyLight.position.set(160, 200, 260);
        scene.add(keyLight);

        const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
        fillLight.position.set(-120, -80, 180);
        scene.add(fillLight);

        // Initialize mesh manager
        // Vehicle sizes in meters (visual scale, not actual vehicle length)
        const vehicleSizes: Record<TransportType, number> = {
          metro: 10,
          fgc: 10,
          tram: 10,
          bus: 8,
          rodalies: 25, // Not used here but needed for type completeness
        };
        // Model types for each network
        const modelTypes: Record<TransportType, 'metro' | 'bus' | 'tram' | 'civia'> = {
          metro: 'metro',
          fgc: 'metro', // FGC uses metro model (similar trains)
          tram: 'tram',
          bus: 'bus',
          rodalies: 'civia', // Not used here
        };
        const baseSize = vehicleSizes[networkType] ?? 15;
        const meshManager = new TransitMeshManager(scene, {
          vehicleSizeMeters: baseSize,
          modelType: modelTypes[networkType] ?? 'metro',
        });
        meshManagerRef.current = meshManager;

        // Load model
        meshManager
          .loadModel()
          .then(() => {
            // Only update state if this is still the current generation
            // Prevents StrictMode race where disposed meshManager's promise updates state
            if (currentGeneration === meshManagerGenerationRef.current) {
              setModelLoaded(true);
              console.log(`TransitVehicleLayer3D [${networkType}]: Model loaded`);
            } else {
              console.log(
                `TransitVehicleLayer3D [${networkType}]: Model loaded but generation changed, ignoring`
              );
            }
          })
          .catch((err) => {
            console.error(
              `TransitVehicleLayer3D [${networkType}]: Failed to load model:`,
              err
            );
          });

        setSceneReady(true);
        console.log(`TransitVehicleLayer3D [${networkType}]: Scene initialized`);
      },

      render(_gl: WebGLRenderingContext, matrix: number[]) {
        // Skip rendering entirely when layer is not visible
        // This prevents unnecessary WebGL state resets and render calls
        if (!visibleRef.current) {
          return;
        }

        if (!sceneRef.current || !cameraRef.current || !rendererRef.current) {
          return;
        }

        const modelOrigin = getModelOrigin();
        if (!modelOrigin) return;

        // Update zoom for scale calculations
        if (meshManagerRef.current) {
          meshManagerRef.current.setZoom(map.getZoom());
          meshManagerRef.current.animatePositions();
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
        cameraRef.current.projectionMatrix.copy(matrices.resultMatrix);
        cameraRef.current.projectionMatrixInverse
          .copy(cameraRef.current.projectionMatrix)
          .invert();
        cameraRef.current.matrixWorld.identity();
        cameraRef.current.matrixWorldInverse.identity();
        // Snapshot the inverse for raycast use between frames
        projMatrixInverseRef.current.copy(matrices.resultMatrix).invert();

        // Render
        rendererRef.current.resetState();
        rendererRef.current.render(sceneRef.current, cameraRef.current);

        // Continuous repaint loop for smooth animation
        // This ensures vehicles animate smoothly based on elapsed time
        // Only trigger when visible and has meshes to avoid unnecessary GPU work
        const meshCount = meshManagerRef.current?.getMeshCount() ?? 0;
        if (visibleRef.current && meshCount > 0) {
          map.triggerRepaint();
        }
      },

      onRemove() {
        if (meshManagerRef.current) {
          meshManagerRef.current.dispose();
          meshManagerRef.current = null;
        }
        if (environmentRTRef.current) {
          environmentRTRef.current.dispose();
          environmentRTRef.current = null;
        }
        sceneRef.current = null;
        cameraRef.current = null;
        rendererRef.current = null;
        setSceneReady(false);
        setModelLoaded(false);
        console.log(`TransitVehicleLayer3D [${networkType}]: Layer removed`);
      },
    }),
    [layerId, map, networkType]
  );

  /**
   * Add/remove layer from map
   */
  useEffect(() => {
    if (!map || !styleReady || layerAddedRef.current) return;

    // Add the custom layer
    map.addLayer(customLayer, beforeId);
    layerAddedRef.current = true;
    console.log(`TransitVehicleLayer3D [${networkType}]: Layer added to map`);

    return () => {
      if (layerAddedRef.current && map.getLayer(layerId)) {
        map.removeLayer(layerId);
        layerAddedRef.current = false;
        console.log(`TransitVehicleLayer3D [${networkType}]: Layer removed from map`);
      }
    };
  }, [map, styleReady, customLayer, beforeId, layerId, networkType]);

  /**
   * Update meshes when positions change
   */
  useEffect(() => {
    if (!sceneReady || !modelLoaded || !isDataReady || !meshManagerRef.current) {
      return;
    }

    // Safety check: ensure meshManager's internal model state matches React state
    // This can desync if model loading promise resolves for a previous meshManager
    // (e.g., in StrictMode double-mount scenarios)
    if (!meshManagerRef.current.isModelLoaded()) {
      // Reset modelLoaded to false - the correct meshManager's promise
      // will set it to true when it actually finishes loading
      setModelLoaded(false);
      return;
    }

    meshManagerRef.current.updateVehicles(positions);

    // Apply vehicle opacities based on line selection (highlight/isolate mode)
    if (vehicleOpacities) {
      meshManagerRef.current.setVehicleOpacities(vehicleOpacities);
    } else {
      meshManagerRef.current.setOpacity(1.0);
    }

    // Store positions for click lookup
    positionsMapRef.current = new Map(positions.map(p => [p.vehicleKey, p]));

    // Trigger map repaint
    map.triggerRepaint();
  }, [positions, sceneReady, modelLoaded, isDataReady, map, networkType, vehicleOpacities]);

  /**
   * Clean up hover state when hovered vehicle is no longer present
   */
  useEffect(() => {
    const meshManager = meshManagerRef.current;
    if (!meshManager) {
      return;
    }
    const hoveredKey = hoveredVehicleRef.current;
    if (!hoveredKey) {
      return;
    }
    const stillPresent = positions.some((v) => v.vehicleKey === hoveredKey);
    if (!stillPresent) {
      hoveredVehicleRef.current = null;
      meshManager.setHighlightedVehicle(undefined);
    }
  }, [positions]);

  /**
   * Handle visibility changes
   */
  useEffect(() => {
    if (!meshManagerRef.current) return;

    meshManagerRef.current.setOpacity(visible ? 1.0 : 0.0);
    map.triggerRepaint();
  }, [visible, map]);

  /**
   * Apply model scale dynamically without tearing down the layer
   */
  useEffect(() => {
    if (!meshManagerRef.current) return;
    meshManagerRef.current.setUserScale(modelScale);
    map.triggerRepaint();
  }, [modelScale, map, sceneReady]);

  /**
   * Trigger repaint on zoom change
   */
  useEffect(() => {
    const handleZoom = () => {
      map.triggerRepaint();
    };

    map.on('zoom', handleZoom);
    return () => {
      map.off('zoom', handleZoom);
    };
  }, [map]);

  /**
   * Resolve screen-space hit from click position using Oriented Bounding Rectangle (OBR).
   *
   * Uses point-in-rotated-rectangle test for accurate hit detection on elongated vehicles.
   * The OBR is aligned with the vehicle's direction of travel for precise clicking.
   */
  const resolveScreenHit = useCallback(
    (point: { x: number; y: number }, paddingPx: number) => {
      const meshManager = meshManagerRef.current;
      if (!meshManager) {
        return null;
      }

      const candidates = meshManager.getScreenCandidates(map);
      let nearest: {
        vehicleKey: string;
        lineCode: string;
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
          // This allows selecting the vehicle closest to cursor when overlapping
          const normalizedDistance = Math.sqrt(
            (localX / halfLength) ** 2 + (localY / halfWidth) ** 2
          );

          if (!nearest || normalizedDistance < nearest.distance) {
            nearest = {
              vehicleKey: candidate.vehicleKey,
              lineCode: candidate.lineCode,
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

  /**
   * Handle hover on vehicle (show outline + scale up)
   */
  const handlePointerMove = useCallback(
    (event: MouseEvent) => {
      if (!visible) return;

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
        const hit = resolveScreenHit(point, 4);
        vehicleKey = hit?.vehicleKey ?? null;
      }

      if (hoveredVehicleRef.current !== vehicleKey) {
        // Hide outline from previous hovered vehicle
        if (hoveredVehicleRef.current) {
          meshManagerRef.current?.hideOutline(hoveredVehicleRef.current);
        }

        hoveredVehicleRef.current = vehicleKey;
        meshManagerRef.current?.setHighlightedVehicle(vehicleKey ?? undefined);

        // Show outline for newly hovered vehicle
        if (vehicleKey) {
          meshManagerRef.current?.showOutline(vehicleKey);
        }

        // Update cursor
        canvas.style.cursor = vehicleKey ? 'pointer' : '';

        // Trigger repaint to show outline
        map.triggerRepaint();
      }
    },
    [map, visible, resolveScreenHit, resolveRaycastHit, hitDetectionMode]
  );

  /**
   * Handle pointer leaving canvas (clear hover state)
   */
  const handlePointerLeave = useCallback(() => {
    // Hide outline when leaving canvas
    if (hoveredVehicleRef.current) {
      meshManagerRef.current?.hideOutline(hoveredVehicleRef.current);
    }

    hoveredVehicleRef.current = null;
    meshManagerRef.current?.setHighlightedVehicle(undefined);

    // Reset cursor
    map.getCanvas().style.cursor = '';
    map.triggerRepaint();
  }, [map]);

  // Click handling is now done via VehicleClickCoordinator (see registration effect below)

  /**
   * Attach pointer event listeners (hover only; click is handled by coordinator)
   */
  useEffect(() => {
    if (!map || !sceneReady) return;

    const canvas = map.getCanvas();
    canvas.addEventListener('mousemove', handlePointerMove);
    canvas.addEventListener('mouseleave', handlePointerLeave);

    return () => {
      canvas.removeEventListener('mousemove', handlePointerMove);
      canvas.removeEventListener('mouseleave', handlePointerLeave);
    };
  }, [map, sceneReady, handlePointerMove, handlePointerLeave]);

  /**
   * Register with VehicleClickCoordinator for coordinated click handling
   */
  useEffect(() => {
    if (!clickCoordinator) return;

    clickCoordinator.register(
      networkType,
      (point, paddingPx) => {
        if (hitDetectionMode === 'raycast') {
          const hit = resolveRaycastHit(point);
          if (!hit) return null;
          return {
            vehicleKey: hit.vehicleKey,
            distance: hit.distance,
            metadata: { lineCode: hit.lineCode, networkType },
          };
        }
        const hit = resolveScreenHit(point, paddingPx);
        if (!hit) return null;
        return {
          vehicleKey: hit.vehicleKey,
          distance: hit.distance,
          metadata: { lineCode: hit.lineCode, networkType },
        };
      },
      (hit) => {
        const vehicleData = positionsMapRef.current.get(hit.vehicleKey);
        if (vehicleData) {
          selectVehicle(vehicleData);
          setActivePanel('transitInfo');
        }
      },
      visible,
    );

    return () => {
      clickCoordinator.unregister(networkType);
    };
  }, [clickCoordinator, networkType, resolveScreenHit, resolveRaycastHit, hitDetectionMode, visible, selectVehicle, setActivePanel]);

  /**
   * Sync visibility with coordinator
   */
  useEffect(() => {
    if (clickCoordinator) {
      clickCoordinator.setLayerVisible(networkType, visible);
    }
  }, [clickCoordinator, networkType, visible]);

  /**
   * Notify parent when mesh position getter is ready
   * Allows external components (like VehicleListView) to look up actual mesh positions
   */
  useEffect(() => {
    if (modelLoaded && meshManagerRef.current && onMeshPositionGetterReady) {
      onMeshPositionGetterReady((vehicleKey: string) => {
        return meshManagerRef.current?.getVehiclePosition(vehicleKey) ?? null;
      });
    }
  }, [modelLoaded, onMeshPositionGetterReady]);

  // This component renders nothing - all rendering is done via Mapbox custom layer
  return null;
}
