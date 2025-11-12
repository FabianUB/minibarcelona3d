/**
 * Train mesh manager
 *
 * Manages Three.js mesh instances for train models on the map.
 * Creates, updates, and removes train meshes based on position data.
 *
 * Related tasks: T046, T047, T052g-T052k (Mini Tokyo 3D fixes)
 */

import * as THREE from 'three';
import type { TrainPosition } from '../../types/trains';
import type { Station } from '../../types/rodalies';
import { getCachedModel } from './modelLoader';
import { extractLineFromRouteId, getModelTypeForRoute } from '../../config/trainModels';
import { ScaleManager } from './scaleManager';
import { createOutlineMesh } from './outlineManager';
import {
  calculateBearing,
  interpolatePositionSmooth,
  snapTrainToRailway,
  sampleRailwayPosition,
  type PreprocessedRailwayLine,
  type RailwaySnapResult,
} from './geometry';
import { getModelPosition, getModelScale, getLngLatFromModelPosition } from '../map/coordinates';

/**
 * Metadata stored with each train mesh
 * Allows efficient updates and tracking
 */
interface RailwaySnapState extends RailwaySnapResult {
  lineId: string;
}

/**
 * Configuration for spatial separation of co-located trains
 * Feature 003: Enhanced lateral offset at high zoom levels
 */
interface LateralOffsetConfig {
  buckets: number; // Number of offset positions (default: 5)
  baseStepMeters: number; // Base offset distance in meters (default: 1.6)
  highZoomThreshold: number; // Zoom level threshold for increased offset (default: 14)
  highZoomMultiplier: number; // Offset multiplier at high zoom (default: 1.5)
}

interface TrainMeshData {
  mesh: THREE.Group;
  vehicleKey: string;
  routeId: string;
  currentPosition: [number, number];
  targetPosition: [number, number];
  lastUpdate: number;
  interpolationDuration: number;
  currentSnap?: RailwaySnapState;
  targetSnap?: RailwaySnapState;
  lateralOffsetIndex: number;
  baseScale: number;
  boundingCenterOffset: THREE.Vector3;
  boundingRadius: number;
  hasUnrealisticSpeed: boolean;
  warningIndicator?: THREE.Sprite;
  // Feature 003: Zoom-responsive scaling
  screenSpaceScale: number; // Current zoom-responsive multiplier (0.48-1.6)
  lastZoomBucket: number; // Quantized zoom level for cache invalidation (0.1 increments)
  // Feature 003 Phase 5: Hover outline (lazy-loaded)
  outlineMesh?: THREE.Group; // Created on first hover
  lineCode?: string; // Extracted from routeId
  lineColor?: THREE.Color; // Line brand color
}

interface PollSnapshotMetadata {
  currentPolledAtMs?: number;
  previousPolledAtMs?: number;
  receivedAtMs?: number;
}

export interface ScreenSpaceCandidate {
  vehicleKey: string;
  routeId: string;
  screenPoint: mapboxgl.Point;
  radiusPx: number;
}

/**
 * TrainMeshManager
 *
 * Manages the lifecycle of 3D train model instances on the map.
 * Handles creation, updates, and removal of train meshes.
 *
 * Tasks: T046, T047, T052g-T052k (Mini Tokyo 3D patterns)
 *
 * Features:
 * - Route-based model selection using trainModels config
 * - Mesh cloning from preloaded models for efficiency
 * - Correct coordinate system using MercatorCoordinate + model origin
 * - Realistic scaling based on meters (25m trains)
 * - Z-offset elevation to prevent z-fighting
 * - Pseudo-random scale variation to prevent visual overlap
 * - Bearing-based rotation toward next station (negated for correct orientation)
 * - Automatic cleanup of removed trains
 *
 * Based on Mini Tokyo 3D patterns - see /docs/MINI-TOKYO-3D.md
 */
export class TrainMeshManager {
  private trainMeshes: Map<string, TrainMeshData> = new Map();
  private scene: THREE.Scene;
  private stationMap: Map<string, Station>;
  private railwayLines: Map<string, PreprocessedRailwayLine>;
  private debugCount = 0;
  private readonly DEBUG_LIMIT = 0;
  private readonly debugMeshes: THREE.Object3D[] = [];
  private debugWorldLogsRemaining = 3;
  private readonly MAX_SNAP_DISTANCE_METERS = 200;
  private readonly INTERPOLATION_DURATION_MS = 30000;
  private readonly MIN_INTERPOLATION_DURATION_MS = 1000;
  private readonly MODEL_FORWARD_OFFSET = Math.PI; // Train models face negative X by default
  private readonly LATERAL_OFFSET_BUCKETS = 5;
  private readonly LATERAL_OFFSET_STEP_METERS = 40; // meters between trains laterally

  // Feature 003: Zoom-responsive lateral offset configuration
  private lateralOffsetConfig: LateralOffsetConfig;
  private currentZoom: number = 10; // Default zoom level

  // Feature 003: Zoom-responsive scale manager
  private scaleManager: ScaleManager;

  // Screen-space candidate caching to reduce mousemove overhead
  private screenCandidatesCache: ScreenSpaceCandidate[] | null = null;
  private screenCandidatesCacheZoom: number | null = null;
  private screenCandidatesCacheInvalidated: boolean = true;

  // Maximum realistic train speed: 200 km/h = ~55.6 m/s
  // Rodalies trains typically max out at 140 km/h (~39 m/s)
  // Add 50% buffer for high-speed sections and GPS/timing inaccuracies
  private readonly MAX_TRAIN_SPEED_MS = 55.6 * 1.5; // ~83 m/s or ~300 km/h

  private highlightedVehicleKey: string | null = null;
  /**
   * Deterministic variation per train to reduce visual overlaps
   */
  private getScaleVariation(vehicleKey: string): number {
    const trainIndex = parseInt(vehicleKey.replace(/\D/g, ''), 10) || 0;
    return 1.0 + ((trainIndex % 256) / 256.0) * 0.03;
  }

  /**
   * Train size in meters (typical commuter train length)
   * Used with getModelScale() to calculate proper Three.js scale
   */
  private readonly TRAIN_SIZE_METERS = 25;

  /**
   * Z-offset multiplier for elevation above ground
   * Prevents z-fighting with map surface
   * Based on Mini Tokyo 3D: 0.44 * scale
   */
  private readonly Z_OFFSET_FACTOR = 0.44;

  constructor(
    scene: THREE.Scene,
    stations: Station[],
    railwayLines: Map<string, PreprocessedRailwayLine>,
    lateralOffsetConfig?: LateralOffsetConfig
  ) {
    this.scene = scene;

    // Create station lookup map for O(1) access by ID
    this.stationMap = new Map();
    for (const station of stations) {
      this.stationMap.set(station.id, station);
    }

    this.railwayLines = railwayLines;

    // Feature 003: Initialize lateral offset configuration
    this.lateralOffsetConfig = lateralOffsetConfig ?? {
      buckets: this.LATERAL_OFFSET_BUCKETS,
      baseStepMeters: this.LATERAL_OFFSET_STEP_METERS,
      highZoomThreshold: 14,
      highZoomMultiplier: 1.5,
    };

    // Feature 003: Initialize scale manager
    this.scaleManager = new ScaleManager();

    console.log(`TrainMeshManager: Loaded ${this.stationMap.size} stations for bearing calculations`);
  }

  /**
   * Update current zoom level for zoom-responsive lateral offset
   * Feature 003: Called from render loop to track map zoom changes
   */
  public setCurrentZoom(zoom: number): void {
    this.currentZoom = zoom;
  }

  /**
   * Get scale manager instance for zoom-responsive sizing
   * Feature 003: Used by render loop to compute scale multipliers
   */
  public getScaleManager(): ScaleManager {
    return this.scaleManager;
  }

  private snapPositionToRailway(train: TrainPosition): RailwaySnapState | null {
    if (train.latitude === null || train.longitude === null) {
      return null;
    }

    const lineId = extractLineFromRouteId(train.routeId);
    if (!lineId) {
      return null;
    }

    const railway = this.railwayLines.get(lineId.toUpperCase());
    if (!railway) {
      return null;
    }

    const result = snapTrainToRailway(
      [train.longitude, train.latitude],
      railway,
      this.MAX_SNAP_DISTANCE_METERS
    );

    if (!result) {
      return null;
    }

    return {
      lineId: lineId.toUpperCase(),
      ...result,
    };
  }

  /**
   * Validate position update by checking railway distance and speed
   * Logs warning for unrealistic jumps but allows the update
   *
   * Returns true if speed is unrealistic (should show warning indicator)
   */
  private validatePositionUpdate(
    vehicleKey: string,
    previousSnap: RailwaySnapState | null,
    currentSnap: RailwaySnapState | null,
    timeDeltaMs: number
  ): boolean {
    // If we can't snap either position to railway, we can't validate
    if (!previousSnap || !currentSnap) {
      return false;
    }

    // If train changed lines, we can't validate distance along the railway
    // This is expected at transfer points
    if (previousSnap.lineId !== currentSnap.lineId) {
      return false;
    }

    // Calculate distance traveled along the railway
    const distanceTraveled = Math.abs(currentSnap.distance - previousSnap.distance);

    // Calculate time elapsed in seconds
    const timeDeltaS = timeDeltaMs / 1000;

    // Avoid division by zero
    if (timeDeltaS <= 0) {
      return false;
    }

    // Calculate speed in m/s
    const speedMS = distanceTraveled / timeDeltaS;

    // Check if speed exceeds maximum realistic train speed
    if (speedMS > this.MAX_TRAIN_SPEED_MS) {
      console.warn(
        `TrainMeshManager: Unrealistic speed detected for train ${vehicleKey}`,
        {
          lineId: currentSnap.lineId,
          distanceTraveled: `${distanceTraveled.toFixed(0)}m`,
          timeDelta: `${timeDeltaS.toFixed(1)}s`,
          calculatedSpeed: `${speedMS.toFixed(1)} m/s (${(speedMS * 3.6).toFixed(0)} km/h)`,
          maxAllowed: `${this.MAX_TRAIN_SPEED_MS.toFixed(1)} m/s (${(this.MAX_TRAIN_SPEED_MS * 3.6).toFixed(0)} km/h)`,
        }
      );
      return true;
    }

    return false;
  }

  /**
   * Create a warning indicator sprite (exclamation mark) for trains with unrealistic speeds
   */
  private createWarningIndicator(): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d')!;

    // Draw red circle background
    context.fillStyle = '#ff4444';
    context.beginPath();
    context.arc(32, 32, 28, 0, Math.PI * 2);
    context.fill();

    // Draw white exclamation mark
    context.fillStyle = '#ffffff';
    context.font = 'bold 48px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('!', 32, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false });
    const sprite = new THREE.Sprite(material);

    const modelScale = getModelScale();
    const spriteSize = 8 * modelScale; // 8 meters
    sprite.scale.set(spriteSize, spriteSize, 1);

    return sprite;
  }

  private applyRailwayBearing(
    mesh: THREE.Group,
    bearingDegrees: number,
    isReversed = false
  ): void {
    const bearingRad = (-bearingDegrees * Math.PI) / 180;
    const rotation = bearingRad + this.MODEL_FORWARD_OFFSET + (isReversed ? Math.PI : 0);
    mesh.rotation.z = rotation;
  }

  private getLateralOffsetIndex(vehicleKey: string): number {
    let hash = 0;
    for (let i = 0; i < vehicleKey.length; i += 1) {
      hash = (hash * 31 + vehicleKey.charCodeAt(i)) | 0;
    }
    const bucket = Math.abs(hash) % this.LATERAL_OFFSET_BUCKETS;
    const half = Math.floor(this.LATERAL_OFFSET_BUCKETS / 2);
    return bucket - half;
  }

  private computeLateralOffset(offsetIndex: number): number {
    const offsetMultiplier = offsetIndex;
    const zoomFactor = this.currentZoom > this.lateralOffsetConfig.highZoomThreshold
      ? this.lateralOffsetConfig.highZoomMultiplier
      : 1.0;
    return this.lateralOffsetConfig.baseStepMeters * offsetMultiplier * zoomFactor;
  }

  private applyLateralOffset(
    position: { x: number; y: number },
    bearingInfo: { bearing: number; reversed: boolean } | null,
    offsetIndex: number
  ): void {
    // DISABLED: Lateral offset temporarily disabled for calibration
    // Need to verify train scale at different zoom levels before calculating proper offsets
    return;

    // if (!offsetIndex || !bearingInfo) {
    //   return;
    // }

    // const adjustedBearing = (bearingInfo.bearing + (bearingInfo.reversed ? 180 : 0) + 360) % 360;
    // const bearingRad = (adjustedBearing * Math.PI) / 180;

    // const offsetMeters = this.computeLateralOffset(offsetIndex);
    // if (offsetMeters === 0) {
    //   return;
    // }

    // const rightEast = Math.cos(bearingRad);
    // const rightNorth = -Math.sin(bearingRad);
    // const modelScale = getModelScale();

    // const offsetX = rightEast * offsetMeters * modelScale;
    // const offsetY = -rightNorth * offsetMeters * modelScale;

    // position.x += offsetX;
    // position.y += offsetY;
  }

  public getDebugInfo(): Array<{
    vehicleKey: string;
    routeId: string;
    offsetIndex: number;
    offsetMeters: number;
    currentZoom: number;
    zoomFactor: number;
    position: { x: number; y: number; z: number };
  }> {
    const debugInfo: Array<{
      vehicleKey: string;
      routeId: string;
      offsetIndex: number;
      offsetMeters: number;
      currentZoom: number;
      zoomFactor: number;
      position: { x: number; y: number; z: number };
    }> = [];

    this.trainMeshes.forEach((meshData) => {
      const offsetMeters = this.computeLateralOffset(meshData.lateralOffsetIndex);
      const zoomFactor = this.currentZoom > this.lateralOffsetConfig.highZoomThreshold
        ? this.lateralOffsetConfig.highZoomMultiplier
        : 1.0;

      debugInfo.push({
        vehicleKey: meshData.vehicleKey,
        routeId: meshData.routeId,
        offsetIndex: meshData.lateralOffsetIndex,
        offsetMeters,
        currentZoom: this.currentZoom,
        zoomFactor,
        position: {
          x: meshData.mesh.position.x,
          y: meshData.mesh.position.y,
          z: meshData.mesh.position.z,
        },
      });
    });

    return debugInfo;
  }

  private calculateEffectiveInterpolationDuration(
    pollMetadata?: PollSnapshotMetadata
  ): number {
    if (
      pollMetadata?.currentPolledAtMs !== undefined &&
      pollMetadata?.previousPolledAtMs !== undefined &&
      Number.isFinite(pollMetadata.currentPolledAtMs) &&
      Number.isFinite(pollMetadata.previousPolledAtMs)
    ) {
      const interval = pollMetadata.currentPolledAtMs - pollMetadata.previousPolledAtMs;
      if (Number.isFinite(interval) && interval > 0) {
        return Math.max(interval, this.MIN_INTERPOLATION_DURATION_MS);
      }
    }

    return this.INTERPOLATION_DURATION_MS;
  }

  /**
   * Calculate and apply rotation to train mesh based on next station bearing
   *
   * Task: T047
   *
   * Orients the train model to point toward its next station using the
   * Haversine bearing formula. If next station is not available, no rotation
   * is applied (train keeps default orientation).
   *
   * @param mesh - Three.js mesh to rotate
   * @param train - Train position data with nextStopId
   */
  private calculateBearingToNextStation(train: TrainPosition): number | null {
    // Skip if train has no next station
    if (!train.nextStopId) {
      return null;
    }

    // Skip if train coordinates are missing
    if (train.latitude === null || train.longitude === null) {
      return null;
    }

    // Look up next station
    const nextStation = this.stationMap.get(train.nextStopId);
    if (!nextStation) {
      // Station not found - this can happen for stations outside Rodalies network
      return null;
    }

    // Extract station coordinates from geometry
    const [stationLng, stationLat] = nextStation.geometry.coordinates;

    // Calculate bearing from train position to next station
    return calculateBearing(
      train.latitude,
      train.longitude,
      stationLat,
      stationLng
    );
  }

  private applyBearingRotation(mesh: THREE.Group, train: TrainPosition): void {
    const bearing = this.calculateBearingToNextStation(train);
    if (bearing === null) {
      return;
    }

    // T052i: CRITICAL - Bearing must be negated for correct orientation
    // Based on Mini Tokyo 3D: rotationZ = MathUtils.degToRad(-bearing)
    // This is because Mapbox Y-axis points south but Three.js Y points north
    // Without negation, trains point in the opposite direction!
    const bearingRad = (-bearing * Math.PI) / 180;

    // Apply rotation around Z-axis (vertical axis in map view)
    // Bearing 0° = North, 90° = East, 180° = South, 270° = West
    mesh.rotation.z = bearingRad + this.MODEL_FORWARD_OFFSET;
  }

  /**
   * Create a new train mesh from a loaded model
   *
   * @param train - Train position data
   * @param zoom - Current map zoom level for dynamic scaling
   * @returns Train mesh with metadata, or null if model not loaded
   */
  private createTrainMesh(
    train: TrainPosition,
    initialPosition: [number, number],
    targetPosition: [number, number],
    initialSnapState: RailwaySnapState | null,
    targetSnapState: RailwaySnapState | null,
    lastUpdateTimestamp: number,
    interpolationDuration: number
  ): TrainMeshData | null {
    // Determine which model to use based on route
    const modelType = getModelTypeForRoute(train.routeId);

    // Get the preloaded model from cache
    const gltf = getCachedModel(modelType);

    if (!gltf) {
      console.warn(
        `Model not loaded for route ${train.routeId} (type: ${modelType}). Skipping train ${train.vehicleKey}.`
      );
      return null;
    }

    // Clone the model's scene to create a new instance
    // This is efficient because it reuses the geometry and materials
    const trainModel = gltf.scene.clone(true) as THREE.Group;

    // T052h: Calculate proper scale using meterInMercatorCoordinateUnits
    // This makes the train realistically sized (~25 meters long)
    const modelScale = getModelScale();
    const baseScale = this.TRAIN_SIZE_METERS * modelScale;

    if (!Number.isFinite(modelScale) || !Number.isFinite(baseScale)) {
      console.warn('TrainMeshManager: Invalid scale computed', {
        modelScale,
        baseScale,
        vehicleKey: train.vehicleKey,
      });
    } else if (this.debugCount < this.DEBUG_LIMIT) {
      console.log('TrainMeshManager: Scale computed for train', {
        vehicleKey: train.vehicleKey,
        modelScale,
        baseScale,
      });
    }

    // T052k: Don't apply any scale to trainModel - keep it at natural size
    // Scale will be applied to the parent Group instead
    trainModel.scale.set(1, 1, 1);

    // Create a parent group to handle rotation properly
    // This allows us to separate "lay flat" rotation from "direction" rotation
    const mesh = new THREE.Group();

    // T103: Performance optimizations for Three.js rendering
    mesh.matrixAutoUpdate = true; // Keep auto-update for smooth animations
    mesh.frustumCulled = false; // Disable frustum culling as Mapbox handles viewport

    // First, rotate the model to lay flat on the map (XY plane)
    // The models appear to be oriented with Z-up; rotating +90° keeps the roof up
    trainModel.rotation.x = Math.PI / 2;

    // Ensure materials respond to new environment lighting
    trainModel.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const material = child.material as THREE.Material | THREE.Material[];
        const materials = Array.isArray(material) ? material : [material];
        materials.forEach((mat) => {
          if (mat && 'envMapIntensity' in mat) {
            // Boost environment contribution so colors stay vibrant
            (mat as THREE.MeshStandardMaterial).envMapIntensity = 1.5;
          }
          if (mat) {
            mat.needsUpdate = true;
          }
        });
        child.userData = {
          vehicleKey: train.vehicleKey,
          routeId: train.routeId,
          modelType,
          isTrain: true,
        };
      }
    });

    // Add the rotated model to the parent group
    trainModel.userData = {
      vehicleKey: train.vehicleKey,
      routeId: train.routeId,
      modelType,
      isTrain: true,
    };
    mesh.add(trainModel);

    // Center the trainModel geometry so scaling doesn't cause lateral drift
    // Use computeBoundingBox which is faster than setFromObject for single meshes
    trainModel.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry) {
        child.geometry.computeBoundingBox();
      }
    });

    // Calculate center offset from the already-rotated model
    trainModel.updateMatrixWorld(true);
    const centerBox = new THREE.Box3().setFromObject(trainModel);
    const centerOffset = new THREE.Vector3();
    centerBox.getCenter(centerOffset);

    // Offset the trainModel position to center it at the origin
    // This ensures scaling happens around the visual center, not an arbitrary pivot
    trainModel.position.sub(centerOffset);

    // Feature 003: Apply initial scale to parent group (not trainModel)
    const scaleVariation = this.getScaleVariation(train.vehicleKey);
    const zoomScale = this.scaleManager.computeScale(this.currentZoom);
    const initialScale = baseScale * scaleVariation * zoomScale;
    mesh.scale.set(initialScale, initialScale, initialScale);

    // T047: Apply rotation based on bearing to next station
    // This rotates the parent group around Z-axis to point toward next station
    this.applyBearingRotation(mesh, train);

    if (targetSnapState || initialSnapState) {
      const bearingSource = targetSnapState ?? (initialSnapState as RailwaySnapState);
      const reversed =
        Boolean(
          initialSnapState &&
            targetSnapState &&
            initialSnapState.lineId === targetSnapState.lineId &&
            targetSnapState.distance < initialSnapState.distance
        );

      this.applyRailwayBearing(mesh, bearingSource.bearing, reversed);
    }

    const lateralOffsetIndex = this.getLateralOffsetIndex(train.vehicleKey);

    // Calculate final bounding sphere after all transforms (only once)
    // Reuse centerBox to avoid allocating new Box3
    centerBox.setFromObject(mesh);
    const boundingSphere = new THREE.Sphere();
    centerBox.getBoundingSphere(boundingSphere);

    const meshData: TrainMeshData = {
      mesh,
      vehicleKey: train.vehicleKey,
      routeId: train.routeId,
      currentPosition: initialPosition,
      targetPosition,
      lastUpdate: lastUpdateTimestamp,
      interpolationDuration,
      currentSnap: (initialSnapState ?? targetSnapState) ?? undefined,
      targetSnap: targetSnapState ?? undefined,
      lateralOffsetIndex,
      baseScale,
      boundingCenterOffset: boundingSphere.center.clone(),
      boundingRadius: boundingSphere.radius,
      hasUnrealisticSpeed: false,
      // Feature 003: Initialize zoom-responsive scaling fields
      screenSpaceScale: zoomScale,
      lastZoomBucket: Math.round(this.currentZoom * 10) / 10, // Quantize to 0.1
    };

    return meshData;
  }

  /**
   * Update train meshes based on new position data
   *
   * Creates new meshes for new trains, updates existing ones,
   * and removes meshes for trains that are no longer active.
   *
   * @param trains - Array of current train positions
   *
   * Task: T046 - Create instances based on route mapping
   */
  updateTrainMeshes(
    trains: TrainPosition[],
    previousPositions?: Map<string, TrainPosition>,
    pollMetadata?: PollSnapshotMetadata
  ): void {
    const activeTrainKeys = new Set<string>();
    const now = Date.now();
    const interpolationDuration = this.calculateEffectiveInterpolationDuration(pollMetadata);
    const baseLastUpdate =
      pollMetadata?.receivedAtMs && Number.isFinite(pollMetadata.receivedAtMs)
        ? pollMetadata.receivedAtMs
        : now;

    // Create or update meshes for each train
    for (const train of trains) {
      // Skip trains without valid GPS coordinates
      if (train.latitude === null || train.longitude === null) {
        continue;
      }

      activeTrainKeys.add(train.vehicleKey);

      const targetSnapState = this.snapPositionToRailway(train);
      const targetLngLat: [number, number] = targetSnapState
        ? [targetSnapState.position[0], targetSnapState.position[1]]
        : [train.longitude!, train.latitude!];

      const previousPosition = previousPositions?.get(train.vehicleKey);
      let previousLngLat: [number, number] | null = null;
      let previousSnapState: RailwaySnapState | null = null;

      if (
        previousPosition &&
        previousPosition.latitude !== null &&
        previousPosition.longitude !== null
      ) {
        previousLngLat = [previousPosition.longitude, previousPosition.latitude];
        previousSnapState = this.snapPositionToRailway(previousPosition);
      }

      const initialLngLat: [number, number] = previousLngLat ?? targetLngLat;

      const existing = this.trainMeshes.get(train.vehicleKey);

      if (existing) {
        if (typeof existing.lateralOffsetIndex !== 'number') {
          existing.lateralOffsetIndex = this.getLateralOffsetIndex(train.vehicleKey);
        }

        // Validate position update to detect unrealistic jumps
        const effectivePreviousSnap = previousSnapState ?? existing.currentSnap ?? null;
        const timeSinceLastUpdate = baseLastUpdate - existing.lastUpdate;
        const hasUnrealisticSpeed = this.validatePositionUpdate(
          train.vehicleKey,
          effectivePreviousSnap,
          targetSnapState,
          timeSinceLastUpdate
        );

        // Update warning indicator based on validation
        if (hasUnrealisticSpeed && !existing.warningIndicator) {
          // Add warning indicator
          const indicator = this.createWarningIndicator();
          const modelScale = getModelScale();
          const zOffset = this.Z_OFFSET_FACTOR * this.TRAIN_SIZE_METERS * modelScale;
          indicator.position.set(0, 0, zOffset + 10 * modelScale); // 10 meters above train
          existing.mesh.add(indicator);
          existing.warningIndicator = indicator;
          existing.hasUnrealisticSpeed = true;
        } else if (!hasUnrealisticSpeed && existing.warningIndicator) {
          // Remove warning indicator
          existing.mesh.remove(existing.warningIndicator);
          existing.warningIndicator.material.map?.dispose();
          existing.warningIndicator.material.dispose();
          existing.warningIndicator = undefined;
          existing.hasUnrealisticSpeed = false;
        }

        if (previousLngLat) {
          existing.currentPosition = previousLngLat;
        }

        if (previousSnapState) {
          existing.currentSnap = previousSnapState;
        } else if (!existing.currentSnap && existing.targetSnap) {
          existing.currentSnap = existing.targetSnap;
        }

        existing.targetPosition = targetLngLat;
        existing.targetSnap = targetSnapState ?? undefined;
        existing.lastUpdate = baseLastUpdate;
        existing.interpolationDuration = interpolationDuration;

        // T047: Update rotation based on (potentially new) next station
        this.applyBearingRotation(existing.mesh, train);

        if (targetSnapState) {
          const travellingForward =
            previousSnapState &&
            targetSnapState &&
            previousSnapState.lineId === targetSnapState.lineId
              ? targetSnapState.distance >= previousSnapState.distance
              : existing.currentSnap &&
                  existing.targetSnap &&
                  existing.currentSnap.lineId === existing.targetSnap.lineId
                ? existing.targetSnap.distance >= existing.currentSnap.distance
                : true;

          this.applyRailwayBearing(existing.mesh, targetSnapState.bearing, !travellingForward);
        }
      } else {
        // Create new mesh for this train
        const meshData = this.createTrainMesh(
          train,
          initialLngLat,
          targetLngLat,
          previousSnapState,
          targetSnapState,
          baseLastUpdate,
          interpolationDuration
        );

        if (meshData) {
          const nextStationBearing = this.calculateBearingToNextStation(train);
          // T052g, T052j: Position using correct coordinate system with Z-offset
          // getModelPosition returns position relative to model origin with Y negated
          const position = getModelPosition(initialLngLat[0], initialLngLat[1], 0);

          // Calculate Z-offset elevation to prevent z-fighting with map surface
          // Based on Mini Tokyo 3D: trains "float" 0.44 * scale above ground
          const modelScale = getModelScale();
          const baseScale = this.TRAIN_SIZE_METERS * modelScale;
          const zOffset = this.Z_OFFSET_FACTOR * baseScale;

          const lateralBearingInfo = targetSnapState
            ? {
                bearing: targetSnapState.bearing,
                reversed: Boolean(
                  previousSnapState &&
                    targetSnapState &&
                    previousSnapState.lineId === targetSnapState.lineId &&
                    targetSnapState.distance < previousSnapState.distance
                ),
              }
            : previousSnapState
              ? { bearing: previousSnapState.bearing, reversed: false }
              : nextStationBearing !== null
                ? { bearing: nextStationBearing, reversed: false }
                : null;

          this.applyLateralOffset(position, lateralBearingInfo, meshData.lateralOffsetIndex);

          meshData.mesh.position.set(position.x, position.y, position.z + zOffset);

      // Invalidate screen-space cache when position changes
      this.screenCandidatesCacheInvalidated = true;

          // Add to scene
          this.scene.add(meshData.mesh);

          if (this.debugCount < this.DEBUG_LIMIT) {
            this.debugMeshes.push(meshData.mesh);
          }

          // Track in our map
          this.trainMeshes.set(train.vehicleKey, meshData);

          console.log(
            `Created mesh for train ${train.vehicleKey} (route: ${train.routeId})`
          );
        }
      }
    }

    // Remove meshes for trains that are no longer active
    const toRemove: string[] = [];
    this.trainMeshes.forEach((_meshData, vehicleKey) => {
      if (!activeTrainKeys.has(vehicleKey)) {
        toRemove.push(vehicleKey);
      }
    });

    for (const vehicleKey of toRemove) {
      this.removeTrainMesh(vehicleKey);
    }

    // Invalidate screen-space cache after train updates
    this.screenCandidatesCacheInvalidated = true;

    console.log(
      `TrainMeshManager: ${this.trainMeshes.size} trains rendered (${toRemove.length} removed)`
    );
  }

  /**
   * Remove a train mesh from the scene
   *
   * @param vehicleKey - Train identifier to remove
   */
  private removeTrainMesh(vehicleKey: string): void {
    const meshData = this.trainMeshes.get(vehicleKey);

    if (meshData) {
      // Remove from scene
      this.scene.remove(meshData.mesh);
      if (this.highlightedVehicleKey === vehicleKey) {
        this.highlightedVehicleKey = null;
      }

      // Clean up warning indicator if present
      if (meshData.warningIndicator) {
        meshData.warningIndicator.material.map?.dispose();
        meshData.warningIndicator.material.dispose();
      }

      // Dispose of geometry and materials to free GPU memory
      meshData.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose();

          if (Array.isArray(child.material)) {
            child.material.forEach((mat) => mat.dispose());
          } else {
            child.material?.dispose();
          }
        }
      });

      // Remove from tracking map
      this.trainMeshes.delete(vehicleKey);

      console.log(`Removed mesh for train ${vehicleKey}`);
    }
  }

  /**
   * Set opacity for all materials in a mesh
   * Recursively traverses the mesh and updates all materials
   *
   * @param mesh - The mesh to update
   * @param opacity - Opacity value between 0 (invisible) and 1 (fully visible)
   */
  private setMeshOpacity(mesh: THREE.Group, opacity: number): void {
    mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const material = child.material;

        if (Array.isArray(material)) {
          // Handle multi-material meshes
          material.forEach((mat) => {
            mat.transparent = opacity < 1.0;
            mat.opacity = opacity;
          });
        } else if (material) {
          // Handle single material
          material.transparent = opacity < 1.0;
          material.opacity = opacity;
        }
      }
    });
  }

  /**
   * Set opacity for multiple trains based on line selection
   * Task: T089 - Filter trains by line selection
   *
   * @param opacities - Map of vehicleKey to opacity (0.0 - 1.0)
   */
  setTrainOpacities(opacities: Map<string, number>): void {
    opacities.forEach((opacity, vehicleKey) => {
      const meshData = this.trainMeshes.get(vehicleKey);
      if (meshData) {
        this.setMeshOpacity(meshData.mesh, opacity);
      }
    });
  }

  setHighlightedTrain(vehicleKey?: string): void {
    const nextKey = vehicleKey ?? null;
    if (this.highlightedVehicleKey === nextKey) {
      return;
    }

    if (this.highlightedVehicleKey) {
      const prev = this.trainMeshes.get(this.highlightedVehicleKey);
      if (prev) {
        const scaleVariation = this.getScaleVariation(prev.vehicleKey);
        const normalScale = prev.baseScale * scaleVariation * prev.screenSpaceScale;
        prev.mesh.scale.setScalar(normalScale);
      }
    }

    this.highlightedVehicleKey = nextKey;

    if (nextKey) {
      const next = this.trainMeshes.get(nextKey);
      if (next) {
        const scaleVariation = this.getScaleVariation(next.vehicleKey);
        const normalScale = next.baseScale * scaleVariation * next.screenSpaceScale;
        const highlightScale = normalScale * 1.12;
        next.mesh.scale.setScalar(highlightScale);
      }
    }
  }

  /**
   * Show hover outline for a train (Phase 5: User Story 3)
   * Creates outline mesh lazily on first hover
   * Outline thickness scales with zoom level
   */
  showOutline(vehicleKey: string, lineColorMap: Map<string, THREE.Color>): void {
    const meshData = this.trainMeshes.get(vehicleKey);
    if (!meshData) return;

    // Lazy creation: create outline on first hover
    if (!meshData.outlineMesh) {
      // Extract line code from route ID
      const lineCode = extractLineFromRouteId(meshData.routeId);
      const lineColor = lineCode
        ? lineColorMap.get(lineCode.toUpperCase()) ?? lineColorMap.get('__FALLBACK__')!
        : lineColorMap.get('__FALLBACK__')!;

      // Find the trainModel child (the rotated child inside the parent Group)
      // The outline should be added to trainModel to inherit its rotation
      let trainModelChild: THREE.Object3D | null = null;
      meshData.mesh.traverse((child) => {
        if (child !== meshData.mesh && child instanceof THREE.Group && !trainModelChild) {
          trainModelChild = child;
        }
      });

      // Compute zoom-responsive outline scale factor
      // Zoom < 15 (before buildings): thicker outline (1.08)
      // Zoom >= 15 (buildings visible): thinner outline (1.04)
      const zoom = this.currentZoom;
      const scaleFactor = zoom < 15 ? 1.08 : 1.04;

      // Create outline mesh from the trainModel with zoom-adjusted scale
      const targetMesh = trainModelChild ?? meshData.mesh;
      const outlineMesh = createOutlineMesh(targetMesh as THREE.Group, lineColor, scaleFactor);
      targetMesh.add(outlineMesh);

      // Store for future use
      meshData.outlineMesh = outlineMesh;
      meshData.lineCode = lineCode ?? undefined;
      meshData.lineColor = lineColor;
    }

    // Show outline
    if (meshData.outlineMesh) {
      meshData.outlineMesh.visible = true;
    }
  }

  /**
   * Hide hover outline for a train (Phase 5: User Story 3)
   */
  hideOutline(vehicleKey: string): void {
    const meshData = this.trainMeshes.get(vehicleKey);
    if (!meshData || !meshData.outlineMesh) return;

    meshData.outlineMesh.visible = false;
  }

  /**
   * Get all train meshes currently managed
   *
   * @returns Array of train mesh data
   */
  getAllMeshes(): TrainMeshData[] {
    return Array.from(this.trainMeshes.values());
  }

  /**
   * Get a specific train mesh by vehicle key
   *
   * @param vehicleKey - Train identifier
   * @returns Train mesh data or undefined if not found
   */
  getMesh(vehicleKey: string): TrainMeshData | undefined {
    return this.trainMeshes.get(vehicleKey);
  }

  /**
   * Clear all train meshes from the scene
   * Useful for cleanup on unmount
   */
  clearAll(): void {
    const keys = Array.from(this.trainMeshes.keys());
    for (const key of keys) {
      this.removeTrainMesh(key);
    }
    console.log('TrainMeshManager: All meshes cleared');
  }

  /**
   * Get the number of active train meshes
   */
  getMeshCount(): number {
    return this.trainMeshes.size;
  }

  getScreenCandidates(map: mapboxgl.Map): ScreenSpaceCandidate[] {
    const currentZoom = map.getZoom();

    // Return cached candidates if zoom hasn't changed and positions haven't been updated
    if (
      this.screenCandidatesCache &&
      this.screenCandidatesCacheZoom === currentZoom &&
      !this.screenCandidatesCacheInvalidated
    ) {
      return this.screenCandidatesCache;
    }

    // Recalculate candidates
    const candidates: ScreenSpaceCandidate[] = [];

    this.trainMeshes.forEach((meshData) => {
      const { mesh, vehicleKey, routeId, boundingRadius } = meshData;

      // Use mesh position directly (already in correct world space)
      const centerLngLat = getLngLatFromModelPosition(
        mesh.position.x,
        mesh.position.y,
        mesh.position.z
      );
      const centerPoint = map.project(centerLngLat);

      // Use actual bounding radius from mesh (accounts for real model geometry)
      const currentScale = mesh.scale.x;
      const worldRadius = boundingRadius * currentScale;

      // Project radius to screen space
      const edgeLngLat = getLngLatFromModelPosition(
        mesh.position.x + worldRadius,
        mesh.position.y,
        mesh.position.z
      );
      const edgePoint = map.project(edgeLngLat);

      // Calculate distance manually (map.project returns plain {x, y} object)
      const dx = edgePoint.x - centerPoint.x;
      const dy = edgePoint.y - centerPoint.y;
      const radiusPx = Math.max(Math.hypot(dx, dy), 10);

      candidates.push({
        vehicleKey,
        routeId,
        screenPoint: centerPoint,
        radiusPx,
      });
    });

    // Cache the results
    this.screenCandidatesCache = candidates;
    this.screenCandidatesCacheZoom = currentZoom;
    this.screenCandidatesCacheInvalidated = false;

    return candidates;
  }

  /**
   * Animate train positions with smooth interpolation
   *
   * Task: T048
   *
   * This method should be called on every frame to smoothly interpolate
   * train positions from currentPosition to targetPosition.
   *
   * Uses easeInOutCubic easing for natural-looking movement.
   */
  applyZoomResponsiveScale(): void {
    const zoomScale = this.scaleManager.computeScale(this.currentZoom);

    this.trainMeshes.forEach((meshData) => {
      const quantizedZoom = Math.round(this.currentZoom * 10) / 10;
      if (meshData.lastZoomBucket !== quantizedZoom) {
        const scaleVariation = this.getScaleVariation(meshData.vehicleKey);
        const finalScale = meshData.baseScale * scaleVariation * zoomScale;

        const isHighlighted = this.highlightedVehicleKey === meshData.vehicleKey;
        const scaleToApply = isHighlighted ? finalScale * 1.12 : finalScale;

        meshData.mesh.scale.set(scaleToApply, scaleToApply, scaleToApply);
        meshData.screenSpaceScale = zoomScale;
        meshData.lastZoomBucket = quantizedZoom;
      }
    });
  }

  animatePositions(): void {
    const now = Date.now();

    this.trainMeshes.forEach((meshData) => {
      const { currentPosition, targetPosition, lastUpdate } = meshData;

      // Check if we need to interpolate
      const [currentLng, currentLat] = currentPosition;
      const [targetLng, targetLat] = targetPosition;

      // If already at target, skip interpolation
      if (currentLng === targetLng && currentLat === targetLat) {
        return;
      }

      // Calculate time elapsed since position update
      const elapsed = now - lastUpdate;
      if (elapsed === 0) {
        return;
      }

      // Interpolation duration matches polling interval for continuous motion
      const interpolationDuration = Math.max(
        meshData.interpolationDuration ?? this.INTERPOLATION_DURATION_MS,
        this.MIN_INTERPOLATION_DURATION_MS
      );

      // Calculate progress (0 to 1)
      const progress = Math.min(elapsed / interpolationDuration, 1.0);

      // Interpolate position with easing
      // Note: Position is [lng, lat]
      let interpolatedLngLat: [number, number] | null = null;
      let bearingOverride: { bearing: number; reversed: boolean } | null = null;

      if (
        meshData.currentSnap &&
        meshData.targetSnap &&
        meshData.currentSnap.lineId === meshData.targetSnap.lineId
      ) {
        const railway = this.railwayLines.get(meshData.currentSnap.lineId);
        if (railway) {
          const distanceStart = meshData.currentSnap.distance;
          const distanceEnd = meshData.targetSnap.distance;
          const interpolatedDistance = distanceStart + (distanceEnd - distanceStart) * progress;
          const sample = sampleRailwayPosition(railway, interpolatedDistance);
          const travellingForward = distanceEnd >= distanceStart;
          interpolatedLngLat = [sample.position[0], sample.position[1]];
          bearingOverride = {
            bearing: sample.bearing,
            reversed: !travellingForward,
          };
        }
      }

      if (!interpolatedLngLat) {
        const [lng, lat] = interpolatePositionSmooth(
          currentPosition,
          targetPosition,
          progress
        );
        interpolatedLngLat = [lng, lat];
      }

      const position = getModelPosition(interpolatedLngLat[0], interpolatedLngLat[1], 0);

      // Calculate Z-offset elevation to prevent z-fighting with map surface
      const modelScale = getModelScale();
      const baseScale = this.TRAIN_SIZE_METERS * modelScale;
      const zOffset = this.Z_OFFSET_FACTOR * baseScale;

      let bearingInfo = bearingOverride;
      if (!bearingInfo && meshData.targetSnap) {
        const currentSnap = meshData.currentSnap ?? meshData.targetSnap;
        if (currentSnap && meshData.targetSnap.lineId === currentSnap.lineId) {
          const travellingForward = meshData.targetSnap.distance >= currentSnap.distance;
          bearingInfo = {
            bearing: meshData.targetSnap.bearing,
            reversed: !travellingForward,
          };
        } else {
          bearingInfo = {
            bearing: meshData.targetSnap.bearing,
            reversed: false,
          };
        }
      }

      if (!bearingInfo) {
        if (currentLng !== targetLng || currentLat !== targetLat) {
          const bearingToTarget = calculateBearing(
            currentLat,
            currentLng,
            targetLat,
            targetLng
          );
          bearingInfo = { bearing: bearingToTarget, reversed: false };
        }
      }

      if (!bearingInfo) {
        const rotationDeg =
          (-(meshData.mesh.rotation.z - this.MODEL_FORWARD_OFFSET) * 180) / Math.PI;
        bearingInfo = { bearing: (rotationDeg + 360) % 360, reversed: false };
      }

      this.applyLateralOffset(position, bearingInfo, meshData.lateralOffsetIndex);

      if (this.debugCount < this.DEBUG_LIMIT) {
        console.log('TrainMeshManager: Position computed for mesh', {
          vehicleKey: meshData.vehicleKey,
          interpolatedLng: interpolatedLngLat[0],
          interpolatedLat: interpolatedLngLat[1],
          position,
          zOffset,
        });
        this.debugCount += 1;
      }

      meshData.mesh.position.set(position.x, position.y, position.z + zOffset);

      // Invalidate screen-space cache when position changes
      this.screenCandidatesCacheInvalidated = true;

      if (bearingOverride) {
        this.applyRailwayBearing(
          meshData.mesh,
          bearingOverride.bearing,
          bearingOverride.reversed
        );
      }

      // If interpolation complete, update current position to target
      if (progress >= 1.0) {
        meshData.currentPosition = targetPosition;
        if (meshData.targetSnap) {
          meshData.currentSnap = meshData.targetSnap;
        } else {
          meshData.currentSnap = undefined;
        }
      }
    });

    if (this.debugCount > 0 && this.debugMeshes.length > 0 && this.debugWorldLogsRemaining > 0) {
      this.debugWorldLogsRemaining -= 1;
      console.log('TrainMeshManager: Debug mesh world positions', this.debugMeshes.map((mesh) => ({
        vehicleKey: mesh.userData?.vehicleKey,
        position: mesh.position.clone(),
        scale: mesh.scale.clone(),
        worldPos: mesh.getWorldPosition(new THREE.Vector3()),
      })));
    }
  }
}
