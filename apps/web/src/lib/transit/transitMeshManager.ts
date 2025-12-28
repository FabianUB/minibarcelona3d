/**
 * Transit Vehicle Mesh Manager
 *
 * Simplified mesh manager for Metro and Bus vehicles.
 * Handles 3D model creation, positioning, and animation.
 *
 * Based on TrainMeshManager patterns but simplified for schedule-based positioning.
 */

import * as THREE from 'three';
import type { VehiclePosition, TransportType } from '../../types/transit';
import { getCachedModel, loadTrainModel } from '../trains/modelLoader';
import { ScaleManager } from '../trains/scaleManager';
import { getModelPosition, getModelScale } from '../map/coordinates';
import { VehicleAnimationManager } from './scheduleInterpolator';

/**
 * Mesh data stored for each vehicle
 */
interface TransitMeshData {
  mesh: THREE.Group;
  vehicleKey: string;
  lineCode: string;
  networkType: TransportType;
  currentPosition: [number, number];
  targetPosition: [number, number];
  currentBearing: number;
  targetBearing: number;
  lastUpdate: number;
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
  /** Interpolation duration in ms (default: 4500) */
  interpolationDurationMs?: number;
}

const DEFAULT_CONFIG: Required<TransitMeshManagerConfig> = {
  vehicleSizeMeters: 25,
  modelType: 'civia',
  zOffsetFactor: 0.5,
  interpolationDurationMs: 4500,
};

/**
 * TransitMeshManager
 *
 * Manages 3D vehicle meshes for transit systems.
 * Simplified from TrainMeshManager for schedule-based positioning.
 */
export class TransitMeshManager {
  private meshes: Map<string, TransitMeshData> = new Map();
  private scene: THREE.Scene;
  private config: Required<TransitMeshManagerConfig>;
  private scaleManager: ScaleManager;
  private animationManager: VehicleAnimationManager;
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
    this.animationManager = new VehicleAnimationManager(
      this.config.interpolationDurationMs
    );
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
   * Update vehicle meshes from position data
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

      // Update animation target
      this.animationManager.updateTarget(
        vehicle.vehicleKey,
        [vehicle.longitude, vehicle.latitude],
        vehicle.bearing
      );

      const existingMesh = this.meshes.get(vehicle.vehicleKey);

      if (existingMesh) {
        // Update existing mesh target
        existingMesh.targetPosition = [vehicle.longitude, vehicle.latitude];
        existingMesh.targetBearing = vehicle.bearing;
        existingMesh.lastUpdate = now;
      } else {
        // Create new mesh
        this.createMesh(vehicle, now);
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
  private createMesh(vehicle: VehiclePosition, now: number): void {
    const gltf = getCachedModel(this.config.modelType);
    if (!gltf) {
      console.warn(`[TransitMeshManager] Model ${this.config.modelType} not in cache, cannot create mesh`);
      return;
    }

    // Clone the model
    const trainModel = gltf.scene.clone();

    // Create a parent group to handle rotation properly
    // This allows us to separate "lay flat" rotation from "direction" rotation
    const mesh = new THREE.Group();

    // First, rotate the model to lay flat on the map (XY plane)
    // The models are oriented with Z-up; rotating +90° around X keeps the roof up
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

    // Set rotation based on bearing (applied to parent group's Z-axis)
    this.applyBearing(mesh, vehicle.bearing);

    // Apply line color to the model
    const lineColor = new THREE.Color(vehicle.lineColor);
    this.applyLineColor(trainModel, lineColor);

    // Add to scene
    this.scene.add(mesh);

    // Store mesh data
    this.meshes.set(vehicle.vehicleKey, {
      mesh,
      vehicleKey: vehicle.vehicleKey,
      lineCode: vehicle.lineCode,
      networkType: vehicle.networkType,
      currentPosition: [vehicle.longitude, vehicle.latitude],
      targetPosition: [vehicle.longitude, vehicle.latitude],
      currentBearing: vehicle.bearing,
      targetBearing: vehicle.bearing,
      lastUpdate: now,
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
    // Convert bearing to radians (bearing is clockwise from north, Three.js is CCW)
    const bearingRad = (bearing * Math.PI) / 180;
    // Apply rotation with model offset
    mesh.rotation.z = -bearingRad + this.MODEL_FORWARD_OFFSET;
  }

  /**
   * Apply line color to the train model materials
   * Colors the entire model with the metro line's brand color
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
            // Clone the material to avoid affecting other instances
            const clonedMaterial = material.clone();
            (clonedMaterial as THREE.MeshStandardMaterial).color = color;
            // Ensure the material responds to lighting
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

    // Also prune animation manager
    this.animationManager.pruneExcept(activeKeys);
  }

  /**
   * Animate mesh positions (call every frame)
   */
  animatePositions(): void {
    const now = Date.now();
    const zoomScale = this.scaleManager.computeScale(this.currentZoom);

    for (const [vehicleKey, data] of this.meshes) {
      // Get interpolated state
      const interpolated = this.animationManager.getInterpolatedState(
        vehicleKey,
        now
      );

      if (interpolated) {
        // Update position
        const pos = getModelPosition(
          interpolated.position[0],
          interpolated.position[1],
          0
        );
        data.mesh.position.set(
          pos.x,
          pos.y,
          pos.z + this.config.zOffsetFactor * data.baseScale
        );

        // Update bearing
        this.applyBearing(data.mesh, interpolated.bearing);

        // Update current state
        data.currentPosition = interpolated.position;
        data.currentBearing = interpolated.bearing;
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
    this.animationManager.clear();
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    this.clear();
  }
}
