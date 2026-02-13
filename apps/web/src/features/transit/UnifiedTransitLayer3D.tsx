/**
 * UnifiedTransitLayer3D
 *
 * Unified 3D layer for all transit vehicles (Rodalies, Metro, Bus, Tram, FGC).
 * Consolidates 5 separate custom layers into one for better performance:
 * - Single Three.js scene, camera, renderer
 * - Single render loop
 * - Single triggerRepaint per frame
 * - Shared lighting and environment
 *
 * Performance improvements:
 * - Eliminates 4 redundant renderer.resetState() calls per frame
 * - Eliminates cascading triggerRepaint() calls
 * - Single environment map generation
 */

import { useEffect, useMemo, useRef, useCallback } from 'react';
import * as THREE from 'three';
import type { Map as MapboxMap, CustomLayerInterface } from 'mapbox-gl';
import type { TrainPosition } from '@/types/trains';
import type { VehiclePosition, TransportType } from '@/types/transit';
import { TrainMeshManager } from '@/lib/trains/trainMeshManager';
import { TransitMeshManager } from '@/lib/transit/transitMeshManager';
import { preloadAllTrainModels, loadTrainModel } from '@/lib/trains/modelLoader';
import { loadStationList, loadRodaliesLines, loadLineGeometryCollection } from '@/lib/rodalies/dataLoader';
import type { LineGeometryCollection } from '@/types/rodalies';
import { preprocessRailwayLine, type PreprocessedRailwayLine } from '@/lib/trains/geometry';
import { setModelOrigin, getModelOrigin } from '@/lib/map/coordinates';
import { buildLineColorMap } from '@/lib/trains/outlineManager';
import { useMapNetwork } from '@/state/map';
import { useTransitActions } from '@/state/transit';

interface UnifiedTransitLayer3DProps {
  map: MapboxMap | null;
  // Rodalies data
  rodaliesTrains?: TrainPosition[];
  previousRodaliesPositions?: Map<string, TrainPosition>;
  rodaliesPollMetadata?: {
    currentPolledAtMs?: number;
    previousPolledAtMs?: number;
    receivedAtMs?: number;
  };
  // Transit data by network
  metroPositions?: VehiclePosition[];
  busPositions?: VehiclePosition[];
  tramPositions?: VehiclePosition[];
  fgcPositions?: VehiclePosition[];
  // Visibility (from transportFilters)
  visibleNetworks?: Set<TransportType>;
}

export function UnifiedTransitLayer3D({
  map,
  rodaliesTrains = [],
  previousRodaliesPositions,
  rodaliesPollMetadata,
  metroPositions = [],
  busPositions = [],
  tramPositions = [],
  fgcPositions = [],
  visibleNetworks = new Set(['rodalies', 'metro', 'bus', 'tram', 'fgc']),
}: UnifiedTransitLayer3DProps) {
  const { modelSizes } = useMapNetwork();
  const { setDataSource } = useTransitActions();

  // Refs for Three.js objects (shared across all networks)
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  // Mesh managers for each network
  const rodaliesMeshManagerRef = useRef<TrainMeshManager | null>(null);
  const metroMeshManagerRef = useRef<TransitMeshManager | null>(null);
  const busMeshManagerRef = useRef<TransitMeshManager | null>(null);
  const tramMeshManagerRef = useRef<TransitMeshManager | null>(null);
  const fgcMeshManagerRef = useRef<TransitMeshManager | null>(null);

  // Loading state
  const modelsLoadedRef = useRef(false);
  const stationsLoadedRef = useRef(false);
  const layerAddedRef = useRef(false);
  const isMountedRef = useRef(true);
  const lineColorMapRef = useRef<Map<string, THREE.Color> | null>(null);

  // Reusable matrix instances for render loop
  const matrixRef = useRef({
    mapboxMatrix: new THREE.Matrix4(),
    modelTransform: new THREE.Matrix4(),
    resultMatrix: new THREE.Matrix4(),
    scaleVector: new THREE.Vector3(1, -1, 1),
  });

  // Visibility refs (updated synchronously)
  const visibleNetworksRef = useRef(visibleNetworks);
  useEffect(() => {
    visibleNetworksRef.current = visibleNetworks;
  }, [visibleNetworks]);

  // Initialize Three.js scene (shared by all networks)
  const initializeScene = useCallback((gl: WebGLRenderingContext) => {
    const scene = new THREE.Scene();
    const camera = new THREE.Camera();

    const renderer = new THREE.WebGLRenderer({
      canvas: map!.getCanvas(),
      context: gl,
      antialias: true,
    });
    renderer.autoClear = false;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    // Create neutral environment for consistent lighting
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const neutralEnvironment = new THREE.Scene();
    neutralEnvironment.background = new THREE.Color(0x808080);
    const envRenderTarget = pmremGenerator.fromScene(neutralEnvironment);
    scene.environment = envRenderTarget.texture;
    pmremGenerator.dispose();

    // Ambient light for soft base illumination
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    // Main directional light (sun)
    const sunLight = new THREE.DirectionalLight(0xffffff, 0.8);
    sunLight.position.set(1, 1, 2);
    scene.add(sunLight);

    // Fill light from below
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(-1, -0.5, 1);
    scene.add(fillLight);

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;

    return { scene, camera, renderer };
  }, [map]);

  // Load models and stations
  useEffect(() => {
    if (!map) return;

    const loadResources = async () => {
      try {
        // Load all train models in parallel
        await Promise.all([
          preloadAllTrainModels(),
          loadTrainModel('metro'),
          loadTrainModel('bus'),
          loadTrainModel('tram'),
        ]);
        if (isMountedRef.current) {
          modelsLoadedRef.current = true;
        }

        // Load stations and railway lines for Rodalies
        const [stations, lines] = await Promise.all([
          loadStationList(),
          loadRodaliesLines(),
        ]);

        if (!isMountedRef.current) return;

        stationsLoadedRef.current = true;

        // Build line color map for hover outlines
        lineColorMapRef.current = buildLineColorMap(lines, 'CCCCCC');

        // Load and preprocess railway lines
        const geometryCollection = await loadLineGeometryCollection();
        const railwayLines = new Map<string, PreprocessedRailwayLine>();
        geometryCollection.features.forEach((feature: LineGeometryCollection['features'][number]) => {
          const shortCode = feature.properties?.short_code ?? feature.properties?.id;
          if (!shortCode) return;
          const preprocessed = preprocessRailwayLine(feature.geometry);
          if (preprocessed) {
            railwayLines.set(shortCode.toUpperCase(), preprocessed);
          }
        });

        // Initialize Rodalies mesh manager with the shared scene
        if (sceneRef.current) {
          rodaliesMeshManagerRef.current = new TrainMeshManager(
            sceneRef.current,
            stations,
            railwayLines
          );
        }

        console.log('[UnifiedTransitLayer3D] All resources loaded');
      } catch (error) {
        console.error('[UnifiedTransitLayer3D] Failed to load resources:', error);
      }
    };

    loadResources();

    return () => {
      isMountedRef.current = false;
    };
  }, [map]);

  // Create Mapbox custom layer
  const customLayer = useMemo<CustomLayerInterface | null>(() => {
    if (!map) return null;

    return {
      id: 'unified-transit-3d',
      type: 'custom',
      renderingMode: '3d',

      onAdd(_map: MapboxMap, gl: WebGLRenderingContext) {
        // Set model origin at map center
        const center = _map.getCenter();
        setModelOrigin(center);

        // Initialize shared scene
        const { scene } = initializeScene(gl);

        // Initialize transit mesh managers (they share the same scene)
        metroMeshManagerRef.current = new TransitMeshManager(scene, {
          vehicleSizeMeters: 25,
          modelType: 'metro',
        });
        busMeshManagerRef.current = new TransitMeshManager(scene, {
          vehicleSizeMeters: 12,
          modelType: 'bus',
        });
        tramMeshManagerRef.current = new TransitMeshManager(scene, {
          vehicleSizeMeters: 30,
          modelType: 'tram',
        });
        fgcMeshManagerRef.current = new TransitMeshManager(scene, {
          vehicleSizeMeters: 25,
          modelType: 'metro',
        });

        // Load transit models
        Promise.all([
          metroMeshManagerRef.current.loadModel(),
          busMeshManagerRef.current.loadModel(),
          tramMeshManagerRef.current.loadModel(),
          fgcMeshManagerRef.current.loadModel(),
        ]).then(() => {
          console.log('[UnifiedTransitLayer3D] Transit models loaded');
        });

        layerAddedRef.current = true;
      },

      render(_gl: WebGLRenderingContext, matrix: number[]) {
        if (!sceneRef.current || !cameraRef.current || !rendererRef.current) {
          return;
        }

        const modelOrigin = getModelOrigin();
        if (!modelOrigin) return;

        const currentZoom = map.getZoom();

        // Update zoom for all mesh managers
        if (rodaliesMeshManagerRef.current) {
          rodaliesMeshManagerRef.current.setCurrentZoom(currentZoom);
        }
        if (metroMeshManagerRef.current) {
          metroMeshManagerRef.current.setZoom(currentZoom);
        }
        if (busMeshManagerRef.current) {
          busMeshManagerRef.current.setZoom(currentZoom);
        }
        if (tramMeshManagerRef.current) {
          tramMeshManagerRef.current.setZoom(currentZoom);
        }
        if (fgcMeshManagerRef.current) {
          fgcMeshManagerRef.current.setZoom(currentZoom);
        }

        // Animate all mesh managers
        if (rodaliesMeshManagerRef.current) {
          rodaliesMeshManagerRef.current.animatePositions();
          rodaliesMeshManagerRef.current.applyParkingVisuals();
        }
        if (metroMeshManagerRef.current) {
          metroMeshManagerRef.current.animatePositions();
        }
        if (busMeshManagerRef.current) {
          busMeshManagerRef.current.animatePositions();
        }
        if (tramMeshManagerRef.current) {
          tramMeshManagerRef.current.animatePositions();
        }
        if (fgcMeshManagerRef.current) {
          fgcMeshManagerRef.current.animatePositions();
        }

        // Reuse matrix instances for performance
        const matrices = matrixRef.current;
        matrices.mapboxMatrix.fromArray(matrix);
        matrices.modelTransform
          .identity()
          .makeTranslation(modelOrigin.x, modelOrigin.y, modelOrigin.z ?? 0)
          .scale(matrices.scaleVector);

        matrices.resultMatrix.copy(matrices.mapboxMatrix).multiply(matrices.modelTransform);
        cameraRef.current.projectionMatrix.copy(matrices.resultMatrix);

        // Single render call for all meshes
        rendererRef.current.resetState();
        rendererRef.current.render(sceneRef.current, cameraRef.current);

        // Single repaint trigger (instead of 5 separate ones)
        const hasVisibleMeshes =
          (visibleNetworksRef.current.has('rodalies') && rodaliesMeshManagerRef.current?.getMeshCount()) ||
          (visibleNetworksRef.current.has('metro') && metroMeshManagerRef.current?.getMeshCount()) ||
          (visibleNetworksRef.current.has('bus') && busMeshManagerRef.current?.getMeshCount()) ||
          (visibleNetworksRef.current.has('tram') && tramMeshManagerRef.current?.getMeshCount()) ||
          (visibleNetworksRef.current.has('fgc') && fgcMeshManagerRef.current?.getMeshCount());

        if (hasVisibleMeshes) {
          map.triggerRepaint();
        }
      },

      onRemove() {
        // Cleanup transit mesh managers
        metroMeshManagerRef.current?.dispose();
        busMeshManagerRef.current?.dispose();
        tramMeshManagerRef.current?.dispose();
        fgcMeshManagerRef.current?.dispose();

        // Note: TrainMeshManager doesn't have dispose - meshes are cleared from scene
        rodaliesMeshManagerRef.current = null;

        sceneRef.current = null;
        cameraRef.current = null;
        rendererRef.current = null;
        layerAddedRef.current = false;
      },
    };
  }, [map, initializeScene]);

  // Add layer to map
  useEffect(() => {
    if (!map || !customLayer || layerAddedRef.current) return;

    const addLayer = () => {
      if (!map.getLayer(customLayer.id)) {
        map.addLayer(customLayer);
      }
    };

    if (map.isStyleLoaded()) {
      addLayer();
    } else {
      map.once('styledata', addLayer);
    }

    return () => {
      if (map.getLayer(customLayer.id)) {
        map.removeLayer(customLayer.id);
      }
    };
  }, [map, customLayer]);

  // Update Rodalies trains
  useEffect(() => {
    if (!rodaliesMeshManagerRef.current || !modelsLoadedRef.current || !stationsLoadedRef.current) {
      return;
    }

    rodaliesMeshManagerRef.current.updateTrainMeshes(
      rodaliesTrains,
      previousRodaliesPositions,
      rodaliesPollMetadata
    );

    // Report data source
    if (rodaliesTrains.length > 0) {
      setDataSource('rodalies', 'realtime');
    }
  }, [rodaliesTrains, previousRodaliesPositions, rodaliesPollMetadata, setDataSource]);

  // Update Metro positions
  useEffect(() => {
    if (!metroMeshManagerRef.current?.isModelLoaded()) return;
    metroMeshManagerRef.current.updateVehicles(metroPositions);
  }, [metroPositions]);

  // Update Bus positions
  useEffect(() => {
    if (!busMeshManagerRef.current?.isModelLoaded()) return;
    busMeshManagerRef.current.updateVehicles(busPositions);
  }, [busPositions]);

  // Update Tram positions
  useEffect(() => {
    if (!tramMeshManagerRef.current?.isModelLoaded()) return;
    tramMeshManagerRef.current.updateVehicles(tramPositions);
  }, [tramPositions]);

  // Update FGC positions
  useEffect(() => {
    if (!fgcMeshManagerRef.current?.isModelLoaded()) return;
    fgcMeshManagerRef.current.updateVehicles(fgcPositions);
  }, [fgcPositions]);

  // Handle visibility changes
  useEffect(() => {
    // Update visibility by setting opacity
    const rodaliesOpacity = visibleNetworks.has('rodalies') ? 1.0 : 0.0;
    const metroOpacity = visibleNetworks.has('metro') ? 1.0 : 0.0;
    const busOpacity = visibleNetworks.has('bus') ? 1.0 : 0.0;
    const tramOpacity = visibleNetworks.has('tram') ? 1.0 : 0.0;
    const fgcOpacity = visibleNetworks.has('fgc') ? 1.0 : 0.0;

    // Apply to Rodalies
    if (rodaliesMeshManagerRef.current) {
      const opacities = new Map<string, number>();
      rodaliesTrains.forEach((train) => {
        opacities.set(train.vehicleKey, rodaliesOpacity);
      });
      if (opacities.size > 0) {
        rodaliesMeshManagerRef.current.setTrainOpacities(opacities);
      }
    }

    // Apply to transit networks
    if (metroMeshManagerRef.current) {
      metroMeshManagerRef.current.setOpacity(metroOpacity);
    }
    if (busMeshManagerRef.current) {
      busMeshManagerRef.current.setOpacity(busOpacity);
    }
    if (tramMeshManagerRef.current) {
      tramMeshManagerRef.current.setOpacity(tramOpacity);
    }
    if (fgcMeshManagerRef.current) {
      fgcMeshManagerRef.current.setOpacity(fgcOpacity);
    }
  }, [visibleNetworks, rodaliesTrains]);

  // Handle user scale changes
  useEffect(() => {
    if (rodaliesMeshManagerRef.current) {
      rodaliesMeshManagerRef.current.setUserScale(modelSizes.rodalies);
    }
  }, [modelSizes]);

  return null;
}
