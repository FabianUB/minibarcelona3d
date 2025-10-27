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
import {
  calculateBearing,
  interpolatePositionSmooth,
  snapTrainToRailway,
  sampleRailwayPosition,
  type PreprocessedRailwayLine,
  type RailwaySnapResult,
} from './geometry';
import { getModelPosition, getModelScale } from '../map/coordinates';

/**
 * Metadata stored with each train mesh
 * Allows efficient updates and tracking
 */
interface RailwaySnapState extends RailwaySnapResult {
  lineId: string;
}

interface TrainMeshData {
  mesh: THREE.Group;
  vehicleKey: string;
  routeId: string;
  currentPosition: [number, number]; // [lng, lat]
  targetPosition: [number, number]; // [lng, lat]
  lastUpdate: number; // timestamp
  currentSnap?: RailwaySnapState;
  targetSnap?: RailwaySnapState;
  lateralOffsetIndex: number;
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
  private readonly DEBUG_LIMIT = 5;
  private readonly debugMeshes: THREE.Object3D[] = [];
  private debugWorldLogsRemaining = 3;
  private readonly MAX_SNAP_DISTANCE_METERS = 200;
  private readonly MODEL_FORWARD_OFFSET = Math.PI; // Train models face negative X by default
  private readonly LATERAL_OFFSET_BUCKETS = 5;
  private readonly LATERAL_OFFSET_STEP_METERS = 1.6; // meters between trains laterally
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
    railwayLines: Map<string, PreprocessedRailwayLine>
  ) {
    this.scene = scene;

    // Create station lookup map for O(1) access by ID
    this.stationMap = new Map();
    for (const station of stations) {
      this.stationMap.set(station.id, station);
    }

    this.railwayLines = railwayLines;

    console.log(`TrainMeshManager: Loaded ${this.stationMap.size} stations for bearing calculations`);
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

  private applyLateralOffset(
    position: { x: number; y: number },
    bearingInfo: { bearing: number; reversed: boolean } | null,
    offsetIndex: number
  ): void {
    if (!offsetIndex || !bearingInfo) {
      return;
    }

    const adjustedBearing = (bearingInfo.bearing + (bearingInfo.reversed ? 180 : 0) + 360) % 360;
    const bearingRad = (adjustedBearing * Math.PI) / 180;

    const offsetMeters = offsetIndex * this.LATERAL_OFFSET_STEP_METERS;
    if (offsetMeters === 0) {
      return;
    }

    const rightEast = Math.cos(bearingRad);
    const rightNorth = -Math.sin(bearingRad);
    const modelScale = getModelScale();

    const offsetX = rightEast * offsetMeters * modelScale;
    const offsetY = -rightNorth * offsetMeters * modelScale;

    position.x += offsetX;
    position.y += offsetY;
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
    snapState: RailwaySnapState | null
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

    // T052k: Pseudo-random scale variation (0-3%) to prevent visual overlap
    const scaleVariation = this.getScaleVariation(train.vehicleKey);
    const finalScale = baseScale * scaleVariation;

    // Apply scale to model
    trainModel.scale.set(finalScale, finalScale, finalScale);

    // Create a parent group to handle rotation properly
    // This allows us to separate "lay flat" rotation from "direction" rotation
    const mesh = new THREE.Group();

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
      }
    });

    // Add the rotated model to the parent group
    mesh.add(trainModel);

    // T047: Apply rotation based on bearing to next station
    // This rotates the parent group around Z-axis to point toward next station
    this.applyBearingRotation(mesh, train);

    if (snapState) {
      this.applyRailwayBearing(mesh, snapState.bearing);
    }

    // Add custom user data for debugging
    mesh.userData = {
      vehicleKey: train.vehicleKey,
      routeId: train.routeId,
      modelType,
      isTrain: true, // Useful for raycasting (T049)
    };

    const lateralOffsetIndex = this.getLateralOffsetIndex(train.vehicleKey);

    const meshData: TrainMeshData = {
      mesh,
      vehicleKey: train.vehicleKey,
      routeId: train.routeId,
      currentPosition: initialPosition,
      targetPosition: initialPosition,
      lastUpdate: Date.now(),
      currentSnap: snapState ?? undefined,
      targetSnap: snapState ?? undefined,
      lateralOffsetIndex,
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
  updateTrainMeshes(trains: TrainPosition[]): void {
    const activeTrainKeys = new Set<string>();

    // Create or update meshes for each train
    for (const train of trains) {
      // Skip trains without valid GPS coordinates
      if (train.latitude === null || train.longitude === null) {
        continue;
      }

      activeTrainKeys.add(train.vehicleKey);

      const snapState = this.snapPositionToRailway(train);
      const targetLngLat: [number, number] = snapState
        ? [snapState.position[0], snapState.position[1]]
        : [train.longitude!, train.latitude!];

      const existing = this.trainMeshes.get(train.vehicleKey);

      if (existing) {
        if (typeof existing.lateralOffsetIndex !== 'number') {
          existing.lateralOffsetIndex = this.getLateralOffsetIndex(train.vehicleKey);
        }
        if (existing.targetSnap) {
          existing.currentSnap = existing.targetSnap;
        } else if (!existing.currentSnap && snapState) {
          existing.currentSnap = snapState;
        }

        // Update target position for smooth interpolation (T048)
        // The animatePositions() method will handle the smooth transition
        existing.targetPosition = targetLngLat;
        existing.lastUpdate = Date.now();

        existing.targetSnap = snapState ?? undefined;

        // T047: Update rotation based on (potentially new) next station
        this.applyBearingRotation(existing.mesh, train);

        if (snapState) {
          const previous = existing.currentSnap ?? snapState;
          const travellingForward = snapState.distance >= previous.distance;
          this.applyRailwayBearing(existing.mesh, snapState.bearing, !travellingForward);
        }
      } else {
        // Create new mesh for this train
      const meshData = this.createTrainMesh(train, targetLngLat, snapState);

      if (meshData) {
        const nextStationBearing = this.calculateBearingToNextStation(train);
        // T052g, T052j: Position using correct coordinate system with Z-offset
        // getModelPosition returns position relative to model origin with Y negated
        const position = getModelPosition(targetLngLat[0], targetLngLat[1], 0);

        // Calculate Z-offset elevation to prevent z-fighting with map surface
        // Based on Mini Tokyo 3D: trains "float" 0.44 * scale above ground
        const modelScale = getModelScale();
        const baseScale = this.TRAIN_SIZE_METERS * modelScale;
        const zOffset = this.Z_OFFSET_FACTOR * baseScale;

        const lateralBearingInfo = snapState
          ? { bearing: snapState.bearing, reversed: false }
          : nextStationBearing !== null
            ? { bearing: nextStationBearing, reversed: false }
            : null;

        this.applyLateralOffset(position, lateralBearingInfo, meshData.lateralOffsetIndex);

        meshData.mesh.position.set(position.x, position.y, position.z + zOffset);

        // Add to scene
        this.scene.add(meshData.mesh);

        if (snapState) {
          this.applyRailwayBearing(meshData.mesh, snapState.bearing, false);
        }

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

      // Interpolation duration: 2 seconds for smooth movement
      // This gives a nice visual transition between 30-second updates
      const interpolationDuration = 2000;

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
