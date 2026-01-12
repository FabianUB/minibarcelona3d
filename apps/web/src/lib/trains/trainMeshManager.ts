/**
 * Train mesh manager
 *
 * Manages Three.js mesh instances for train models on the map.
 * Creates, updates, and removes train meshes based on position data.
 *
 * Related tasks: T046, T047, T052g-T052k (Mini Tokyo 3D fixes)
 */

import * as THREE from 'three';
import type { TrainPosition, RawTrainPosition } from '../../types/trains';
import type { Station } from '../../types/rodalies';
import { getCachedModel } from './modelLoader';
import { extractLineFromRouteId, getModelTypeForRoute } from '../../config/trainModels';
import { ScaleManager } from './scaleManager';
import { createOutlineMesh } from './outlineManager';
import {
  logPollDebug,
  type PollDebugEntry,
} from './pollDebugLogger';
import {
  calculateBearing,
  interpolatePositionSmooth,
  snapTrainToRailway,
  sampleRailwayPosition,
  type PreprocessedRailwayLine,
  type RailwaySnapResult,
} from './geometry';
import { getModelPosition, getModelScale, getLngLatFromModelPosition } from '../map/coordinates';
import {
  calculateParkingPosition,
  DEFAULT_PARKING_CONFIG,
  type ParkingPosition,
} from './stationParking';
import type { TripDetails } from '../../types/trains';
import {
  DEFAULT_PREDICTIVE_CONFIG,
  type PredictiveConfig,
} from './predictiveCalculator';
import { trainDebug } from './debugLogger';

// Optional: watchlist of vehicle keys to emit detailed poll logs
const POLL_WATCH_KEYS: Set<string> = new Set(
  (import.meta.env?.VITE_POLL_DEBUG_WATCH_KEYS ?? '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean)
);

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
  routeId: string | null;
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
  boundingHalfExtents: THREE.Vector3; // [halfWidth, halfLength, halfHeight] for OBR hit detection
  hasUnrealisticSpeed: boolean;
  warningIndicator?: THREE.Sprite;
  status: string; // Train status (STOPPED_AT, IN_TRANSIT_TO, INCOMING_AT)
  // Feature 003: Zoom-responsive scaling
  screenSpaceScale: number; // Current zoom-responsive multiplier (0.48-1.6)
  lastZoomBucket: number; // Quantized zoom level for cache invalidation (0.1 increments)
  // Feature 003 Phase 5: Hover outline (lazy-loaded)
  outlineMesh?: THREE.Group; // Created on first hover
  lineCode?: string; // Extracted from routeId
  lineColor?: THREE.Color; // Line brand color
  // Phase 2: Parking rotation state
  isParkingRotationApplied?: boolean; // Track if 90° parking rotation is applied
  // Phase 2: Parking position data
  parkingPosition?: ParkingPosition; // Calculated parking slot position
  stoppedAtStationId?: string; // Station ID where train is stopped
  prevStatus?: string; // Status on previous poll to detect transitions
  // Parking rotation animation state
  parkingRotationAnim?: {
    start: number;
    target: number;
    startedAt: number;
    duration: number;
    targetIsPerpendicular: boolean;
  };
  // Phase 4: Predictive positioning
  tripId?: string; // Trip ID for schedule lookup
  nextStopId?: string; // Next stop ID for schedule lookup
  lastPredictiveSource?: 'gps' | 'predicted' | 'blended'; // Source of last position update
  predictiveConfidence?: number; // Confidence in predictive position (0-1)
  // Performance: Cached material references to avoid mesh traversal in setMeshOpacity
  cachedMaterials?: THREE.Material[];
}

interface PollSnapshotMetadata {
  currentPolledAtMs?: number;
  previousPolledAtMs?: number;
  receivedAtMs?: number;
}

export interface ScreenSpaceCandidate {
  vehicleKey: string;
  routeId: string | null;
  screenPoint: mapboxgl.Point;
  radiusPx: number; // Keep for fallback/minimum threshold
  orientedRect: {
    halfWidthPx: number;   // Half-width in screen pixels (perpendicular to train direction)
    halfLengthPx: number;  // Half-length in screen pixels (along train direction)
    rotation: number;      // Screen-space rotation in radians
  };
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
  private readonly DEBUG_LIMIT = 10;
  private updateCallCount = 0;
  private readonly debugMeshes: THREE.Object3D[] = [];
  private readonly MAX_SNAP_DISTANCE_METERS = 200;
  private readonly INTERPOLATION_DURATION_MS = 30000;
  private readonly MIN_INTERPOLATION_DURATION_MS = 1000;
  private readonly MODEL_FORWARD_OFFSET = Math.PI; // Train models face negative X by default
  private readonly LATERAL_OFFSET_BUCKETS = 5;
  private readonly LATERAL_OFFSET_STEP_METERS = 40; // meters between trains laterally
  // Keep meshes for a while if absent to avoid pop-out/pop-in when a poll drops a train
  private readonly MISSING_TRAIN_GRACE_MS = 180000; // 3 minutes
  private readonly PARKING_ROTATION_DURATION_MS = 500;

  // Feature 003: Zoom-responsive lateral offset configuration
  private lateralOffsetConfig: LateralOffsetConfig;
  private currentZoom: number = 10; // Default zoom level

  // Feature 003: Zoom-responsive scale manager
  private scaleManager: ScaleManager;

  // Phase 4: Trip details cache for predictive positioning
  private tripDetailsCache: Map<string, TripDetails> = new Map();
  private predictiveConfig: PredictiveConfig = DEFAULT_PREDICTIVE_CONFIG;
  private lastProcessedPollTimestamp: number | null = null;
  // Maximum number of trip details to cache before cleanup
  private readonly MAX_TRIP_CACHE_SIZE = 200;

  // Maximum realistic train speed: 200 km/h = ~55.6 m/s
  // Rodalies trains typically max out at 140 km/h (~39 m/s)
  // Add 50% buffer for high-speed sections and GPS/timing inaccuracies
  private readonly MAX_TRAIN_SPEED_MS = 55.6 * 1.5; // ~83 m/s or ~300 km/h

  private highlightedVehicleKey: string | null = null;

  // User-controlled model scale (from control panel slider)
  private userScale: number = 1.0;

  /**
   * Set user-controlled model scale multiplier
   * @param scale - Scale multiplier (0.5 to 2.0, default 1.0)
   */
  setUserScale(scale: number): void {
    const clampedScale = Math.max(0.5, Math.min(2.0, scale));
    if (this.userScale !== clampedScale) {
      this.userScale = clampedScale;
      // Force scale recalculation on all meshes
      this.trainMeshes.forEach((meshData) => {
        meshData.lastZoomBucket = -1; // Invalidate cache
      });
      this.applyZoomResponsiveScale();
    }
  }

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

    trainDebug.system.info(`Stations loaded: ${this.stationMap.size}`);
  }

  /**
   * Update current zoom level for zoom-responsive lateral offset
   * Feature 003: Called from render loop to track map zoom changes
   */
  public setCurrentZoom(zoom: number): void {
    this.currentZoom = zoom;
  }

  /**
   * Update trip details cache for predictive positioning
   * Phase 4: Called when trip details are fetched for trains
   *
   * @param tripId - Trip identifier
   * @param tripDetails - Full trip schedule with stop times
   */
  public setTripDetails(tripId: string, tripDetails: TripDetails): void {
    this.tripDetailsCache.set(tripId, tripDetails);
  }

  /**
   * Update trip details for multiple trips at once
   * Phase 4: Batch update for efficiency
   *
   * @param trips - Map of tripId to TripDetails
   */
  public setTripDetailsBatch(trips: Map<string, TripDetails>): void {
    trips.forEach((details, tripId) => {
      this.tripDetailsCache.set(tripId, details);
    });
  }

  /**
   * Configure predictive position calculation
   * Phase 4: Allows tuning of GPS blending behavior
   *
   * @param config - Partial configuration to merge with defaults
   */
  public setPredictiveConfig(config: Partial<PredictiveConfig>): void {
    this.predictiveConfig = { ...this.predictiveConfig, ...config };
  }

  /**
   * Get trip details cache for debugging
   * Phase 4: Returns current cache size and trip IDs
   */
  public getTripDetailsCacheInfo(): { size: number; tripIds: string[] } {
    return {
      size: this.tripDetailsCache.size,
      tripIds: Array.from(this.tripDetailsCache.keys()),
    };
  }

  /**
   * Clean up trip details cache to prevent memory leaks
   * Removes entries for trips no longer associated with active trains
   * Phase 4: Called periodically during train mesh updates
   */
  private cleanupTripDetailsCache(): void {
    // Skip cleanup if cache is small enough
    if (this.tripDetailsCache.size <= this.MAX_TRIP_CACHE_SIZE) {
      return;
    }

    // Get trip IDs currently in use by active trains
    const activeTrips = new Set<string>();
    this.trainMeshes.forEach((meshData) => {
      if (meshData.tripId) {
        activeTrips.add(meshData.tripId);
      }
    });

    // Remove unused trip details
    const toRemove: string[] = [];
    this.tripDetailsCache.forEach((_, tripId) => {
      if (!activeTrips.has(tripId)) {
        toRemove.push(tripId);
      }
    });

    // Remove unused entries
    for (const tripId of toRemove) {
      this.tripDetailsCache.delete(tripId);
    }

    // If still over limit after removing unused, trim oldest entries
    // (Map maintains insertion order, so first entries are oldest)
    if (this.tripDetailsCache.size > this.MAX_TRIP_CACHE_SIZE) {
      const excess = this.tripDetailsCache.size - this.MAX_TRIP_CACHE_SIZE;
      const keys = Array.from(this.tripDetailsCache.keys());
      for (let i = 0; i < excess; i++) {
        this.tripDetailsCache.delete(keys[i]);
      }
    }

    if (toRemove.length > 0) {
      trainDebug.system.debug(`Trip cache cleanup: removed ${toRemove.length} unused entries`);
    }
  }

  /**
   * Associate a train with its trip ID for predictive positioning
   * Phase 4: Called when trip ID is known for a vehicle
   *
   * @param vehicleKey - Train vehicle key
   * @param tripId - Trip ID for schedule lookup
   */
  public setTrainTripId(vehicleKey: string, tripId: string): void {
    const meshData = this.trainMeshes.get(vehicleKey);
    if (meshData) {
      meshData.tripId = tripId;
    }
  }

  /**
   * Associate multiple trains with their trip IDs
   * Phase 4: Batch update for efficiency
   *
   * @param tripIds - Map of vehicleKey to tripId
   */
  public setTrainTripIdsBatch(tripIds: Map<string, string>): void {
    tripIds.forEach((tripId, vehicleKey) => {
      const meshData = this.trainMeshes.get(vehicleKey);
      if (meshData) {
        meshData.tripId = tripId;
      }
    });
  }

  /**
   * Get predictive position statistics for debugging
   * Phase 4: Returns info about how many trains are using predictive positioning
   */
  public getPredictiveStats(): {
    totalTrains: number;
    withTripId: number;
    usingPredictive: number;
    bySource: { gps: number; predicted: number; blended: number };
  } {
    let withTripId = 0;
    let usingPredictive = 0;
    const bySource = { gps: 0, predicted: 0, blended: 0 };

    this.trainMeshes.forEach((meshData) => {
      if (meshData.tripId) {
        withTripId++;
      }
      if (meshData.lastPredictiveSource) {
        usingPredictive++;
        bySource[meshData.lastPredictiveSource]++;
      }
    });

    return {
      totalTrains: this.trainMeshes.size,
      withTripId,
      usingPredictive,
      bySource,
    };
  }

  /**
   * Get scale manager instance for zoom-responsive sizing
   * Feature 003: Used by render loop to compute scale multipliers
   */
  public getScaleManager(): ScaleManager {
    return this.scaleManager;
  }

  /**
   * Try to infer the line ID for a train from its station's lines
   * Used when routeId is null (shows as "N/A" in UI)
   *
   * Tries currentStopId, nextStopId, and previousStopId in order.
   * If the station serves only one line, returns that line.
   * If the station serves multiple lines, returns the first one (best guess).
   *
   * @returns Line ID (e.g., "R1", "R4") or null if cannot infer
   */
  private inferLineFromStation(train: TrainPosition): string | null {
    const rawTrain = train as RawTrainPosition;
    const stopIds = [
      rawTrain.current_stop_id ?? train.currentStopId,
      train.nextStopId,
      rawTrain.previous_stop_id ?? train.previousStopId,
    ].filter(Boolean);

    for (const stopId of stopIds) {
      const station = this.stationMap.get(stopId as string);
      if (station && station.lines && station.lines.length > 0) {
        // Return the first line - this is a best guess for multi-line stations
        const inferredLine = station.lines[0];
        trainDebug.mesh.info(`Line inferred: ${train.vehicleKey} -> ${inferredLine}`, {
          station: station.name,
          stopId,
        });
        return inferredLine;
      }
    }

    return null;
  }

  private snapPositionToRailway(train: TrainPosition): RailwaySnapState | null {
    if (train.latitude === null || train.longitude === null) {
      return null;
    }

    // Try to extract line from routeId first
    let lineId = extractLineFromRouteId(train.routeId);

    // If routeId is null or doesn't match, try to infer from station
    if (!lineId) {
      lineId = this.inferLineFromStation(train);
    }

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
      trainDebug.mesh.warn(`Unrealistic speed: ${vehicleKey}`, {
        speed: `${(speedMS * 3.6).toFixed(0)} km/h`,
        distance: `${distanceTraveled.toFixed(0)}m`,
        timeDelta: `${timeDeltaS.toFixed(1)}s`,
      });
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
    isReversed = false,
    vehicleKey?: string
  ): void {
    const bearingRad = (-bearingDegrees * Math.PI) / 180;
    const rotation = bearingRad + this.MODEL_FORWARD_OFFSET + (isReversed ? Math.PI : 0);
    mesh.rotation.z = rotation;

    // Reset parking rotation flag since we just set a new base rotation
    // This ensures applyParkingVisuals() will re-apply the 90° offset if needed
    if (vehicleKey) {
      const meshData = this.trainMeshes.get(vehicleKey);
      if (meshData && meshData.status !== 'STOPPED_AT') {
        meshData.isParkingRotationApplied = false;
        meshData.parkingRotationAnim = undefined;
      }
    }
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

  /**
   * Compute lateral offset distance in meters based on offset index and zoom
   *
   * Calculates perpendicular offset to separate co-located trains from different lines.
   * The offset scales with zoom level to maintain appropriate visual separation.
   *
   * @param offsetIndex - Signed integer offset index (e.g., -2, -1, 0, 1, 2)
   * @returns Offset distance in meters perpendicular to train bearing
   *
   * @example
   * ```typescript
   * // At zoom 10 with baseStepMeters = 1.6, highZoomThreshold = 14
   * const offset = computeLateralOffset(-1); // Returns -1.6 meters (1.6 * -1 * 1.0)
   *
   * // At zoom 16 with highZoomMultiplier = 1.5
   * const offset = computeLateralOffset(2);  // Returns 4.8 meters (1.6 * 2 * 1.5)
   * ```
   */
  private computeLateralOffset(offsetIndex: number): number {
    const offsetMultiplier = offsetIndex;
    const zoomFactor = this.currentZoom > this.lateralOffsetConfig.highZoomThreshold
      ? this.lateralOffsetConfig.highZoomMultiplier
      : 1.0;
    return this.lateralOffsetConfig.baseStepMeters * offsetMultiplier * zoomFactor;
  }

  /**
   * Apply sequential positioning offset along the track
   *
   * Positions co-located trains sequentially along the railway line with a gap
   * between them, similar to how trains queue at a station platform. This creates
   * a more realistic visualization than lateral (side-by-side) positioning.
   *
   * Only applies offset when trains are stopped at a station to avoid interfering
   * with moving trains that should follow their actual GPS positions.
   *
   * @param position - Train position in world coordinates (will be mutated)
   * @param bearingInfo - Train bearing and direction (null if bearing unknown)
   * @param offsetIndex - Sequential position index (0 = front, 1 = behind first, etc.)
   * @param trainLengthMeters - Actual train model length in meters (from bounding box)
   * @param trainStatus - Train's current status (only offset when 'STOPPED_AT')
   *
   * @remarks
   * Sequential positioning along the track direction. Each train is offset by
   * (trainLength + gap) * offsetIndex meters along the bearing direction.
   * Uses actual model dimensions to ensure proper spacing without overlaps.
   */
  private applyLateralOffset(
    position: { x: number; y: number; z?: number },
    bearingInfo: { bearing: number; reversed: boolean } | null,
    offsetIndex: number,
    trainLengthMeters: number = 20, // Default fallback if not provided
    trainStatus?: string // Optional train status
  ): void {
    // Only apply offset to stopped trains
    if (trainStatus && trainStatus !== 'STOPPED_AT') {
      return;
    }

    // Skip if no offset needed or no bearing information
    if (!offsetIndex || !bearingInfo) {
      return;
    }

    // Configuration for sequential positioning
    // Use actual train model length multiplied by factor to account for bounding radius
    // (bounding sphere radius is half the train length in one direction)
    const TRAIN_LENGTH_METERS = trainLengthMeters * 3.5; // Account for full model + extra buffer
    const TRAIN_GAP_METERS = 15;  // Gap between sequential trains (increased for better visibility)
    const SPACING_METERS = TRAIN_LENGTH_METERS + TRAIN_GAP_METERS;

    // Calculate offset distance (positive = forward, negative = backward)
    // offsetIndex: -2, -1, 0, 1, 2 becomes positions along the track
    const offsetMeters = offsetIndex * SPACING_METERS;

    if (offsetMeters === 0) {
      return;
    }

    // SIMPLIFIED APPROACH: Offset along a fixed direction (north-south axis)
    // This ensures all trains at the same location offset in the same direction,
    // creating a proper queue regardless of their individual travel direction
    const modelScale = getModelScale();

    // Offset along the north direction (latitude axis)
    // This creates a vertical queue when viewed on the map
    const offsetX = 0; // No east-west offset
    const offsetY = offsetMeters * modelScale; // North-south offset

    position.x += offsetX;
    position.y += offsetY;

    /* BEARING-BASED OFFSET (DISABLED - causes opposite-direction trains to spread apart)
     *
     * Previous implementation: offset along each train's bearing
     * Problem: Trains going opposite directions offset in opposite directions
     *
     * const adjustedBearing = (bearingInfo.bearing + (bearingInfo.reversed ? 180 : 0) + 360) % 360;
     * const bearingRad = (adjustedBearing * Math.PI) / 180;
     * const forwardEast = Math.sin(bearingRad);
     * const forwardNorth = Math.cos(bearingRad);
     * const offsetX = forwardEast * offsetMeters * modelScale;
     * const offsetY = forwardNorth * offsetMeters * modelScale;
     */

    /* LATERAL OFFSET (COMMENTED OUT - Kept for reference)
     *
     * Previous implementation: side-by-side positioning perpendicular to track
     *
     * const adjustedBearing = (bearingInfo.bearing + (bearingInfo.reversed ? 180 : 0) + 360) % 360;
     * const bearingRad = (adjustedBearing * Math.PI) / 180;
     * const offsetMeters = this.computeLateralOffset(offsetIndex);
     *
     * // Calculate perpendicular direction (right side of bearing)
     * const rightEast = Math.cos(bearingRad);
     * const rightNorth = -Math.sin(bearingRad);
     * const modelScale = getModelScale();
     *
     * const offsetX = rightEast * offsetMeters * modelScale;
     * const offsetY = -rightNorth * offsetMeters * modelScale;
     *
     * position.x += offsetX;
     * position.y += offsetY;
     */
  }

  /**
   * Get the actual mesh position in lng/lat coordinates for a given vehicleKey.
   * This returns where the train mesh is actually rendered, which may differ
   * from the API GPS coordinates due to railway snapping and parking offsets.
   *
   * @param vehicleKey - The train's unique identifier
   * @returns [lng, lat] if mesh exists, null otherwise
   */
  public getMeshLngLat(vehicleKey: string): [number, number] | null {
    const meshData = this.trainMeshes.get(vehicleKey);
    if (!meshData) return null;

    // currentPosition stores the [lng, lat] of the mesh
    // For parked trains, this is updated to the parking position
    // For moving trains, this is interpolated between positions
    if (meshData.parkingPosition) {
      return meshData.parkingPosition.position;
    }
    return meshData.currentPosition;
  }

  public getDebugInfo(): Array<{
    vehicleKey: string;
    routeId: string | null;
    offsetIndex: number;
    offsetMeters: number;
    currentZoom: number;
    zoomFactor: number;
    position: { x: number; y: number; z: number };
  }> {
    const debugInfo: Array<{
      vehicleKey: string;
      routeId: string | null;
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
      trainDebug.mesh.warn(`Model not loaded: ${train.vehicleKey}`, {
        routeId: train.routeId,
        modelType,
      });
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
      trainDebug.mesh.error(`Invalid scale: ${train.vehicleKey}`, {
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
    const initialScale = baseScale * scaleVariation * zoomScale * this.userScale;
    mesh.scale.set(initialScale, initialScale, initialScale);

    // Compute object-space half-extents BEFORE rotation for OBR hit detection
    // At this point mesh is scaled but not rotated, so we get the axis-aligned dimensions
    const preRotationBox = new THREE.Box3().setFromObject(mesh);
    const preRotationSize = new THREE.Vector3();
    preRotationBox.getSize(preRotationSize);
    // Store unscaled half-extents (we'll apply scale at hit detection time)
    // Note: x = width, y = length (forward direction), z = height
    const boundingHalfExtents = new THREE.Vector3(
      preRotationSize.x / 2 / initialScale,  // halfWidth (perpendicular)
      preRotationSize.y / 2 / initialScale,  // halfLength (forward)
      preRotationSize.z / 2 / initialScale   // halfHeight
    );

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
    // Note: half-extents computed earlier BEFORE rotation for accurate OBR hit detection
    // Reuse centerBox to avoid allocating new Box3
    centerBox.setFromObject(mesh);
    const boundingSphere = new THREE.Sphere();
    centerBox.getBoundingSphere(boundingSphere);

    // Collect materials for fast opacity updates (avoids mesh traversal later)
    const cachedMaterials: THREE.Material[] = [];
    mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (Array.isArray(child.material)) {
          cachedMaterials.push(...child.material);
        } else if (child.material) {
          cachedMaterials.push(child.material);
        }
      }
    });

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
      boundingHalfExtents,
      hasUnrealisticSpeed: false,
      status: train.status, // Store train status for offset logic
      // Feature 003: Initialize zoom-responsive scaling fields
      screenSpaceScale: zoomScale,
      lastZoomBucket: Math.round(this.currentZoom * 10) / 10, // Quantize to 0.1
      // Phase 2: Track station for parking
      stoppedAtStationId:
        train.status === 'STOPPED_AT'
          ? this.getStoppedStationId(train)
          : undefined,
      // Phase 4: Store nextStopId for predictive positioning
      nextStopId: train.nextStopId ?? undefined,
      // Performance: Cache materials for fast opacity updates
      cachedMaterials: cachedMaterials.length > 0 ? cachedMaterials : undefined,
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
    let pollDebug: PollDebugEntry | null = null;
    const watchLoggedThisPoll = new Set<string>();

    // Deduplicate identical/older poll updates to avoid resetting animation mid-flight
    const pollTimestamp =
      (pollMetadata?.currentPolledAtMs ?? pollMetadata?.receivedAtMs) ?? null;
    if (
      pollTimestamp !== null &&
      this.lastProcessedPollTimestamp !== null &&
      pollTimestamp <= this.lastProcessedPollTimestamp
    ) {
      pollDebug = {
        pollTimestampMs: pollMetadata?.currentPolledAtMs ?? null,
        receivedAtMs: pollMetadata?.receivedAtMs ?? null,
        processed: false,
        reason: 'duplicate',
        trainCount: trains.length,
        addedCount: 0,
        removedCount: 0,
        stuckCount: 0,
        dataAgeMs:
          pollMetadata?.currentPolledAtMs !== undefined
            ? Date.now() - pollMetadata.currentPolledAtMs
            : null,
        updateCallsThisSecond: this.updateCallsThisSecond,
      };
      logPollDebug(pollDebug);
      trainDebug.system.warn('Teleport guard: ignoring duplicate poll', {
        received: pollTimestamp,
        lastProcessed: this.lastProcessedPollTimestamp,
      });
      return;
    }

    const activeTrainKeys = new Set<string>();
    const now = Date.now();
    let createdCount = 0;

    // Track how often updateTrainMeshes is called to detect double-calls that cause teleportation
    this.updateCallCount++;
    if (now - this.lastUpdateCallTime < 1000) {
      this.updateCallsThisSecond++;
      // Warn if called multiple times in rapid succession
      if (this.updateCallsThisSecond > 1) {
        trainDebug.system.warn(`Teleport bug risk: updateTrainMeshes called ${this.updateCallsThisSecond}x in 1s`);
      }
    } else {
      this.updateCallsThisSecond = 1;
      this.lastUpdateCallTime = now;
    }

    // Reset debug counter for this poll batch
    this.debugCount = 0;

    const interpolationDuration = this.calculateEffectiveInterpolationDuration(pollMetadata);
    const baseLastUpdate =
      pollMetadata?.receivedAtMs && Number.isFinite(pollMetadata.receivedAtMs)
        ? pollMetadata.receivedAtMs
        : now;

    // Create or update meshes for each train
    for (const train of trains) {
      const existing = this.trainMeshes.get(train.vehicleKey);

      // If train has null or invalid coords, keep existing mesh alive (stale) to avoid pop-out
      const hasValidCoords = train.latitude !== null &&
        train.longitude !== null &&
        Number.isFinite(train.latitude) &&
        Number.isFinite(train.longitude) &&
        Math.abs(train.latitude) <= 90 &&
        Math.abs(train.longitude) <= 180;

      if (!hasValidCoords) {
        if (existing) {
          activeTrainKeys.add(train.vehicleKey);
          // Keep status tracking consistent even when coords are missing
          const prevStatus = existing.status;
          existing.prevStatus = prevStatus;
          existing.status = train.status ?? existing.status;
        }
        if (train.status === 'STOPPED_AT') {
          trainDebug.mesh.warn(`Invalid coordinates for STOPPED_AT: ${train.vehicleKey}`, {
            lat: train.latitude,
            lng: train.longitude,
            routeId: train.routeId,
          });
        }
        continue;
      }

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
        previousSnapState = this.snapPositionToRailway(previousPosition);
        // Use SNAPPED position (just like targetLngLat) to prevent jumps between raw/snapped coords
        previousLngLat = previousSnapState
          ? [previousSnapState.position[0], previousSnapState.position[1]]
          : [previousPosition.longitude, previousPosition.latitude];
      }

      const initialLngLat: [number, number] = previousLngLat ?? targetLngLat;

      if (existing) {
        const prevStatus = existing.status;

        // If we were parked and are now moving, project the parking position back onto the track
        if (existing.parkingPosition && train.status !== 'STOPPED_AT') {
          const lineId =
            targetSnapState?.lineId ??
            existing.currentSnap?.lineId ??
            extractLineFromRouteId(existing.routeId)?.toUpperCase();
          const railway = lineId ? this.railwayLines.get(lineId) : undefined;
          if (railway) {
            const snapFromParking = snapTrainToRailway(
              existing.parkingPosition.position,
              railway,
              this.MAX_SNAP_DISTANCE_METERS
            );
            if (snapFromParking) {
              existing.currentPosition = [snapFromParking.position[0], snapFromParking.position[1]];
              existing.currentSnap = {
                ...snapFromParking,
                lineId: lineId!,
              };
              existing.parkingPosition = undefined;
            }
          }
        }

        if (typeof existing.lateralOffsetIndex !== 'number') {
          existing.lateralOffsetIndex = this.getLateralOffsetIndex(train.vehicleKey);
        }

        // Update train status for offset logic
        existing.status = train.status;
        existing.prevStatus = prevStatus;

        // Phase 4: Update nextStopId for predictive positioning
        existing.nextStopId = train.nextStopId ?? undefined;

        // Track which station the train is stopped at (for parking calculations)
        if (train.status === 'STOPPED_AT') {
          existing.stoppedAtStationId = this.getStoppedStationId(train);
        } else {
          existing.stoppedAtStationId = undefined;
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

        // CRITICAL FIX: Calculate the train's CURRENT VISUAL POSITION (interpolated)
        // and use that as the starting point for the new animation.
        //
        // THE BUG: When a new poll arrives mid-animation:
        // - Train is visually at interpolated position M (between currentPosition A and targetPosition B)
        // - But existing.currentPosition still holds A (the START of the animation)
        // - If we use A as the new starting position, train JUMPS BACKWARD from M to A
        //
        // THE FIX: Calculate where the train IS right now (the interpolated position M)
        // and use M as the starting point for the new animation to the new target C.
        // This ensures smooth continuous motion: ... → M → C (no jump)

        const now = baseLastUpdate; // Use the poll timestamp for consistency
        const elapsed = now - existing.lastUpdate;
        const duration = existing.interpolationDuration ?? this.INTERPOLATION_DURATION_MS;
        const progress = Math.min(Math.max(elapsed / duration, 0), 1.0);

        // Calculate the visual (interpolated) position
        const [startLng, startLat] = existing.currentPosition;
        const [endLng, endLat] = existing.targetPosition;

        let visualLng: number;
        let visualLat: number;

        // If we have railway snap data, use railway-based interpolation for accuracy
        if (
          existing.currentSnap &&
          existing.targetSnap &&
          existing.currentSnap.lineId === existing.targetSnap.lineId
        ) {
          const railway = this.railwayLines.get(existing.currentSnap.lineId);
          if (railway) {
            const distanceStart = existing.currentSnap.distance;
            const distanceEnd = existing.targetSnap.distance;
            const interpolatedDistance = distanceStart + (distanceEnd - distanceStart) * progress;
            const sample = sampleRailwayPosition(railway, interpolatedDistance);
            visualLng = sample.position[0];
            visualLat = sample.position[1];
          } else {
            // Fallback to linear interpolation
            visualLng = startLng + (endLng - startLng) * progress;
            visualLat = startLat + (endLat - startLat) * progress;
          }
        } else {
          // Linear interpolation (no railway data)
          visualLng = startLng + (endLng - startLng) * progress;
          visualLat = startLat + (endLat - startLat) * progress;
        }

        // Debug logging for updates - only first 3 trains per poll (DEBUG level = hidden by default)
        if (this.debugCount < 3) {
          trainDebug.mesh.debug(`Update: ${train.vehicleKey}`, {
            progress: `${(progress * 100).toFixed(1)}%`,
            elapsed: `${(elapsed / 1000).toFixed(1)}s`,
          });
          this.debugCount++;
        }

        // Watchlist logging: capture detailed per-train info for specified keys
        if (POLL_WATCH_KEYS.has(train.vehicleKey) && !watchLoggedThisPoll.has(train.vehicleKey)) {
          const watchPayload = {
            vehicleKey: train.vehicleKey,
            status: train.status,
            progress,
            elapsedMs: elapsed,
            interpolationDurationMs: duration,
            startPosition: [startLng, startLat],
            visualPosition: [visualLng, visualLat],
            targetPosition: targetLngLat,
            previousSnap: previousSnapState,
            currentSnapBefore: existing.currentSnap,
            targetSnap: targetSnapState,
          };

          logPollDebug({
            pollTimestampMs: pollMetadata?.currentPolledAtMs ?? null,
            receivedAtMs: pollMetadata?.receivedAtMs ?? null,
            processed: true,
            reason: 'ok',
            trainCount: trains.length,
            addedCount: createdCount,
            removedCount: 0,
            stuckCount: 0,
            dataAgeMs:
              pollMetadata?.currentPolledAtMs !== undefined
                ? now - pollMetadata.currentPolledAtMs
                : null,
            updateCallsThisSecond: this.updateCallsThisSecond,
            watch: watchPayload,
          });

          watchLoggedThisPoll.add(train.vehicleKey);
        }

        // Choose the best start position for the next segment to minimize jumps:
        // - Prefer previous snapped position if available
        // - Otherwise use the VISUAL interpolated position (where the train is drawn now)
        // - Fallback to target if nothing else
        if (previousSnapState) {
          existing.currentPosition = [previousSnapState.position[0], previousSnapState.position[1]];
          existing.currentSnap = previousSnapState;
        } else {
          existing.currentPosition = [visualLng, visualLat];

          if (
            existing.currentSnap &&
            existing.targetSnap &&
            existing.currentSnap.lineId === existing.targetSnap.lineId
          ) {
            // Interpolate snap distance to match visual position
            const distanceStart = existing.currentSnap.distance;
            const distanceEnd = existing.targetSnap.distance;
            const interpolatedDistance = distanceStart + (distanceEnd - distanceStart) * progress;

            existing.currentSnap = {
              ...existing.currentSnap,
              position: [visualLng, visualLat],
              distance: interpolatedDistance,
            };
          } else if (!existing.currentSnap && existing.targetSnap) {
            existing.currentSnap = existing.targetSnap;
          }
        }

        // Update target position and timing
        existing.targetPosition = targetLngLat;
        existing.targetSnap = targetSnapState ?? undefined;
        existing.lastUpdate = baseLastUpdate;
        existing.interpolationDuration = interpolationDuration;

        // T047: Update rotation based on (potentially new) next station
        this.applyBearingRotation(existing.mesh, train);

        // Apply bearing based on travel direction using current mesh snap states
        // (not API's previousSnapState which may cause inconsistencies)
        if (existing.targetSnap) {
          const travellingForward =
            existing.currentSnap &&
            existing.targetSnap &&
            existing.currentSnap.lineId === existing.targetSnap.lineId
              ? existing.targetSnap.distance >= existing.currentSnap.distance
              : true;

          this.applyRailwayBearing(existing.mesh, existing.targetSnap.bearing, !travellingForward, train.vehicleKey);
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
          // Leave prevStatus undefined on first render so parking animation can run for initial STOPPED_AT
          meshData.prevStatus = undefined;
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

          this.applyLateralOffset(position, lateralBearingInfo, meshData.lateralOffsetIndex, meshData.boundingRadius, train.status);

          meshData.mesh.position.set(position.x, position.y, position.z + zOffset);

          // Add to scene
          this.scene.add(meshData.mesh);

          if (this.debugCount < this.DEBUG_LIMIT) {
            this.debugMeshes.push(meshData.mesh);
          }

          // Track in our map
          this.trainMeshes.set(train.vehicleKey, meshData);
          createdCount += 1;

          // Use structured logging for mesh creation
          if (train.status === 'STOPPED_AT') {
            trainDebug.mesh.info(`STOPPED_AT mesh created: ${train.vehicleKey}`, {
              routeId: train.routeId,
              lineCode: extractLineFromRouteId(train.routeId),
              coords: `${initialLngLat[1].toFixed(5)}, ${initialLngLat[0].toFixed(5)}`,
              stoppedAtStation: meshData.stoppedAtStationId,
              stationFound: !!this.stationMap.get(meshData.stoppedAtStationId ?? ''),
              meshPos: `${meshData.mesh.position.x.toExponential(4)}, ${meshData.mesh.position.y.toExponential(4)}, ${meshData.mesh.position.z.toExponential(4)}`,
              scale: meshData.mesh.scale.x.toExponential(4),
              snapped: !!targetSnapState,
            });
          } else {
            trainDebug.mesh.debug(`Mesh created: ${train.vehicleKey}`, {
              routeId: train.routeId,
            });
          }
        }
      }

      // Track this train as active (for removal logic)
      activeTrainKeys.add(train.vehicleKey);
    }

    // Remove meshes for trains that are no longer active, with a grace period to avoid pops
    const nowMs = now;
    const toRemove: string[] = [];
    this.trainMeshes.forEach((meshData, vehicleKey) => {
      if (!activeTrainKeys.has(vehicleKey)) {
        const ageSinceSeen = nowMs - meshData.lastUpdate;
        // Keep for a short grace period to avoid pop-out/pop-in when API temporarily drops a train
        if (ageSinceSeen > this.MISSING_TRAIN_GRACE_MS) {
          toRemove.push(vehicleKey);
        }
      }
    });

    for (const vehicleKey of toRemove) {
      this.removeTrainMesh(vehicleKey);
    }

    // Remember last processed poll timestamp to ignore duplicates next time
    if (pollTimestamp !== null) {
      this.lastProcessedPollTimestamp = pollTimestamp;
    } else {
      this.lastProcessedPollTimestamp = now;
    }

    // Log poll debug summary for offline debugging (download via window.__trainPollDebugLog.download())
    const dataAgeMs =
      pollMetadata?.currentPolledAtMs !== undefined ? now - pollMetadata.currentPolledAtMs : null;
    const stuckCount = this.getStuckTrainsDiagnostic().length;
    pollDebug = {
      pollTimestampMs: pollMetadata?.currentPolledAtMs ?? null,
      receivedAtMs: pollMetadata?.receivedAtMs ?? null,
      processed: true,
      reason: 'ok',
      trainCount: trains.length,
      addedCount: createdCount,
      removedCount: toRemove.length,
      stuckCount,
      dataAgeMs,
      updateCallsThisSecond: this.updateCallsThisSecond,
    };
    logPollDebug(pollDebug);

    // Clean up trip details cache to prevent memory leaks
    this.cleanupTripDetailsCache();

    // Mesh summary is handled by the poll summary in TrainLayer3D
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

      // Clean up outline mesh if present (Feature 003: hover outlines)
      if (meshData.outlineMesh) {
        // Remove from parent before disposal
        if (meshData.outlineMesh.parent) {
          meshData.outlineMesh.parent.remove(meshData.outlineMesh);
        }
        // Dispose geometry and materials
        meshData.outlineMesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry?.dispose();
            if (Array.isArray(child.material)) {
              child.material.forEach((mat) => mat.dispose());
            } else {
              child.material?.dispose();
            }
          }
        });
        meshData.outlineMesh = undefined;
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

      trainDebug.mesh.debug(`Mesh removed: ${vehicleKey}`);
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
      if (!meshData) return;

      // Use cached materials if available (performance optimization)
      if (meshData.cachedMaterials && meshData.cachedMaterials.length > 0) {
        const isTransparent = opacity < 1.0;
        for (const mat of meshData.cachedMaterials) {
          mat.transparent = isTransparent;
          mat.opacity = opacity;
        }
      } else {
        // Fallback to mesh traversal
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
        const normalScale = prev.baseScale * scaleVariation * prev.screenSpaceScale * this.userScale;
        prev.mesh.scale.setScalar(normalScale);
      }
    }

    this.highlightedVehicleKey = nextKey;

    if (nextKey) {
      const next = this.trainMeshes.get(nextKey);
      if (next) {
        const scaleVariation = this.getScaleVariation(next.vehicleKey);
        const normalScale = next.baseScale * scaleVariation * next.screenSpaceScale * this.userScale;
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
    trainDebug.system.info('All meshes cleared');
  }

  /**
   * Get the number of active train meshes
   */
  getMeshCount(): number {
    return this.trainMeshes.size;
  }

  /**
   * Show or hide all train meshes
   * Used by transport filter to toggle layer visibility
   */
  setAllMeshesVisible(visible: boolean): void {
    this.trainMeshes.forEach((meshData) => {
      meshData.mesh.visible = visible;
    });
    trainDebug.system.info(`All meshes visibility set to ${visible}`);
  }

  getScreenCandidates(map: mapboxgl.Map): ScreenSpaceCandidate[] {
    // NOTE: Caching disabled - screen positions change on every camera move (pan/rotate/pitch)
    // Previously cached only on zoom, but that caused stale positions during camera movement
    // TODO: Re-enable with proper camera position tracking if performance becomes an issue

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

      // Project radius to screen space (for fallback/compatibility)
      const edgeLngLat = getLngLatFromModelPosition(
        mesh.position.x + worldRadius,
        mesh.position.y,
        mesh.position.z
      );
      const edgePoint = map.project(edgeLngLat);
      const dx = edgePoint.x - centerPoint.x;
      const dy = edgePoint.y - centerPoint.y;
      const radiusPx = Math.max(Math.hypot(dx, dy), 10);

      // Compute oriented rectangle for accurate hit detection
      // Use the radiusPx (which works) as basis, then elongate for train shape
      // Project actual bounding box corners to screen space for accurate OBR
      // This accounts for all coordinate system transformations automatically
      const { boundingHalfExtents } = meshData;
      // currentScale already defined above

      // Get half-lengths in world units (model is scaled)
      const worldHalfLength = boundingHalfExtents.x * currentScale; // Length along model's X axis
      const worldHalfWidth = boundingHalfExtents.y * currentScale;  // Width along model's Y axis

      // Transform local axes to world space using the mesh's quaternion
      // Model's length is along X axis (faces -X, so length runs from +X to -X)
      const localX = new THREE.Vector3(1, 0, 0).applyQuaternion(mesh.quaternion);
      const localY = new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion);

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
        20 // Minimum 20px for clickability
      );
      const halfWidthPx = Math.max(
        Math.hypot(rightScreen.x - centerPoint.x, rightScreen.y - centerPoint.y),
        10 // Minimum 10px for clickability
      );

      // Calculate screen-space rotation from the length axis projection
      const screenRotation = Math.atan2(
        frontScreen.y - centerPoint.y,
        frontScreen.x - centerPoint.x
      );

      candidates.push({
        vehicleKey,
        routeId,
        screenPoint: centerPoint,
        radiusPx,
        orientedRect: {
          halfWidthPx,
          halfLengthPx,
          rotation: screenRotation,
        },
      });
    });

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
    // Pre-compute values outside the loop (performance optimization)
    const zoomScale = this.scaleManager.computeScale(this.currentZoom);
    const quantizedZoom = Math.round(this.currentZoom * 10) / 10;

    this.trainMeshes.forEach((meshData) => {
      if (meshData.lastZoomBucket !== quantizedZoom) {
        const scaleVariation = this.getScaleVariation(meshData.vehicleKey);
        const finalScale = meshData.baseScale * scaleVariation * zoomScale * this.userScale;

        const isHighlighted = this.highlightedVehicleKey === meshData.vehicleKey;
        const scaleToApply = isHighlighted ? finalScale * 1.12 : finalScale;

        meshData.mesh.scale.set(scaleToApply, scaleToApply, scaleToApply);
        meshData.screenSpaceScale = zoomScale;
        meshData.lastZoomBucket = quantizedZoom;
      }
    });
  }

  /**
   * Get diagnostic info about trains that appear stuck (not animating)
   * Useful for debugging trains that should be moving but aren't
   */
  public getStuckTrainsDiagnostic(): Array<{
    vehicleKey: string;
    status: string;
    hasMovement: boolean;
    currentPosition: [number, number];
    targetPosition: [number, number];
    distanceMeters: number;
    timeSinceUpdateMs: number;
  }> {
    const now = Date.now();
    const stuckTrains: Array<{
      vehicleKey: string;
      status: string;
      hasMovement: boolean;
      currentPosition: [number, number];
      targetPosition: [number, number];
      distanceMeters: number;
      timeSinceUpdateMs: number;
    }> = [];

    this.trainMeshes.forEach((meshData) => {
      const [currentLng, currentLat] = meshData.currentPosition;
      const [targetLng, targetLat] = meshData.targetPosition;

      // Calculate approximate distance in meters
      const latDiff = targetLat - currentLat;
      const lngDiff = targetLng - currentLng;
      const latMeters = latDiff * 111320; // ~111km per degree latitude
      const lngMeters = lngDiff * 111320 * Math.cos(currentLat * Math.PI / 180);
      const distanceMeters = Math.sqrt(latMeters * latMeters + lngMeters * lngMeters);

      const hasMovement = currentLng !== targetLng || currentLat !== targetLat;
      const timeSinceUpdateMs = now - meshData.lastUpdate;

      // Report trains that are "in transit" but have no movement
      if (meshData.status !== 'STOPPED_AT' && !hasMovement) {
        stuckTrains.push({
          vehicleKey: meshData.vehicleKey,
          status: meshData.status,
          hasMovement,
          currentPosition: meshData.currentPosition,
          targetPosition: meshData.targetPosition,
          distanceMeters,
          timeSinceUpdateMs,
        });
      }
    });

    return stuckTrains;
  }

  /**
   * Determine which station ID to use for STOPPED_AT trains.
   * Prefer the current stop, then next, then previous (as a last resort).
   */
  private getStoppedStationId(train: TrainPosition): string | undefined {
    const rawTrain = train as RawTrainPosition;
    const current = train.currentStopId ?? rawTrain.current_stop_id ?? null;
    const next = train.nextStopId ?? rawTrain.next_stop_id ?? null;
    const previous = train.previousStopId ?? rawTrain.previous_stop_id ?? null;
    return (
      current ??
      next ??
      previous ??
      undefined
    );
  }

  private lastAnimateLogTime = 0;
  private lastUpdateCallTime = 0;
  private updateCallsThisSecond = 0;

  animatePositions(): void {
    const now = Date.now();

    // Log animation stats every 5 seconds (using debug level to reduce noise)
    if (now - this.lastAnimateLogTime > 5000) {
      const stoppedCount = [...this.trainMeshes.values()].filter(m => m.status === 'STOPPED_AT').length;
      trainDebug.animate.debug('Animation loop', {
        totalMeshes: this.trainMeshes.size,
        stoppedAt: stoppedCount,
      });
      this.lastAnimateLogTime = now;
    }

    // Pre-compute values that are constant for all trains (performance optimization)
    const modelScale = getModelScale();
    const zOffset = this.Z_OFFSET_FACTOR * this.TRAIN_SIZE_METERS * modelScale;

    this.trainMeshes.forEach((meshData) => {
      const { currentPosition, targetPosition, lastUpdate } = meshData;

      // Check if we need to interpolate
      const [currentLng, currentLat] = currentPosition;
      const [targetLng, targetLat] = targetPosition;

      // DEFENSIVE: Skip trains with invalid positions to prevent NaN propagation
      const hasValidCurrent = Number.isFinite(currentLng) && Number.isFinite(currentLat);
      const hasValidTarget = Number.isFinite(targetLng) && Number.isFinite(targetLat);

      if (!hasValidCurrent && !hasValidTarget) {
        // Both positions invalid - skip this train entirely
        trainDebug.animate.error(`No valid positions: ${meshData.vehicleKey}`, {
          status: meshData.status,
          currentPosition,
          targetPosition,
        });
        trainDebug.addMeshInvalidPosition(meshData.vehicleKey);
        return;
      }

      // If current is invalid but target is valid, use target as current
      if (!hasValidCurrent && hasValidTarget) {
        trainDebug.animate.warn(`Invalid currentPosition, using target: ${meshData.vehicleKey}`);
        meshData.currentPosition = [targetLng, targetLat];
      }

      // If already at target, skip interpolation for moving trains
      // But for STOPPED_AT trains without a parking position, we still need to
      // ensure position is set (parking calculation may have failed)
      if (currentLng === targetLng && currentLat === targetLat) {
        // For stopped trains without parking, ensure position is set
        if (meshData.status === 'STOPPED_AT' && !meshData.parkingPosition) {
          const position = getModelPosition(currentLng, currentLat, 0);
          meshData.mesh.position.set(position.x, position.y, position.z + zOffset);
        }
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

      // Z-offset is pre-computed outside the loop for performance
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

      // DO NOT apply offset here - it's already been applied in updateTrainMeshes()
      // when the polling data arrived. For stopped trains, position is already final.
      // For moving trains, we want them to follow the interpolated railway geometry
      // without any lateral offset.
      //
      // Performance: This eliminates thousands of redundant offset calculations per second
      // (was recalculating every frame even though the result never changes for stopped trains)

      meshData.mesh.position.set(position.x, position.y, position.z + zOffset);

      if (bearingOverride) {
        this.applyRailwayBearing(
          meshData.mesh,
          bearingOverride.bearing,
          bearingOverride.reversed,
          meshData.vehicleKey
        );
      }

      // If interpolation complete, update current position to target
      // IMPORTANT: Create a copy to avoid reference issues where both arrays point to same data
      if (progress >= 1.0) {
        meshData.currentPosition = [targetPosition[0], targetPosition[1]];
        if (meshData.targetSnap) {
          meshData.currentSnap = meshData.targetSnap;
        } else {
          meshData.currentSnap = undefined;
        }
      }
    });
  }

  /**
   * Apply parking visuals to stopped trains
   *
   * Phase 2: For trains with STOPPED_AT status:
   * 1. Calculate parking slot position (offset along track to prevent overlap)
   * 2. Apply position offset so trains don't overlap station marker or each other
   * 3. Rotate 90° to appear perpendicular to the track
   *
   * NOTE: This method is called every frame, so we track state to avoid
   * recalculating/reapplying unnecessarily.
   */
  public applyParkingVisuals(): void {
    const now = Date.now();

    const easeInOutCubic = (t: number): number =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    // Pre-compute values that are constant for all trains (performance optimization)
    const modelScale = getModelScale();
    const zOffset = this.Z_OFFSET_FACTOR * this.TRAIN_SIZE_METERS * modelScale;

    this.trainMeshes.forEach((meshData) => {
      const shouldBePerpendicular = meshData.status === 'STOPPED_AT';
      const wasPerpendicular = meshData.prevStatus === 'STOPPED_AT';
      const hasActiveAnimation = !!meshData.parkingRotationAnim;

      // Early exit: Skip trains that don't need parking processing
      // - Not stopped and wasn't stopped (no transition)
      // - No active animation to process
      if (!shouldBePerpendicular && !wasPerpendicular && !hasActiveAnimation) {
        return;
      }

      const desiredMode: 'hard' | 'none' = shouldBePerpendicular ? 'hard' : 'none';
      const isCurrentlyPerpendicular = meshData.isParkingRotationApplied === true;

      // Apply ongoing parking rotation animation if present
      if (meshData.parkingRotationAnim) {
        const { start, target, startedAt, duration, targetIsPerpendicular } = meshData.parkingRotationAnim;
        const elapsed = now - startedAt;
        const progress = Math.min(Math.max(elapsed / duration, 0), 1);
        const eased = easeInOutCubic(progress);
        const angle = start + (target - start) * eased;
        meshData.mesh.rotation.z = angle;

        if (progress >= 1) {
          meshData.parkingRotationAnim = undefined;
          meshData.isParkingRotationApplied = targetIsPerpendicular;
        }
      }

      // Only trigger parking rotation when transitioning into STOPPED_AT
      const justStopped = desiredMode === 'hard' && meshData.prevStatus !== 'STOPPED_AT';
      if (justStopped && !meshData.parkingRotationAnim) {
        // Train just stopped - calculate parking position
        const stationId = meshData.stoppedAtStationId;
        let parkingApplied = false;

        if (stationId) {
          // Get station coordinates
          const station = this.stationMap.get(stationId);
          if (station) {
            const stationCoords: [number, number] = [
              station.geometry.coordinates[0],
              station.geometry.coordinates[1],
            ];

            // Get the railway line for this train
            // Try routeId first, then infer from station if null
            let lineId = extractLineFromRouteId(meshData.routeId);
            if (!lineId && stationId) {
              // Try to infer line from the station the train is stopped at
              const stoppedStation = this.stationMap.get(stationId);
              if (stoppedStation && stoppedStation.lines && stoppedStation.lines.length > 0) {
                lineId = stoppedStation.lines[0];
                trainDebug.parking.info(`Line inferred for parking: ${meshData.vehicleKey} -> ${lineId}`);
              }
            }
            const railway = lineId ? this.railwayLines.get(lineId.toUpperCase()) : null;

            if (railway) {
              // Calculate parking position with slot offset
              const parking = calculateParkingPosition(
                stationId,
                meshData.vehicleKey,
                stationCoords,
                railway,
                DEFAULT_PARKING_CONFIG,
                this.currentZoom
              );

              if (parking) {
                meshData.parkingPosition = parking;

                // Apply offset position (zOffset is pre-computed outside the loop)
                const position = getModelPosition(parking.position[0], parking.position[1], 0);
                meshData.mesh.position.set(position.x, position.y, position.z + zOffset);

                // CRITICAL: Align logical positions with the parked visual position so
                // the next poll starts from where the train is actually drawn.
                // Without this, resuming from STOPPED_AT uses stale track coordinates
                // and produces a visible teleport from parking slot back to the track.
                meshData.currentPosition = [parking.position[0], parking.position[1]];
                meshData.targetPosition = [parking.position[0], parking.position[1]];
                meshData.currentSnap = undefined;
                meshData.targetSnap = undefined;
                meshData.lastUpdate = Date.now();

                // Apply track bearing, then add 90° rotation for perpendicular parking
                const bearingRad = (-parking.trackBearing * Math.PI) / 180;
                const trackRotation = bearingRad + this.MODEL_FORWARD_OFFSET;
                const parkingRotation = trackRotation + Math.PI / 2; // Add 90° for perpendicular

                // Animate rotation into parking instead of snapping
                meshData.parkingRotationAnim = {
                  start: meshData.mesh.rotation.z,
                  target: parkingRotation,
                  startedAt: now,
                  duration: this.PARKING_ROTATION_DURATION_MS,
                  targetIsPerpendicular: true,
                };

                parkingApplied = true;
              }
            }
          }
        }

        // If parking calculation failed, still apply 90° rotation AND ensure position is set
        if (!parkingApplied) {
          const [currentLng, currentLat] = meshData.currentPosition;
          const hasValidPosition = Number.isFinite(currentLng) && Number.isFinite(currentLat);

          // Compute lineId with fallback to station inference for logging
          const logLineId = extractLineFromRouteId(meshData.routeId) ??
            (stationId ? this.stationMap.get(stationId)?.lines?.[0] : null);

          // Get station snap info for debugging
          let stationSnapInfo: string | null = null;
          if (stationId && logLineId) {
            const station = this.stationMap.get(stationId);
            const railway = this.railwayLines.get(logLineId.toUpperCase());
            if (station && railway) {
              const stationCoords: [number, number] = [
                station.geometry.coordinates[0],
                station.geometry.coordinates[1],
              ];
              const snapResult = snapTrainToRailway(stationCoords, railway, 1000);
              stationSnapInfo = snapResult
                ? `snapped at ${snapResult.metersAway.toFixed(0)}m`
                : 'no snap within 1000m';
            }
          }

          trainDebug.parking.warn(`Parking failed: ${meshData.vehicleKey}`, {
            stationId,
            stationFound: !!this.stationMap.get(stationId ?? ''),
            lineId: logLineId,
            lineIdSource: extractLineFromRouteId(meshData.routeId) ? 'routeId' : (logLineId ? 'station' : 'none'),
            railwayFound: !!this.railwayLines.get(logLineId?.toUpperCase() ?? ''),
            hasValidPosition,
            stationSnapInfo,
            trainCoords: hasValidPosition ? `${currentLat.toFixed(5)}, ${currentLng.toFixed(5)}` : 'invalid',
          });
          trainDebug.addMeshParkingFailed(meshData.vehicleKey);

          // CRITICAL: Explicitly set position when parking fails to ensure train is visible
          // Previously this relied on animatePositions, but that could fail in edge cases
          // (zOffset is pre-computed outside the loop)
          if (hasValidPosition) {
            const position = getModelPosition(currentLng, currentLat, 0);
            meshData.mesh.position.set(position.x, position.y, position.z + zOffset);

            // Log the actual mesh position for debugging
            trainDebug.parking.info(`Fallback position set: ${meshData.vehicleKey}`, {
              meshPos: `${meshData.mesh.position.x.toExponential(4)}, ${meshData.mesh.position.y.toExponential(4)}, ${meshData.mesh.position.z.toExponential(4)}`,
              scale: meshData.mesh.scale.x.toExponential(4),
              inScene: meshData.mesh.parent !== null,
            });
          } else {
            trainDebug.parking.error(`Invalid position - cannot render: ${meshData.vehicleKey}`, {
              currentPosition: meshData.currentPosition,
              targetPosition: meshData.targetPosition,
            });
            trainDebug.addMeshInvalidPosition(meshData.vehicleKey);
          }

          meshData.parkingRotationAnim = {
            start: meshData.mesh.rotation.z,
            target: meshData.mesh.rotation.z + Math.PI / 2,
            startedAt: now,
            duration: this.PARKING_ROTATION_DURATION_MS,
            targetIsPerpendicular: true,
          };
        }
      } else if (desiredMode === 'none' && (isCurrentlyPerpendicular || meshData.parkingRotationAnim || wasPerpendicular)) {
        // Train started moving - clear parking data and rotate back to track bearing smoothly
        const baseRotation =
          (meshData.targetSnap?.bearing ?? meshData.currentSnap?.bearing ?? 0) * -Math.PI / 180 +
          this.MODEL_FORWARD_OFFSET;

        meshData.parkingPosition = undefined;
        meshData.parkingRotationAnim = {
          start: meshData.mesh.rotation.z,
          target: baseRotation,
          startedAt: now,
          duration: this.PARKING_ROTATION_DURATION_MS,
          targetIsPerpendicular: false,
        };
        meshData.isParkingRotationApplied = false;
      }

      // Track soft park state in prevStatus proxy to avoid retriggers
      meshData.prevStatus = shouldBePerpendicular ? 'STOPPED_AT' : meshData.status;
    });
  }
}
