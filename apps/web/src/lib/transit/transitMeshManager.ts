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
 * Uses Oriented Bounding Rectangle (OBR) for accurate hit detection on elongated vehicles
 */
export interface ScreenSpaceCandidate {
  vehicleKey: string;
  lineCode: string;
  networkType: TransportType;
  screenPoint: { x: number; y: number };
  radiusPx: number; // Keep for fallback/minimum threshold
  orientedRect: {
    halfWidthPx: number;   // Half-width in screen pixels (perpendicular to vehicle direction)
    halfLengthPx: number;  // Half-length in screen pixels (along vehicle direction)
    rotation: number;      // Screen-space rotation in radians
  };
}

// Pooled Vector3 instances reused in getScreenCandidates to avoid per-call GC pressure
const _poolLocalX = new THREE.Vector3();
const _poolLocalY = new THREE.Vector3();

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

  // Pre-computed snapped path for lerp mode (avoids per-frame snapping)
  precomputedSnap?: {
    startDistance: number;
    endDistance: number;
    startBearing: number;
    endBearing: number;
    hasValidSnap: boolean;
  };

  // Current state
  currentPosition: [number, number];
  currentBearing: number;

  // Visual
  baseScale: number;
  screenSpaceScale: number;
  lineColor: THREE.Color;
  opacity: number;

  // Bounding box half-extents for OBR hit detection (in model units before scaling)
  boundingHalfExtents: THREE.Vector3;

  // Outline for hover effect
  outlineMesh?: THREE.Group;

  // Performance: Cached material references to avoid mesh traversal
  cachedMaterials: THREE.Material[];

  // LOD (Level of Detail) references
  detailedModel?: THREE.Object3D; // The 3D model (hidden at low zoom)
  lodSprite?: THREE.Sprite;       // Simple sprite (shown at low zoom)
  isLowLOD: boolean;              // Current LOD state
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
  /** Zoom level below which to use simple LOD sprites (default: 13) */
  lodThreshold?: number;
  /** Spread distance in meters along the line to separate overlapping vehicles (default: 30 for buses) */
  spreadDistanceMeters?: number;
}

const DEFAULT_CONFIG: Required<TransitMeshManagerConfig> = {
  vehicleSizeMeters: 25,
  modelType: 'metro',
  zOffsetFactor: 0.5,
  lodThreshold: 13,
  spreadDistanceMeters: 50, // Spread overlapping vehicles along the line by up to 50 meters
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
  private currentLODState: 'high' | 'low' = 'high';
  private userScale = 1.0;

  // Rotation offset: models face -X, we need them to face bearing direction
  private readonly MODEL_FORWARD_OFFSET = Math.PI;

  // Cached LOD sprite texture (shared across all sprites for efficiency)
  private lodSpriteTexture: THREE.Texture | null = null;

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
   * Calculate a longitudinal offset for a vehicle to spread out overlapping vehicles.
   * Uses a hash of the vehicle key to get a consistent offset value.
   * Returns an offset in meters along the line direction.
   *
   * This helps visually separate buses/trains that are at the same stop or bunched together,
   * making them easier to distinguish and click on.
   */
  private calculateLongitudinalOffset(vehicleKey: string): number {
    // Simple hash function to get a consistent value from the vehicle key
    let hash = 0;
    for (let i = 0; i < vehicleKey.length; i++) {
      const char = vehicleKey.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    // Convert hash to a value between 0 and 1 (positive only for consistent direction)
    const normalizedHash = Math.abs(hash % 1000) / 1000;

    // Scale by the configured spread distance
    return normalizedHash * this.config.spreadDistanceMeters;
  }

  /**
   * Create or get the shared LOD sprite texture
   * Uses a simple colored circle for efficiency
   */
  private getLodSpriteTexture(): THREE.Texture {
    if (this.lodSpriteTexture) {
      return this.lodSpriteTexture;
    }

    // Create a simple circular sprite texture
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d')!;

    // Draw a filled circle with a white border
    ctx.beginPath();
    ctx.arc(16, 16, 14, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 2;
    ctx.stroke();

    this.lodSpriteTexture = new THREE.CanvasTexture(canvas);
    return this.lodSpriteTexture;
  }

  /**
   * Create a LOD sprite for a vehicle
   */
  private createLodSprite(lineColor: THREE.Color, baseScale: number): THREE.Sprite {
    const material = new THREE.SpriteMaterial({
      map: this.getLodSpriteTexture(),
      color: lineColor,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });

    const sprite = new THREE.Sprite(material);
    // Scale sprite to approximate vehicle size
    const spriteSize = baseScale * 0.5; // Smaller than 3D model
    sprite.scale.set(spriteSize, spriteSize, 1);
    sprite.visible = false; // Start hidden (high LOD by default)

    return sprite;
  }

  /**
   * Update LOD state based on current zoom
   * Called during animation to toggle between detailed and simple representations
   */
  private updateLODState(): void {
    const shouldBeLowLOD = this.currentZoom < this.config.lodThreshold;
    const newState = shouldBeLowLOD ? 'low' : 'high';

    if (newState === this.currentLODState) {
      return; // No change needed
    }

    this.currentLODState = newState;

    // Toggle visibility for all meshes
    for (const data of this.meshes.values()) {
      if (data.detailedModel && data.lodSprite) {
        data.detailedModel.visible = !shouldBeLowLOD;
        data.lodSprite.visible = shouldBeLowLOD;
        data.isLowLOD = shouldBeLowLOD;
      }
    }

    console.log(`[TransitMeshManager] LOD switched to ${newState} (zoom: ${this.currentZoom.toFixed(1)})`);
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
   * Get the set of vehicle keys that currently have meshes
   */
  getActiveVehicleKeys(): Set<string> {
    return new Set(this.meshes.keys());
  }

  /**
   * Get current position of a vehicle mesh (for click-to-zoom)
   * Returns [lng, lat] or null if mesh doesn't exist
   */
  getVehiclePosition(vehicleKey: string): [number, number] | null {
    const data = this.meshes.get(vehicleKey);
    if (!data || !data.currentPosition) {
      return null;
    }
    return data.currentPosition;
  }

  /**
   * Get all current vehicle positions (for debugging/comparison)
   */
  getAllVehiclePositions(): Map<string, [number, number]> {
    const positions = new Map<string, [number, number]>();
    for (const [key, data] of this.meshes) {
      if (data.currentPosition) {
        positions.set(key, data.currentPosition);
      }
    }
    return positions;
  }

  /**
   * Update current zoom level for scale calculations
   */
  setZoom(zoom: number): void {
    this.currentZoom = zoom;
  }

  /**
   * Set user-controlled model scale multiplier.
   * Dynamically rescales all existing meshes without recreating the layer.
   */
  setUserScale(scale: number): void {
    const clamped = Math.max(0.5, Math.min(2.0, scale));
    if (this.userScale === clamped) return;
    this.userScale = clamped;
    // Recalculate baseScale and apply to every mesh
    const modelScale = getModelScale();
    const newBase = modelScale * this.config.vehicleSizeMeters * this.userScale;
    for (const [, data] of this.meshes) {
      data.baseScale = newBase;
      const finalScale = newBase * data.screenSpaceScale;
      const isHighlighted = this.highlightedVehicleKey === data.vehicleKey;
      data.mesh.scale.setScalar(isHighlighted ? finalScale * 1.12 : finalScale);
    }
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
    // Guard against division/modulo by zero which produces NaN
    if (data.lineTotalLength <= 0) {
      return data.referenceDistance;
    }
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
    // Guard against division/modulo by zero
    if (totalLength <= 0) {
      return false; // Can't determine direction, allow update
    }

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
   * Default speed for schedule-based vehicles (meters per second)
   * Used when progressFraction is available but speed is not
   * ~25 km/h average for urban transit (bus, tram)
   */
  private static readonly DEFAULT_TRANSIT_SPEED_MPS = 7;

  /**
   * Derive motion parameters from progressFraction and geometry
   * Returns null if parameters cannot be derived
   */
  private deriveMotionParams(
    vehicle: VehiclePosition
  ): { distanceAlongLine: number; lineTotalLength: number; speedMetersPerSecond: number } | null {
    // Need progressFraction to derive position
    // Note: progressFraction === 0 is VALID (vehicle at start of route)
    // Only reject if negative (invalid value)
    if (vehicle.progressFraction < 0) {
      return null;
    }

    // Get geometry for this vehicle's route
    const geometry = this.getGeometry(vehicle.networkType, vehicle.lineCode);
    if (!geometry || geometry.totalLength <= 0) {
      return null;
    }

    const lineTotalLength = geometry.totalLength;
    // progressFraction of 0 means at the start, which is valid
    const distanceAlongLine = vehicle.progressFraction * lineTotalLength;
    const speedMetersPerSecond = TransitMeshManager.DEFAULT_TRANSIT_SPEED_MPS;

    return { distanceAlongLine, lineTotalLength, speedMetersPerSecond };
  }

  /**
   * Determine which animation mode to use based on available data
   */
  private getAnimationMode(vehicle: VehiclePosition): 'continuous' | 'lerp' {
    // Continuous mode requires line geometry to sample positions along the path
    const geometry = this.getGeometry(vehicle.networkType, vehicle.lineCode);
    if (!geometry || geometry.totalLength <= 0) {
      return 'lerp';
    }

    // Use continuous mode if we have valid motion parameters
    // distanceAlongLine > 0 required because some APIs return 0 as "not provided"
    const hasMotionParams =
      vehicle.speedMetersPerSecond > 0 &&
      vehicle.lineTotalLength > 0 &&
      vehicle.distanceAlongLine > 0;

    if (hasMotionParams) {
      return 'continuous';
    }

    // Try to derive motion params from progressFraction
    const derived = this.deriveMotionParams(vehicle);
    if (derived) {
      return 'continuous';
    }

    return 'lerp';
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
          // Use derived params if vehicle's motion params are missing
          const derivedParams = vehicle.distanceAlongLine > 0 ? null : this.deriveMotionParams(vehicle);
          const distanceAlongLine = derivedParams?.distanceAlongLine ?? vehicle.distanceAlongLine;
          const lineTotalLength = derivedParams?.lineTotalLength ?? vehicle.lineTotalLength;
          const speedMetersPerSecond = derivedParams?.speedMetersPerSecond ?? vehicle.speedMetersPerSecond;

          // IMPORTANT: Update lineTotalLength BEFORE using it in calculations
          // This fixes the bug when switching from 'lerp' to 'continuous' mode
          // where the old lineTotalLength (0) would cause NaN in modulo operations
          existingMesh.lineTotalLength = lineTotalLength;
          existingMesh.speedMetersPerSecond = speedMetersPerSecond;

          const newRawDistance = this.toRawAnimationDistance(
            distanceAlongLine,
            vehicle.direction,
            lineTotalLength
          );

          const currentRawDistance = this.getCurrentRawDistance(existingMesh, now);

          if (this.wouldMoveBackward(currentRawDistance, newRawDistance, lineTotalLength)) {
            existingMesh.referenceDistance = currentRawDistance;
            existingMesh.referenceTime = now;
          } else {
            existingMesh.referenceDistance = newRawDistance;
            existingMesh.referenceTime = vehicle.estimatedAt;
          }

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

          // Pre-compute snapped path once (avoids per-frame snapping)
          const geometry = this.getGeometry(vehicle.networkType, vehicle.lineCode);
          if (geometry) {
            const snapStart = snapTrainToRailway(existingMesh.lerpStartPosition, geometry, 500);
            const snapEnd = snapTrainToRailway(existingMesh.targetPosition, geometry, 500);
            if (snapStart && snapEnd) {
              existingMesh.precomputedSnap = {
                startDistance: snapStart.distance,
                endDistance: snapEnd.distance,
                startBearing: snapStart.bearing,
                endBearing: snapEnd.bearing,
                hasValidSnap: true,
              };
            } else {
              existingMesh.precomputedSnap = undefined;
            }
          } else {
            existingMesh.precomputedSnap = undefined;
          }
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

    // Compute bounding box BEFORE rotation for accurate half-extents
    // The model's natural orientation determines which axis is length vs width
    const boundingBox = new THREE.Box3().setFromObject(trainModel);
    const size = new THREE.Vector3();
    boundingBox.getSize(size);
    // Store half-extents (will be scaled by mesh.scale later)
    // For transit vehicles: X is typically length, Y is width, Z is height
    const boundingHalfExtents = new THREE.Vector3(size.x / 2, size.y / 2, size.z / 2);

    // Create a parent group to handle rotation properly
    const mesh = new THREE.Group();

    // Rotate the model to lay flat on the map (XY plane)
    trainModel.rotation.x = Math.PI / 2;

    // Add the rotated model to the parent group
    mesh.add(trainModel);

    // Calculate base scale (includes user scale multiplier)
    const modelScale = getModelScale();
    const baseScale = modelScale * this.config.vehicleSizeMeters * this.userScale;

    // Apply scale to parent group
    mesh.scale.setScalar(baseScale);

    // Parse line color early for LOD sprite
    const colorHex = vehicle.lineColor.startsWith('#') ? vehicle.lineColor : `#${vehicle.lineColor}`;
    const lineColor = new THREE.Color(colorHex);

    // Create LOD sprite (simpler representation for low zoom)
    const lodSprite = this.createLodSprite(lineColor, baseScale);
    mesh.add(lodSprite);

    // Set initial LOD state
    const isLowLOD = this.currentZoom < this.config.lodThreshold;
    trainModel.visible = !isLowLOD;
    lodSprite.visible = isLowLOD;

    // Set initial position
    const pos = getModelPosition(vehicle.longitude, vehicle.latitude, 0);
    mesh.position.set(pos.x, pos.y, pos.z + this.config.zOffsetFactor * baseScale);

    // Set rotation based on bearing
    this.applyBearing(mesh, vehicle.bearing);

    // Clone materials for each mesh to ensure independent opacity control.
    // This prevents layers sharing the same model type (e.g., FGC and Metro both use 'metro')
    // from sharing material references - setting opacity on one would affect the other.
    // Also ensures explicit depth buffer settings for consistent rendering across GPUs.
    const cachedMaterials: THREE.Material[] = [];
    mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const configureMaterial = (m: THREE.Material): THREE.Material => {
          const cloned = m.clone();
          // Explicit depth settings to ensure vehicles render on top of map layers
          // This fixes z-fighting issues that occur on some GPUs/drivers
          cloned.depthTest = true;
          cloned.depthWrite = true;
          // Polygon offset shifts depth values to prevent z-fighting with Mapbox layers
          // Negative values push geometry "closer" to camera in depth buffer
          // Using -2 as middle ground: -1 wasn't enough on some GPUs, -4 caused visual issues
          cloned.polygonOffset = true;
          cloned.polygonOffsetFactor = -2;
          cloned.polygonOffsetUnits = -2;
          return cloned;
        };

        if (Array.isArray(child.material)) {
          child.material = child.material.map(configureMaterial);
          cachedMaterials.push(...child.material);
        } else if (child.material) {
          child.material = configureMaterial(child.material);
          cachedMaterials.push(child.material);
        }
      }
    });

    // Add to scene
    this.scene.add(mesh);

    // For continuous mode, derive motion params if API values are missing (0)
    // This is critical for schedule-based vehicles where API returns 0 for these fields
    let distanceAlongLine = vehicle.distanceAlongLine;
    let speedMetersPerSecond = vehicle.speedMetersPerSecond;
    let lineTotalLength = vehicle.lineTotalLength;

    if (animationMode === 'continuous' && vehicle.distanceAlongLine <= 0) {
      const derivedParams = this.deriveMotionParams(vehicle);
      if (derivedParams) {
        distanceAlongLine = derivedParams.distanceAlongLine;
        speedMetersPerSecond = derivedParams.speedMetersPerSecond;
        lineTotalLength = derivedParams.lineTotalLength;
      }
    }

    // Convert to raw animation distance for consistent forward movement
    const rawDistance = this.toRawAnimationDistance(
      distanceAlongLine,
      vehicle.direction,
      lineTotalLength
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
      speedMetersPerSecond: speedMetersPerSecond,
      lineTotalLength: lineTotalLength,

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

      // Bounding box half-extents for OBR hit detection
      boundingHalfExtents,

      // Performance: Cache materials for fast opacity updates
      cachedMaterials,

      // LOD references
      detailedModel: trainModel,
      lodSprite,
      isLowLOD,
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
   * Remove meshes for inactive vehicles
   */
  private pruneInactiveVehicles(activeKeys: Set<string>): void {
    const toRemove: string[] = [];

    for (const [key, data] of this.meshes) {
      if (!activeKeys.has(key)) {
        this.disposeMesh(data);
        this.scene.remove(data.mesh);
        toRemove.push(key);

        if (this.highlightedVehicleKey === key) {
          this.highlightedVehicleKey = null;
        }
      }
    }

    for (const key of toRemove) {
      this.meshes.delete(key);
    }
  }

  private disposeMesh(data: TransitMeshData): void {
    // Dispose outline mesh if present
    if (data.outlineMesh) {
      if (data.outlineMesh.parent) {
        data.outlineMesh.parent.remove(data.outlineMesh);
      }
      data.outlineMesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((mat) => mat.dispose());
          } else {
            child.material?.dispose();
          }
        }
      });
    }

    // Dispose geometry and materials to free GPU memory
    data.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((mat) => mat.dispose());
        } else {
          child.material?.dispose();
        }
      }
    });
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

    // Update LOD state based on current zoom (toggles between detailed and simple)
    this.updateLODState();

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
    // Get line geometry to sample position - must have geometry for continuous mode
    const geometry = this.getGeometry(data.networkType, data.lineCode);
    if (!geometry || geometry.totalLength <= 0) {
      return;
    }

    // Guard against invalid lineTotalLength (would cause NaN from modulo)
    if (data.lineTotalLength <= 0) {
      // Use geometry's total length as fallback
      data.lineTotalLength = geometry.totalLength;
    }

    // Calculate current distance based on elapsed time
    const elapsedSeconds = (now - data.referenceTime) / 1000;
    const distanceTraveled = elapsedSeconds * data.speedMetersPerSecond;

    // Calculate current distance along line (with wrapping)
    let currentDistance = (data.referenceDistance + distanceTraveled) % data.lineTotalLength;

    // Apply longitudinal offset to spread overlapping vehicles along the line
    // This is added BEFORE the direction mirroring so vehicles spread consistently
    const spreadOffset = this.calculateLongitudinalOffset(data.vehicleKey);
    currentDistance = (currentDistance + spreadOffset) % data.lineTotalLength;

    // For reverse direction, mirror the distance
    if (data.direction === 1) {
      currentDistance = data.lineTotalLength - currentDistance;
      if (currentDistance < 0) {
        currentDistance += data.lineTotalLength;
      }
    }

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

    // Update current state (store actual position for click-to-zoom)
    data.currentPosition = [position[0], position[1]];
    data.currentBearing = finalBearing;
  }

  /**
   * Animate using lerp interpolation (position-based)
   *
   * Uses pre-computed snapped path when available for performance.
   * Falls back to per-frame snapping only if pre-computed data is unavailable.
   */
  private animateLerp(data: TransitMeshData, now: number): void {
    const elapsed = now - data.lerpStartTime;
    const t = Math.min(elapsed / data.lerpDuration, 1);

    // Once interpolation completes, skip all sampling until next update
    if (t >= 1 && data.currentPosition[0] === data.targetPosition[0] && data.currentPosition[1] === data.targetPosition[1]) {
      return;
    }

    // Smooth easing function (ease-out cubic)
    const eased = 1 - Math.pow(1 - t, 3);

    let lng: number;
    let lat: number;
    let bearing: number;

    // Use pre-computed snapped path if available (fast path - no per-frame snapping)
    if (data.precomputedSnap?.hasValidSnap) {
      const geometry = this.getGeometry(data.networkType, data.lineCode);
      if (geometry) {
        // At t=1.0 use end position directly — avoids binary search
        if (t >= 1) {
          const spreadOffset = this.calculateLongitudinalOffset(data.vehicleKey);
          const endDist = (data.precomputedSnap.endDistance + spreadOffset) % geometry.totalLength;
          const sample = sampleRailwayPosition(geometry, endDist);
          lng = sample.position[0];
          lat = sample.position[1];
          bearing = data.precomputedSnap.endBearing;
          bearing = data.direction === 1 ? (bearing + 180) % 360 : bearing;
        } else {
          // Interpolate along pre-computed railway distance
          let distance = data.precomputedSnap.startDistance +
            (data.precomputedSnap.endDistance - data.precomputedSnap.startDistance) * eased;

          // Apply longitudinal offset to spread overlapping vehicles along the line
          const spreadOffset = this.calculateLongitudinalOffset(data.vehicleKey);
          distance = (distance + spreadOffset) % geometry.totalLength;

          // Sample position from geometry (O(log n) binary search, no snapping)
          const sample = sampleRailwayPosition(geometry, distance);
          lng = sample.position[0];
          lat = sample.position[1];

          // Interpolate bearing
          let bearingDiff = data.precomputedSnap.endBearing - data.precomputedSnap.startBearing;
          if (bearingDiff > 180) bearingDiff -= 360;
          if (bearingDiff < -180) bearingDiff += 360;
          bearing = data.precomputedSnap.startBearing + bearingDiff * eased;
          bearing = data.direction === 1 ? (bearing + 180) % 360 : bearing;
        }
      } else {
        // Fallback: geometry not loaded yet
        lng = data.lerpStartPosition[0] + (data.targetPosition[0] - data.lerpStartPosition[0]) * eased;
        lat = data.lerpStartPosition[1] + (data.targetPosition[1] - data.lerpStartPosition[1]) * eased;
        let bearingDiff = data.targetBearing - data.lerpStartBearing;
        if (bearingDiff > 180) bearingDiff -= 360;
        if (bearingDiff < -180) bearingDiff += 360;
        bearing = data.lerpStartBearing + bearingDiff * eased;
      }
    } else {
      // Slow path: no pre-computed snap, use raw GPS interpolation
      lng = data.lerpStartPosition[0] + (data.targetPosition[0] - data.lerpStartPosition[0]) * eased;
      lat = data.lerpStartPosition[1] + (data.targetPosition[1] - data.lerpStartPosition[1]) * eased;

      // Interpolate bearing (handle wrap-around)
      let bearingDiff = data.targetBearing - data.lerpStartBearing;
      if (bearingDiff > 180) bearingDiff -= 360;
      if (bearingDiff < -180) bearingDiff += 360;
      bearing = data.lerpStartBearing + bearingDiff * eased;
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
   * Uses cached material references for performance
   */
  setOpacity(opacity: number): void {
    const isTransparent = opacity < 1;
    for (const data of this.meshes.values()) {
      data.opacity = opacity;
      // Use cached materials for O(n) instead of O(n × hierarchy depth)
      for (const mat of data.cachedMaterials) {
        (mat as THREE.MeshStandardMaterial).opacity = opacity;
        mat.transparent = isTransparent;
      }
    }
  }

  /**
   * Set opacity for multiple vehicles based on line selection
   * Used for highlight/isolate mode to show only selected lines
   * Uses cached material references for performance
   *
   * @param opacities - Map of vehicleKey to opacity (0.0 - 1.0)
   */
  setVehicleOpacities(opacities: Map<string, number>): void {
    opacities.forEach((opacity, vehicleKey) => {
      const data = this.meshes.get(vehicleKey);
      if (!data) return;

      data.opacity = opacity;
      const isTransparent = opacity < 1;
      // Use cached materials for O(n) instead of O(n × hierarchy depth)
      for (const mat of data.cachedMaterials) {
        (mat as THREE.MeshStandardMaterial).opacity = opacity;
        mat.transparent = isTransparent;
      }
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
      this.disposeMesh(data);
      this.scene.remove(data.mesh);
    }
    this.meshes.clear();
  }

  /**
   * Get screen-space candidates for click/hover detection.
   * Projects vehicle positions to screen coordinates with Oriented Bounding Rectangles (OBR).
   *
   * The OBR approach provides accurate hit detection for elongated vehicles like
   * metro trains and buses by projecting actual bounding box corners to screen space.
   */
  getScreenCandidates(map: mapboxgl.Map): ScreenSpaceCandidate[] {
    const candidates: ScreenSpaceCandidate[] = [];

    for (const [, data] of this.meshes) {
      const { mesh, vehicleKey, lineCode, networkType, boundingHalfExtents } = data;

      // Get lng/lat from mesh position
      const centerLngLat = getLngLatFromModelPosition(
        mesh.position.x,
        mesh.position.y,
        mesh.position.z
      );

      // Project to screen coordinates
      const centerPoint = map.project(centerLngLat);

      // Calculate screen radius from scale (for fallback/minimum threshold)
      const currentScale = mesh.scale.x;
      const worldRadius = currentScale * 0.5;

      // Project edge point to get screen radius
      const edgeLngLat = getLngLatFromModelPosition(
        mesh.position.x + worldRadius,
        mesh.position.y,
        mesh.position.z
      );
      const edgePoint = map.project(edgeLngLat);

      // Calculate pixel radius (fallback)
      const dx = edgePoint.x - centerPoint.x;
      const dy = edgePoint.y - centerPoint.y;
      const radiusPx = Math.max(Math.hypot(dx, dy), 10);

      // Compute oriented bounding rectangle for accurate hit detection
      // Get half-lengths in world units (model is scaled)
      const worldHalfLength = boundingHalfExtents.x * currentScale; // Length along model's X axis
      const worldHalfWidth = boundingHalfExtents.y * currentScale;  // Width along model's Y axis

      // Transform local axes to world space using the mesh's quaternion
      const localX = _poolLocalX.set(1, 0, 0).applyQuaternion(mesh.quaternion);
      const localY = _poolLocalY.set(0, 1, 0).applyQuaternion(mesh.quaternion);

      // Project front (+X direction) and right (+Y direction) points to screen
      const frontLngLat = getLngLatFromModelPosition(
        mesh.position.x + localX.x * worldHalfLength,
        mesh.position.y + localX.y * worldHalfLength,
        mesh.position.z
      );
      const frontScreen = map.project(frontLngLat);

      const rightLngLat = getLngLatFromModelPosition(
        mesh.position.x + localY.x * worldHalfWidth,
        mesh.position.y + localY.y * worldHalfWidth,
        mesh.position.z
      );
      const rightScreen = map.project(rightLngLat);

      // Calculate screen-space dimensions from projected points
      const halfLengthPx = Math.max(
        Math.hypot(frontScreen.x - centerPoint.x, frontScreen.y - centerPoint.y),
        15 // Minimum 15px for clickability
      );
      const halfWidthPx = Math.max(
        Math.hypot(rightScreen.x - centerPoint.x, rightScreen.y - centerPoint.y),
        8 // Minimum 8px for clickability
      );

      // Calculate screen-space rotation from the length axis projection
      const screenRotation = Math.atan2(
        frontScreen.y - centerPoint.y,
        frontScreen.x - centerPoint.x
      );

      candidates.push({
        vehicleKey,
        lineCode,
        networkType,
        screenPoint: { x: centerPoint.x, y: centerPoint.y },
        radiusPx,
        orientedRect: {
          halfWidthPx,
          halfLengthPx,
          rotation: screenRotation,
        },
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
