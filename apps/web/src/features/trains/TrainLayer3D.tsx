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
 * - Click detection via raycasting
 * - Optimized for 100+ concurrent trains at 60fps
 *
 * Implementation: Phase C (User Story 1 Enhanced)
 * Related tasks: T043, T044, T045
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment';
import type { TrainPosition } from '../../types/trains';
import type { Station } from '../../types/rodalies';
import { fetchTrainPositions } from '../../lib/api/trains';
import { preloadAllTrainModels } from '../../lib/trains/modelLoader';
import { TrainMeshManager } from '../../lib/trains/trainMeshManager';
import { loadStations, loadLineGeometryCollection } from '../../lib/rodalies/dataLoader';
import { getModelOrigin } from '../../lib/map/coordinates';
import { preprocessRailwayLine, type PreprocessedRailwayLine } from '../../lib/trains/geometry';

export interface TrainLayer3DProps {
  /**
   * Mapbox GL Map instance to render 3D models on
   * Must be initialized and loaded before passing to this component
   */
  map: mapboxgl.Map;

  /**
   * Layer ID to insert train layer before (z-index control)
   * If not provided, trains will render on top of all layers
   *
   * Example: 'line-pattern-layer' to render trains above lines
   */
  beforeId?: string;
}

/**
 * Polling interval in milliseconds (30 seconds)
 * Matches acceptance criteria for US1
 */
const POLLING_INTERVAL_MS = 30000;

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
export function TrainLayer3D({ map, beforeId }: TrainLayer3DProps) {
  const [trains, setTrains] = useState<TrainPosition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [stationsLoaded, setStationsLoaded] = useState(false);
  const [railwaysLoaded, setRailwaysLoaded] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);

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

  // Reference for Three.js Raycaster for click detection (T049)
  const raycasterRef = useRef<THREE.Raycaster | null>(null);

  // Store polling interval reference for cleanup
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Track if layer has been added to map
  const layerAddedRef = useRef(false);

  /**
   * Fetches latest train positions from the API
   * Updates state and handles errors
   */
  const fetchTrains = async () => {
    try {
      setIsLoading(true);
      const response = await fetchTrainPositions();

      // Filter out trains without valid GPS coordinates
      const validTrains = response.positions.filter(
        (train) => train.latitude !== null && train.longitude !== null
      );

      setTrains(validTrains);
      setError(null);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to fetch train positions';
      setError(errorMessage);
      console.error('Error fetching train positions:', err);
    } finally {
      setIsLoading(false);
    }
  };

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

  /**
   * Handle click events on the map canvas to detect train model clicks
   *
   * Task: T049
   *
   * Uses Three.js raycasting to detect clicks on 3D train models.
   * Converts mouse coordinates to normalized device coordinates and
   * casts a ray to check for intersections with train meshes.
   *
   * @param event - Mouse click event
   */
  const handleCanvasClick = useCallback((event: MouseEvent) => {
    if (!cameraRef.current || !raycasterRef.current || !meshManagerRef.current) {
      return;
    }

    // Get canvas element and its bounding rectangle
    const canvas = map.getCanvas();
    const rect = canvas.getBoundingClientRect();

    // Calculate mouse position relative to canvas
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Convert to normalized device coordinates (NDC) [-1, 1]
    const mouse = new THREE.Vector2(
      (x / rect.width) * 2 - 1,
      -(y / rect.height) * 2 + 1  // Invert Y axis for Three.js
    );

    // Update raycaster with camera and mouse position
    raycasterRef.current.setFromCamera(mouse, cameraRef.current);

    // Get all train meshes from the manager
    const trainMeshes = meshManagerRef.current.getAllMeshes();
    const meshObjects = trainMeshes.map((meshData) => meshData.mesh);

    // Check for intersections
    const intersects = raycasterRef.current.intersectObjects(meshObjects, true);

    if (intersects.length > 0) {
      // Get the first intersected object
      const intersectedObject = intersects[0].object;

      // Traverse up to find the parent Group with userData
      let current = intersectedObject;
      while (current) {
        if (current.userData && current.userData.isTrain) {
          const vehicleKey = current.userData.vehicleKey;
          const routeId = current.userData.routeId;

          console.log(`Train clicked: ${vehicleKey} (Route: ${routeId})`);

          // TODO: In US2, this will call selectTrain() action to open info panel
          break;
        }
        current = current.parent as THREE.Object3D;
      }
    }
  }, [map]);

  /**
   * Mapbox Custom Layer Interface Implementation
   * Task: T044
   *
   * This object implements the CustomLayerInterface required by Mapbox GL JS
   * Reference: https://docs.mapbox.com/mapbox-gl-js/api/properties/#customlayerinterface
   */
  const customLayer: mapboxgl.CustomLayerInterface = {
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
      // Mapbox provides combined projection * view matrix, so we use THREE.Camera
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
      renderer.autoClear = false; // Don't clear Mapbox's render
      renderer.shadowMap.enabled = false; // Shadows disabled for performance
      if ('outputColorSpace' in renderer) {
        renderer.outputColorSpace = THREE.SRGBColorSpace;
      } else {
        // @ts-expect-error outputEncoding exists on older builds
        renderer.outputEncoding = THREE.sRGBEncoding;
      }
      renderer.toneMapping = THREE.LinearToneMapping;
      renderer.toneMappingExposure = 1.0;
      renderer.physicallyCorrectLights = true;
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

      // T049: Initialize Raycaster for click detection
      raycasterRef.current = new THREE.Raycaster();
      console.log('TrainLayer3D: Raycaster initialized for click detection');

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
     */
    render(_gl: WebGLRenderingContext, matrix: Array<number>) {
      if (!sceneRef.current || !cameraRef.current || !rendererRef.current) {
        return;
      }

      const modelOrigin = getModelOrigin();
      if (!modelOrigin) {
        // Model origin must be set during map load
        return;
      }

      // T048: Animate train positions with smooth interpolation
      if (meshManagerRef.current) {
        meshManagerRef.current.animatePositions();
      }

      // Synchronize Three.js camera with Mapbox camera
      // Mapbox matrix converts Mercator coordinates to clip space.
      // We inject translation for our modelOrigin and flip Y-axis to match Three.js.
      const camera = cameraRef.current;
      const mapboxMatrix = new THREE.Matrix4().fromArray(matrix);
      const transform = new THREE.Matrix4()
        .makeTranslation(modelOrigin.x, modelOrigin.y, modelOrigin.z ?? 0)
        .scale(new THREE.Vector3(1, -1, 1));

      const projectionMatrix = mapboxMatrix.clone().multiply(transform);
      camera.projectionMatrix.copy(projectionMatrix);
      if ('projectionMatrixInverse' in camera) {
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      }
      camera.matrixWorld.identity();
      camera.matrixWorldInverse.identity();

      // Render the Three.js scene
      const renderer = rendererRef.current;
      renderer.resetState();
      renderer.render(sceneRef.current, camera);

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
  };

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

    // Cleanup: clear interval on unmount
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
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
  }, [map, beforeId]);

  /**
   * Effect: Create mesh manager when stations and scene are ready
   * Task: T047 - Initialize manager with station data
   */
  useEffect(() => {
    if (
      !stationsLoaded ||
      !railwaysLoaded ||
      !sceneReady ||
      !sceneRef.current ||
      meshManagerRef.current
    ) {
      console.log('TrainLayer3D: Waiting to create mesh manager', {
        stationsLoaded,
        railwaysLoaded,
        sceneReady,
        hasScene: !!sceneRef.current,
        hasManager: !!meshManagerRef.current,
      });
      return;
    }

    meshManagerRef.current = new TrainMeshManager(
      sceneRef.current,
      stationsRef.current,
      railwaysRef.current
    );
    console.log(
      `TrainLayer3D: Mesh manager initialized with ${stationsRef.current.length} stations and ${railwaysRef.current.size} railway lines`
    );
  }, [stationsLoaded, railwaysLoaded, sceneReady]);

  /**
   * Effect: Update train meshes when train data or models change
   * Tasks: T046 - Create and update train mesh instances
   *        T047 - Apply bearing-based rotation
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

    // Update train meshes based on current train positions
    // This will apply bearing-based rotation automatically (T047)
    meshManagerRef.current.updateTrainMeshes(trains);

    if (trains.length > 0) {
      console.log(
        `TrainLayer3D: ${meshManagerRef.current.getMeshCount()} train meshes active with rotation`
      );
    }
  }, [trains, modelsLoaded, stationsLoaded]);

  /**
   * Effect: Attach click event listener for raycasting
   * Task: T049
   */
  useEffect(() => {
    // Only attach listener when raycaster is initialized
    if (!raycasterRef.current) {
      return;
    }

    const canvas = map.getCanvas();

    // Attach click event listener
    canvas.addEventListener('click', handleCanvasClick);
    console.log('TrainLayer3D: Click event listener attached for raycasting');

    // Cleanup: remove event listener on unmount
    return () => {
      canvas.removeEventListener('click', handleCanvasClick);
      console.log('TrainLayer3D: Click event listener removed');
    };
  }, [map, handleCanvasClick]);

  // Log error state
  if (error && !isLoading && trains.length === 0) {
    console.warn('TrainLayer3D error:', error);
  }

  // This component doesn't render any JSX - it only manages the 3D layer
  return null;
}
