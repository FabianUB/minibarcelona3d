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
import { sampleRailwayPosition, snapTrainToRailway } from '../trains/geometry';
import { getCachedModel, loadTrainModel } from '../trains/modelLoader';
import { ScaleManager } from '../trains/scaleManager';
import { getModelPosition, getModelScale, getLngLatFromModelPosition } from '../map/coordinates';
import { getPreprocessedMetroLine } from '../metro/positionSimulator';
import { getPreprocessedBusRoute } from '../bus/positionSimulator';
import { getPreprocessedFgcLine } from '../fgc/positionSimulator';
import { getPreprocessedTramLine } from '../tram/positionSimulator';
import { createOutlineMesh } from '../trains/outlineManager';

/**
 * Screen-space candidate for click/hover detection
 */
export interface ScreenSpaceCandidate {
  vehicleKey: string;
  lineCode: string;
  networkType: TransportType;
  screenPoint: { x: number; y: number };
  radiusPx: number;
}

/**
 * Mesh data stored for each vehicle - includes continuous motion parameters
 */
interface TransitMeshData {
  mesh: THREE.Group;
  vehicleKey: string;
  lineCode: string;
  networkType: TransportType;
  direction: TravelDirection;

  // Animation mode: 'continuous' uses speed/distance, 'lerp' uses position interpolation
  animationMode: 'continuous' | 'lerp';

  // Continuous motion parameters (used when animationMode='continuous')
  referenceDistance: number;    // Distance along line at referenceTime
  referenceTime: number;        // When this position was established
  speedMetersPerSecond: number; // Vehicle speed
  lineTotalLength: number;      // For wrapping around

  // Lerp animation parameters (used when animationMode='lerp')
  targetPosition: [number, number];
  targetBearing: number;
  lerpStartPosition: [number, number];
  lerpStartBearing: number;
  lerpStartTime: number;
  lerpDuration: number;  // ms

  // Current state
  currentPosition: [number, number];
  currentBearing: number;

  // Visual
  baseScale: number;
  screenSpaceScale: number;
  lineColor: THREE.Color;
  opacity: number;

  // Outline for hover effect
  outlineMesh?: THREE.Group;
}

/**
 * Configuration for TransitMeshManager
 */
export interface TransitMeshManagerConfig {
  /** Vehicle size in meters (default: 25 for metro/trains) */
  vehicleSizeMeters?: number;
  /** Model type to use */
  modelType?: 'metro' | 'bus' | 'tram' | 'civia';
  /** Z offset factor for elevation (default: 0.5) */
  zOffsetFactor?: number;
}

const DEFAULT_CONFIG: Required<TransitMeshManagerConfig> = {
  vehicleSizeMeters: 25,
  modelType: 'metro',
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
  private highlightedVehicleKey: string | null = null;

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
    switch (networkType) {
      case 'metro':
        return getPreprocessedMetroLine(lineCode);
      case 'bus':
        return getPreprocessedBusRoute(lineCode);
      case 'fgc':
        return getPreprocessedFgcLine(lineCode);
      case 'tram':
        return getPreprocessedTramLine(lineCode);
      default:
        return null;
    }
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
   * Lerp animation duration in ms (matches 30s polling interval)
   * Vehicles animate smoothly over the entire interval between position updates
   */
  private static readonly LERP_DURATION_MS = 30000;

  /**
   * Determine which animation mode to use based on available data
   */
  private getAnimationMode(vehicle: VehiclePosition): 'continuous' | 'lerp' {
    // Use continuous mode if we have valid motion parameters
    // distanceAlongLine > 0 required because some APIs return 0 as "not provided"
    const hasMotionParams =
      vehicle.speedMetersPerSecond > 0 &&
      vehicle.lineTotalLength > 0 &&
      vehicle.distanceAlongLine > 0;

    return hasMotionParams ? 'continuous' : 'lerp';
  }

  /**
   * Update vehicle meshes from position data.
   *
   * Supports two animation modes:
   * - continuous: Uses speed/distance for smooth motion (requires line geometry)
   * - lerp: Simple position interpolation (for schedule-based positions)
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
      const animationMode = this.getAnimationMode(vehicle);

      if (existingMesh) {
        if (animationMode === 'continuous') {
          // Continuous motion mode - use speed and distance
          const newRawDistance = this.toRawAnimationDistance(
            vehicle.distanceAlongLine,
            vehicle.direction,
            vehicle.lineTotalLength
          );

          const currentRawDistance = this.getCurrentRawDistance(existingMesh, now);

          if (this.wouldMoveBackward(currentRawDistance, newRawDistance, existingMesh.lineTotalLength)) {
            existingMesh.referenceDistance = currentRawDistance;
            existingMesh.referenceTime = now;
          } else {
            existingMesh.referenceDistance = newRawDistance;
            existingMesh.referenceTime = vehicle.estimatedAt;
          }

          existingMesh.speedMetersPerSecond = vehicle.speedMetersPerSecond;
          existingMesh.lineTotalLength = vehicle.lineTotalLength;
          existingMesh.animationMode = 'continuous';
        } else {
          // Lerp mode - interpolate between current and target position
          // Save current position as lerp start
          existingMesh.lerpStartPosition = [...existingMesh.currentPosition] as [number, number];
          existingMesh.lerpStartBearing = existingMesh.currentBearing;
          existingMesh.lerpStartTime = now;
          existingMesh.lerpDuration = TransitMeshManager.LERP_DURATION_MS;

          // Set new target position
          existingMesh.targetPosition = [vehicle.longitude, vehicle.latitude];
          existingMesh.targetBearing = vehicle.bearing;
          existingMesh.animationMode = 'lerp';
        }
      } else {
        // Create new mesh
        this.createMesh(vehicle, animationMode);
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
  private createMesh(vehicle: VehiclePosition, animationMode: 'continuous' | 'lerp'): void {
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

    // Parse line color (used for outlines and stored in mesh data)
    // Ensure color has # prefix for THREE.Color
    const colorHex = vehicle.lineColor.startsWith('#') ? vehicle.lineColor : `#${vehicle.lineColor}`;
    const lineColor = new THREE.Color(colorHex);

    // Apply line color to the model (skip for metro - uses original model appearance)
    if (vehicle.networkType !== 'metro') {
      this.applyLineColor(trainModel, lineColor);
    }

    // Add to scene
    this.scene.add(mesh);

    // Convert to raw animation distance for consistent forward movement
    const rawDistance = this.toRawAnimationDistance(
      vehicle.distanceAlongLine,
      vehicle.direction,
      vehicle.lineTotalLength
    );

    const now = Date.now();
    const currentPos: [number, number] = [vehicle.longitude, vehicle.latitude];

    // Store mesh data with appropriate animation parameters
    this.meshes.set(vehicle.vehicleKey, {
      mesh,
      vehicleKey: vehicle.vehicleKey,
      lineCode: vehicle.lineCode,
      networkType: vehicle.networkType,
      direction: vehicle.direction,

      // Animation mode
      animationMode,

      // Continuous motion parameters
      referenceDistance: rawDistance,
      referenceTime: vehicle.estimatedAt,
      speedMetersPerSecond: vehicle.speedMetersPerSecond,
      lineTotalLength: vehicle.lineTotalLength,

      // Lerp animation parameters (initialize to current position)
      targetPosition: currentPos,
      targetBearing: vehicle.bearing,
      lerpStartPosition: currentPos,
      lerpStartBearing: vehicle.bearing,
      lerpStartTime: now,
      lerpDuration: TransitMeshManager.LERP_DURATION_MS,

      // Current state
      currentPosition: currentPos,
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
   * Only applies to bus/tram/fgc - metro keeps its original appearance
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

        // Clear highlighted key if this vehicle is removed
        if (this.highlightedVehicleKey === key) {
          this.highlightedVehicleKey = null;
        }
      }
    }

    for (const key of toRemove) {
      this.meshes.delete(key);
    }
  }

  /**
   * Animate mesh positions (call every frame)
   *
   * Supports two modes:
   * - continuous: Calculates position based on speed and elapsed time
   * - lerp: Interpolates between start and target position
   */
  animatePositions(): void {
    const now = Date.now();
    const zoomScale = this.scaleManager.computeScale(this.currentZoom);

    for (const [, data] of this.meshes) {
      if (data.animationMode === 'continuous') {
        // Continuous motion mode - calculate position from speed and time
        this.animateContinuous(data, now);
      } else {
        // Lerp mode - interpolate between positions
        this.animateLerp(data, now);
      }

      // Apply zoom-responsive scale if changed
      if (data.screenSpaceScale !== zoomScale) {
        data.screenSpaceScale = zoomScale;
        const finalScale = data.baseScale * zoomScale;

        // Maintain highlight scale if this vehicle is highlighted
        const isHighlighted = this.highlightedVehicleKey === data.vehicleKey;
        const scaleToApply = isHighlighted ? finalScale * 1.12 : finalScale;
        data.mesh.scale.setScalar(scaleToApply);
      }
    }
  }

  /**
   * Animate using continuous motion (speed-based)
   */
  private animateContinuous(data: TransitMeshData, now: number): void {
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
  }

  /**
   * Animate using lerp interpolation (position-based)
   *
   * For bus routes, snaps the interpolated position to the route geometry
   * to ensure vehicles follow their designated routes instead of straight lines.
   */
  private animateLerp(data: TransitMeshData, now: number): void {
    const elapsed = now - data.lerpStartTime;
    const t = Math.min(elapsed / data.lerpDuration, 1);

    // Smooth easing function (ease-out cubic)
    const eased = 1 - Math.pow(1 - t, 3);

    // Interpolate position (raw GPS interpolation)
    let lng = data.lerpStartPosition[0] + (data.targetPosition[0] - data.lerpStartPosition[0]) * eased;
    let lat = data.lerpStartPosition[1] + (data.targetPosition[1] - data.lerpStartPosition[1]) * eased;

    // Interpolate bearing (handle wrap-around)
    let bearingDiff = data.targetBearing - data.lerpStartBearing;
    if (bearingDiff > 180) bearingDiff -= 360;
    if (bearingDiff < -180) bearingDiff += 360;
    let bearing = data.lerpStartBearing + bearingDiff * eased;

    // Try to snap position to route geometry (for bus routes)
    // This ensures vehicles follow their routes instead of moving in straight lines
    const geometry = this.getGeometry(data.networkType, data.lineCode);
    if (geometry) {
      const snapResult = snapTrainToRailway([lng, lat], geometry, 500); // 500m max snap distance
      if (snapResult) {
        lng = snapResult.position[0];
        lat = snapResult.position[1];
        // Use snapped bearing for smoother rotation along the route
        bearing = data.direction === 1 ? (snapResult.bearing + 180) % 360 : snapResult.bearing;
      }
    }

    // Update position
    const pos = getModelPosition(lng, lat, 0);
    data.mesh.position.set(
      pos.x,
      pos.y,
      pos.z + this.config.zOffsetFactor * data.baseScale
    );

    // Update bearing
    this.applyBearing(data.mesh, bearing);

    // Update current state
    data.currentPosition = [lng, lat];
    data.currentBearing = bearing;
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
   * Set opacity for multiple vehicles based on line selection
   * Used for highlight/isolate mode to show only selected lines
   *
   * @param opacities - Map of vehicleKey to opacity (0.0 - 1.0)
   */
  setVehicleOpacities(opacities: Map<string, number>): void {
    opacities.forEach((opacity, vehicleKey) => {
      const data = this.meshes.get(vehicleKey);
      if (!data) return;

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
    });
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
   * Get screen-space candidates for click/hover detection.
   * Projects vehicle positions to screen coordinates.
   */
  getScreenCandidates(map: mapboxgl.Map): ScreenSpaceCandidate[] {
    const candidates: ScreenSpaceCandidate[] = [];

    for (const [, data] of this.meshes) {
      const { mesh, vehicleKey, lineCode, networkType } = data;

      // Get lng/lat from mesh position
      const centerLngLat = getLngLatFromModelPosition(
        mesh.position.x,
        mesh.position.y,
        mesh.position.z
      );

      // Project to screen coordinates
      const centerPoint = map.project(centerLngLat);

      // Calculate screen radius from scale
      const currentScale = mesh.scale.x;
      const worldRadius = currentScale * 0.5; // Approximate radius

      // Project edge point to get screen radius
      const edgeLngLat = getLngLatFromModelPosition(
        mesh.position.x + worldRadius,
        mesh.position.y,
        mesh.position.z
      );
      const edgePoint = map.project(edgeLngLat);

      // Calculate pixel radius
      const dx = edgePoint.x - centerPoint.x;
      const dy = edgePoint.y - centerPoint.y;
      const radiusPx = Math.max(Math.hypot(dx, dy), 10);

      candidates.push({
        vehicleKey,
        lineCode,
        networkType,
        screenPoint: { x: centerPoint.x, y: centerPoint.y },
        radiusPx,
      });
    }

    return candidates;
  }

  /**
   * Get vehicle data by key (for retrieving clicked vehicle info)
   */
  getVehicleData(vehicleKey: string): TransitMeshData | null {
    return this.meshes.get(vehicleKey) ?? null;
  }

  /**
   * Set highlighted vehicle (12% scale increase on hover)
   */
  setHighlightedVehicle(vehicleKey?: string): void {
    const nextKey = vehicleKey ?? null;
    if (this.highlightedVehicleKey === nextKey) {
      return;
    }

    // Restore previous highlighted vehicle to normal scale
    if (this.highlightedVehicleKey) {
      const prev = this.meshes.get(this.highlightedVehicleKey);
      if (prev) {
        const normalScale = prev.baseScale * prev.screenSpaceScale;
        prev.mesh.scale.setScalar(normalScale);
      }
    }

    this.highlightedVehicleKey = nextKey;

    // Apply highlight scale to new vehicle
    if (nextKey) {
      const next = this.meshes.get(nextKey);
      if (next) {
        const normalScale = next.baseScale * next.screenSpaceScale;
        const highlightScale = normalScale * 1.12;
        next.mesh.scale.setScalar(highlightScale);
      }
    }
  }

  /**
   * Show hover outline for a vehicle
   * Creates outline mesh lazily on first hover
   */
  showOutline(vehicleKey: string): void {
    const meshData = this.meshes.get(vehicleKey);
    if (!meshData) return;

    // Lazy creation: create outline on first hover
    if (!meshData.outlineMesh) {
      // Find the model child (the rotated child inside the parent Group)
      let modelChild: THREE.Object3D | null = null;
      meshData.mesh.traverse((child) => {
        if (child !== meshData.mesh && child instanceof THREE.Group && !modelChild) {
          modelChild = child;
        }
      });

      // Compute zoom-responsive outline scale factor
      const zoom = this.currentZoom;
      const scaleFactor = zoom < 15 ? 1.08 : 1.04;

      // Create outline mesh from the model with zoom-adjusted scale
      const targetMesh = modelChild ?? meshData.mesh;
      const outlineMesh = createOutlineMesh(
        targetMesh as THREE.Group,
        meshData.lineColor,
        scaleFactor
      );
      targetMesh.add(outlineMesh);

      // Store for future use
      meshData.outlineMesh = outlineMesh;
    }

    // Show outline
    if (meshData.outlineMesh) {
      meshData.outlineMesh.visible = true;
    }
  }

  /**
   * Hide hover outline for a vehicle
   */
  hideOutline(vehicleKey: string): void {
    const meshData = this.meshes.get(vehicleKey);
    if (!meshData || !meshData.outlineMesh) return;

    meshData.outlineMesh.visible = false;
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    this.clear();
  }
}
