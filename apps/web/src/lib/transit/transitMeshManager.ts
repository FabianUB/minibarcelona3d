/**
 * Transit Vehicle Mesh Manager
 *
 * Manages 3D vehicle meshes for Metro and Bus vehicles.
 * Uses continuous position calculation for smooth animation.
 *
 * Key features:
 * - Positions calculated every frame based on elapsed time
 * - No "catch-up" interpolation needed
 * - Perfectly smooth movement at any frame rate
 * - Never moves backward: if an update would cause backward movement,
 *   the current position is kept and vehicle continues forward
 */

import * as THREE from 'three';
import type { VehiclePosition, TransportType, TravelDirection } from '../../types/transit';
import type { PreprocessedRailwayLine } from '../trains/geometry';
import { sampleRailwayPosition } from '../trains/geometry';
import { getCachedModel, loadTrainModel } from '../trains/modelLoader';
import { ScaleManager } from '../trains/scaleManager';
import { getModelPosition, getModelScale } from '../map/coordinates';
import { getPreprocessedMetroLine } from '../metro/positionSimulator';
import { getPreprocessedBusRoute } from '../bus/positionSimulator';

/**
 * Mesh data stored for each vehicle - includes continuous motion parameters
 */
interface TransitMeshData {
  mesh: THREE.Group;
  vehicleKey: string;
  lineCode: string;
  networkType: TransportType;
  direction: TravelDirection;

  // Continuous motion parameters
  referenceDistance: number;    // Distance along line at referenceTime
  referenceTime: number;        // When this position was established
  speedMetersPerSecond: number; // Vehicle speed
  lineTotalLength: number;      // For wrapping around

  // Current state
  currentPosition: [number, number];
  currentBearing: number;

  // Visual
  baseScale: number;
  screenSpaceScale: number;
  lineColor: THREE.Color;
  opacity: number;
}

/**
 * Configuration for TransitMeshManager
 */
export interface TransitMeshManagerConfig {
  /** Vehicle size in meters (default: 25 for metro/trains) */
  vehicleSizeMeters?: number;
  /** Model type to use ('civia' default for metro) */
  modelType?: '447' | '470' | 'civia';
  /** Z offset factor for elevation (default: 0.5) */
  zOffsetFactor?: number;
}

const DEFAULT_CONFIG: Required<TransitMeshManagerConfig> = {
  vehicleSizeMeters: 25,
  modelType: 'civia',
  zOffsetFactor: 0.5,
};

/**
 * TransitMeshManager
 *
 * Manages 3D vehicle meshes with continuous position calculation.
 * Positions are calculated every frame based on elapsed time for smooth animation.
 */
export class TransitMeshManager {
  private meshes: Map<string, TransitMeshData> = new Map();
  private scene: THREE.Scene;
  private config: Required<TransitMeshManagerConfig>;
  private scaleManager: ScaleManager;
  private modelLoaded = false;
  private currentZoom = 12;

  // Rotation offset: models face -X, we need them to face bearing direction
  private readonly MODEL_FORWARD_OFFSET = Math.PI;

  constructor(scene: THREE.Scene, config: TransitMeshManagerConfig = {}) {
    this.scene = scene;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.scaleManager = new ScaleManager({
      minHeightPx: 15,
      maxHeightPx: 50,
      targetHeightPx: 30,
    });
  }

  /**
   * Load the 3D model for vehicles
   */
  async loadModel(): Promise<void> {
    if (this.modelLoaded) return;

    try {
      await loadTrainModel(this.config.modelType);
      this.modelLoaded = true;
      console.log(`Transit model loaded: ${this.config.modelType}`);
    } catch (error) {
      console.error('Failed to load transit model:', error);
      throw error;
    }
  }

  /**
   * Check if model is loaded
   */
  isModelLoaded(): boolean {
    return this.modelLoaded;
  }

  /**
   * Update current zoom level for scale calculations
   */
  setZoom(zoom: number): void {
    this.currentZoom = zoom;
  }

  /**
   * Get preprocessed geometry for a vehicle
   */
  private getGeometry(networkType: TransportType, lineCode: string): PreprocessedRailwayLine | null {
    if (networkType === 'metro') {
      return getPreprocessedMetroLine(lineCode);
    } else if (networkType === 'bus') {
      return getPreprocessedBusRoute(lineCode);
    }
    return null;
  }

  /**
   * Convert distanceAlongLine from simulator to raw animation distance.
   *
   * The simulator produces:
   * - Direction 0: distanceAlongLine increases over time
   * - Direction 1: distanceAlongLine = totalLength - adjusted (decreases over time)
   *
   * The animate function expects:
   * - Raw distance that increases for both directions, then mirrors for direction 1
   *
   * So for direction 1, we undo the simulator's transform.
   */
  private toRawAnimationDistance(
    distanceAlongLine: number,
    direction: TravelDirection,
    totalLength: number
  ): number {
    if (direction === 0) {
      return distanceAlongLine;
    }
    // For direction 1: raw = totalLength - distanceAlongLine
    // This undoes the simulator's transform (distanceAlongLine = totalLength - adjusted)
    return totalLength - distanceAlongLine;
  }

  /**
   * Calculate current raw animation distance for a vehicle.
   * This is where the vehicle currently appears to be (before any visual mirroring).
   */
  private getCurrentRawDistance(data: TransitMeshData, now: number): number {
    const elapsedSeconds = (now - data.referenceTime) / 1000;
    const distanceTraveled = elapsedSeconds * data.speedMetersPerSecond;
    return (data.referenceDistance + distanceTraveled) % data.lineTotalLength;
  }

  /**
   * Check if accepting a new position would move the vehicle backward.
   *
   * In the raw animation frame, vehicles always move in the positive direction.
   * We check the shortest path between current and new positions.
   *
   * @param currentRaw - Current raw animation distance
   * @param newRaw - Proposed new raw animation distance
   * @param totalLength - Total length of the line
   * @param tolerance - Allow small backward corrections (meters)
   * @returns true if the update would move backward beyond tolerance
   */
  private wouldMoveBackward(
    currentRaw: number,
    newRaw: number,
    totalLength: number,
    tolerance: number = 50
  ): boolean {
    // Normalize positions to [0, totalLength)
    currentRaw = ((currentRaw % totalLength) + totalLength) % totalLength;
    newRaw = ((newRaw % totalLength) + totalLength) % totalLength;

    // Calculate forward distance (clockwise on the circular line)
    const forwardDist = (newRaw - currentRaw + totalLength) % totalLength;

    // Calculate backward distance
    const backwardDist = totalLength - forwardDist;

    // If backward distance is shorter than forward distance,
    // and it's more than our tolerance, it's a backward move
    return backwardDist < forwardDist && backwardDist > tolerance;
  }

  /**
   * Update vehicle meshes from position data.
   *
   * Key behavior: Never allows backward movement.
   * If an update would place the vehicle behind its current animated position,
   * we keep the current position and continue forward from there.
   */
  updateVehicles(vehicles: VehiclePosition[]): void {
    if (!this.modelLoaded) {
      console.warn('[TransitMeshManager] Model not loaded, skipping mesh update');
      return;
    }

    if (vehicles.length === 0) {
      console.warn('[TransitMeshManager] No vehicles to update');
      return;
    }

    const now = Date.now();
    const activeKeys = new Set<string>();
    let newMeshes = 0;

    for (const vehicle of vehicles) {
      activeKeys.add(vehicle.vehicleKey);

      const existingMesh = this.meshes.get(vehicle.vehicleKey);

      if (existingMesh) {
        // Convert new position to raw animation distance
        const newRawDistance = this.toRawAnimationDistance(
          vehicle.distanceAlongLine,
          vehicle.direction,
          vehicle.lineTotalLength
        );

        // Calculate current animated raw distance
        const currentRawDistance = this.getCurrentRawDistance(existingMesh, now);

        // Check if this update would move the vehicle backward
        if (this.wouldMoveBackward(currentRawDistance, newRawDistance, existingMesh.lineTotalLength)) {
          // Keep current position - don't go backward
          // Update reference to current animated position
          existingMesh.referenceDistance = currentRawDistance;
          existingMesh.referenceTime = now;
        } else {
          // Update normally - vehicle is moving forward (or very small correction)
          existingMesh.referenceDistance = newRawDistance;
          existingMesh.referenceTime = vehicle.estimatedAt;
        }

        // Always update speed and length (they might have changed)
        existingMesh.speedMetersPerSecond = vehicle.speedMetersPerSecond;
        existingMesh.lineTotalLength = vehicle.lineTotalLength;
      } else {
        // Create new mesh
        this.createMesh(vehicle);
        newMeshes++;
      }
    }

    // Remove meshes for vehicles no longer in the list
    this.pruneInactiveVehicles(activeKeys);

    if (newMeshes > 0) {
      console.log(`[TransitMeshManager] Created ${newMeshes} new meshes, total: ${this.meshes.size}`);
    }
  }

  /**
   * Create a new mesh for a vehicle
   */
  private createMesh(vehicle: VehiclePosition): void {
    const gltf = getCachedModel(this.config.modelType);
    if (!gltf) {
      console.warn(`[TransitMeshManager] Model ${this.config.modelType} not in cache, cannot create mesh`);
      return;
    }

    // Clone the model
    const trainModel = gltf.scene.clone();

    // Create a parent group to handle rotation properly
    const mesh = new THREE.Group();

    // Rotate the model to lay flat on the map (XY plane)
    trainModel.rotation.x = Math.PI / 2;

    // Add the rotated model to the parent group
    mesh.add(trainModel);

    // Calculate base scale
    const modelScale = getModelScale();
    const baseScale = modelScale * this.config.vehicleSizeMeters;

    // Apply scale to parent group
    mesh.scale.setScalar(baseScale);

    // Set initial position
    const pos = getModelPosition(vehicle.longitude, vehicle.latitude, 0);
    mesh.position.set(pos.x, pos.y, pos.z + this.config.zOffsetFactor * baseScale);

    // Set rotation based on bearing
    this.applyBearing(mesh, vehicle.bearing);

    // Apply line color to the model
    const lineColor = new THREE.Color(vehicle.lineColor);
    this.applyLineColor(trainModel, lineColor);

    // Add to scene
    this.scene.add(mesh);

    // Convert to raw animation distance for consistent forward movement
    const rawDistance = this.toRawAnimationDistance(
      vehicle.distanceAlongLine,
      vehicle.direction,
      vehicle.lineTotalLength
    );

    // Store mesh data with continuous motion parameters
    this.meshes.set(vehicle.vehicleKey, {
      mesh,
      vehicleKey: vehicle.vehicleKey,
      lineCode: vehicle.lineCode,
      networkType: vehicle.networkType,
      direction: vehicle.direction,

      // Continuous motion parameters (using raw distance for consistent forward movement)
      referenceDistance: rawDistance,
      referenceTime: vehicle.estimatedAt,
      speedMetersPerSecond: vehicle.speedMetersPerSecond,
      lineTotalLength: vehicle.lineTotalLength,

      // Current state
      currentPosition: [vehicle.longitude, vehicle.latitude],
      currentBearing: vehicle.bearing,

      // Visual
      baseScale,
      screenSpaceScale: 1.0,
      lineColor,
      opacity: 1.0,
    });
  }

  /**
   * Apply bearing rotation to mesh
   */
  private applyBearing(mesh: THREE.Group, bearing: number): void {
    const bearingRad = (bearing * Math.PI) / 180;
    mesh.rotation.z = -bearingRad + this.MODEL_FORWARD_OFFSET;
  }

  /**
   * Apply line color to the train model materials
   */
  private applyLineColor(model: THREE.Object3D, color: THREE.Color): void {
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const materials = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];

        for (const material of materials) {
          if (material && 'color' in material) {
            const clonedMaterial = material.clone();
            (clonedMaterial as THREE.MeshStandardMaterial).color = color;
            if ('metalness' in clonedMaterial) {
              (clonedMaterial as THREE.MeshStandardMaterial).metalness = 0.3;
            }
            if ('roughness' in clonedMaterial) {
              (clonedMaterial as THREE.MeshStandardMaterial).roughness = 0.6;
            }
            mesh.material = clonedMaterial;
          }
        }
      }
    });
  }

  /**
   * Remove meshes for inactive vehicles
   */
  private pruneInactiveVehicles(activeKeys: Set<string>): void {
    const toRemove: string[] = [];

    for (const [key, data] of this.meshes) {
      if (!activeKeys.has(key)) {
        this.scene.remove(data.mesh);
        toRemove.push(key);
      }
    }

    for (const key of toRemove) {
      this.meshes.delete(key);
    }
  }

  /**
   * Animate mesh positions (call every frame)
   *
   * Calculates position continuously based on elapsed time.
   * No interpolation needed - positions are exact for current time.
   */
  animatePositions(): void {
    const now = Date.now();
    const zoomScale = this.scaleManager.computeScale(this.currentZoom);

    for (const [, data] of this.meshes) {
      // Calculate current distance based on elapsed time
      const elapsedSeconds = (now - data.referenceTime) / 1000;
      const distanceTraveled = elapsedSeconds * data.speedMetersPerSecond;

      // Calculate current distance along line (with wrapping)
      let currentDistance = (data.referenceDistance + distanceTraveled) % data.lineTotalLength;

      // For reverse direction, mirror the distance
      if (data.direction === 1) {
        currentDistance = data.lineTotalLength - currentDistance;
        if (currentDistance < 0) {
          currentDistance += data.lineTotalLength;
        }
      }

      // Get line geometry to sample position
      const geometry = this.getGeometry(data.networkType, data.lineCode);

      if (geometry) {
        // Sample position and bearing from geometry
        const { position, bearing } = sampleRailwayPosition(geometry, currentDistance);

        // Adjust bearing for reverse direction
        const finalBearing = data.direction === 1 ? (bearing + 180) % 360 : bearing;

        // Update position
        const pos = getModelPosition(position[0], position[1], 0);
        data.mesh.position.set(
          pos.x,
          pos.y,
          pos.z + this.config.zOffsetFactor * data.baseScale
        );

        // Update bearing
        this.applyBearing(data.mesh, finalBearing);

        // Update current state
        data.currentPosition = position;
        data.currentBearing = finalBearing;
      }

      // Apply zoom-responsive scale if changed
      if (data.screenSpaceScale !== zoomScale) {
        data.screenSpaceScale = zoomScale;
        const finalScale = data.baseScale * zoomScale;
        data.mesh.scale.setScalar(finalScale);
      }
    }
  }

  /**
   * Set opacity for all meshes (for visibility toggle)
   */
  setOpacity(opacity: number): void {
    for (const data of this.meshes.values()) {
      data.opacity = opacity;
      data.mesh.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh;
          if (mesh.material) {
            const mat = mesh.material as THREE.MeshStandardMaterial;
            if (mat.opacity !== undefined) {
              mat.opacity = opacity;
              mat.transparent = opacity < 1;
            }
          }
        }
      });
    }
  }

  /**
   * Get number of active meshes
   */
  getMeshCount(): number {
    return this.meshes.size;
  }

  /**
   * Clear all meshes
   */
  clear(): void {
    for (const data of this.meshes.values()) {
      this.scene.remove(data.mesh);
    }
    this.meshes.clear();
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    this.clear();
  }
}
