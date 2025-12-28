/**
 * TransitVehicleLayer3D Component
 *
 * Renders 3D transit vehicle models (Metro, Bus) on the Mapbox map using Three.js.
 * Uses schedule-based position simulation for Metro and (future) iBus API for Bus.
 *
 * Based on TrainLayer3D patterns but simplified for schedule-based positioning.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MapboxMap, CustomLayerInterface } from 'mapbox-gl';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { TransportType } from '../../types/rodalies';
import { TransitMeshManager } from '../../lib/transit/transitMeshManager';
import { getModelOrigin, setModelOrigin } from '../../lib/map/coordinates';
import { useMetroPositions } from './hooks/useMetroPositions';
import { useMapStyleReady } from '../../hooks/useMapStyleReady';

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
}: TransitVehicleLayer3DProps) {
  const [sceneReady, setSceneReady] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const styleReady = useMapStyleReady(map);

  // Three.js references
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const meshManagerRef = useRef<TransitMeshManager | null>(null);
  const layerAddedRef = useRef(false);

  // Layer ID based on network type
  const layerId = `transit-${networkType}-layer-3d`;

  // Get positions based on network type
  const {
    positions: metroPositions,
    isReady: metroReady,
    isLoading: metroLoading,
  } = useMetroPositions({
    enabled: networkType === 'metro' && visible,
  });

  // Use appropriate positions based on network type
  // Wrap in useMemo to avoid changing dependency on every render
  const positions = useMemo(() => {
    return networkType === 'metro' ? metroPositions : [];
  }, [networkType, metroPositions]);

  const isDataReady = networkType === 'metro' ? metroReady : false;
  const isDataLoading = networkType === 'metro' ? metroLoading : false;

  // Notify parent of loading state
  useEffect(() => {
    onLoadingChange?.(isDataLoading || !modelLoaded);
  }, [isDataLoading, modelLoaded, onLoadingChange]);

  /**
   * Mapbox Custom Layer Implementation
   */
  const customLayer = useMemo<CustomLayerInterface>(
    () => ({
      id: layerId,
      type: 'custom',
      renderingMode: '3d',

      onAdd(mapInstance: mapboxgl.Map, gl: WebGLRenderingContext) {
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
        const meshManager = new TransitMeshManager(scene, {
          vehicleSizeMeters: networkType === 'metro' ? 25 : 12, // Buses smaller
          modelType: 'civia', // Use Civia as placeholder for all
        });
        meshManagerRef.current = meshManager;

        // Load model
        meshManager
          .loadModel()
          .then(() => {
            setModelLoaded(true);
            console.log(`TransitVehicleLayer3D [${networkType}]: Model loaded`);
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

        // Sync camera with Mapbox
        const mapboxMatrix = new THREE.Matrix4().fromArray(matrix);
        const modelTransform = new THREE.Matrix4()
          .makeTranslation(modelOrigin.x, modelOrigin.y, modelOrigin.z ?? 0)
          .scale(new THREE.Vector3(1, -1, 1));

        cameraRef.current.projectionMatrix.copy(
          mapboxMatrix.clone().multiply(modelTransform)
        );

        // Render
        rendererRef.current.resetState();
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      },

      onRemove() {
        if (meshManagerRef.current) {
          meshManagerRef.current.dispose();
          meshManagerRef.current = null;
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
      // Log why we're not updating
      if (positions.length > 0) {
        console.log(`TransitVehicleLayer3D [${networkType}]: Waiting for conditions`, {
          sceneReady,
          modelLoaded,
          isDataReady,
          hasMeshManager: !!meshManagerRef.current,
          positionCount: positions.length,
        });
      }
      return;
    }

    console.log(`TransitVehicleLayer3D [${networkType}]: Updating ${positions.length} vehicles`);
    meshManagerRef.current.updateVehicles(positions);

    // Trigger map repaint
    map.triggerRepaint();
  }, [positions, sceneReady, modelLoaded, isDataReady, map, networkType]);

  /**
   * Handle visibility changes
   */
  useEffect(() => {
    if (!meshManagerRef.current) return;

    meshManagerRef.current.setOpacity(visible ? 1.0 : 0.0);
    map.triggerRepaint();
  }, [visible, map]);

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

  // This component renders nothing - all rendering is done via Mapbox custom layer
  return null;
}
