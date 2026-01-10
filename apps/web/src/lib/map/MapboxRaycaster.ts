/**
 * MapboxRaycaster - Three.js Raycasting for Mapbox GL JS Custom Layers
 *
 * Provides accurate 3D raycasting for click/hover detection on Three.js meshes
 * rendered via Mapbox's Custom Layer API.
 *
 * Key insight: Mapbox provides camera position (center + altitude) and we can
 * use map.unproject() to get world coordinates from screen points. This lets
 * us construct proper 3D rays without needing to invert Mapbox's projection matrix.
 *
 * @see https://docs.mapbox.com/mapbox-gl-js/api/map/#map#unproject
 * @see https://threejs.org/docs/#api/en/core/Raycaster
 */

import * as THREE from 'three';
import type { Map as MapboxMap } from 'mapbox-gl';
import { getModelPosition, getModelScale, getModelOrigin } from './coordinates';

/**
 * Result of a raycast intersection test
 */
export interface RaycastHit {
  /** The intersected Three.js object */
  object: THREE.Object3D;
  /** Distance from ray origin to intersection point (in model units) */
  distance: number;
  /** The intersection point in world coordinates */
  point: THREE.Vector3;
  /** Face that was hit (if available) */
  face?: THREE.Face | null;
  /** UV coordinates at intersection (if available) */
  uv?: THREE.Vector2;
  /** Custom user data attached to the object */
  userData?: Record<string, unknown>;
}

/**
 * Debug information for visualizing the ray
 */
export interface RayDebugInfo {
  /** Ray origin in model space */
  origin: THREE.Vector3;
  /** Ray direction (normalized) */
  direction: THREE.Vector3;
  /** Camera position in world coordinates (lng, lat, alt) */
  cameraWorldPos: { lng: number; lat: number; altitude: number };
  /** Target point on ground plane */
  targetWorldPos: { lng: number; lat: number };
  /** Screen point that was clicked */
  screenPoint: { x: number; y: number };
}

/**
 * MapboxRaycaster - Bridges Mapbox GL JS and Three.js for 3D picking
 *
 * Usage:
 * ```typescript
 * const raycaster = new MapboxRaycaster();
 *
 * canvas.addEventListener('click', (event) => {
 *   const rect = canvas.getBoundingClientRect();
 *   const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
 *
 *   raycaster.setFromMapboxClick(map, point);
 *   const hits = raycaster.intersectObjects(meshes);
 *
 *   if (hits.length > 0) {
 *     console.log('Hit:', hits[0].object.userData);
 *   }
 * });
 * ```
 */
export class MapboxRaycaster {
  private raycaster: THREE.Raycaster;
  private _lastDebugInfo: RayDebugInfo | null = null;

  // Reusable vectors to avoid allocations
  private readonly _origin = new THREE.Vector3();
  private readonly _target = new THREE.Vector3();
  private readonly _direction = new THREE.Vector3();

  constructor() {
    this.raycaster = new THREE.Raycaster();
    // Set a reasonable far distance for the raycaster
    this.raycaster.far = 10000;
    // Set near to avoid self-intersection issues
    this.raycaster.near = 0.001;
  }

  /**
   * Configure the raycaster from a Mapbox map click/hover point
   *
   * This method:
   * 1. Gets the camera position from Mapbox (center + altitude)
   * 2. Unprojects the screen point to get the target on the ground
   * 3. Creates a ray from camera through the target point
   *
   * @param map - The Mapbox GL JS map instance
   * @param screenPoint - Screen coordinates {x, y} relative to canvas
   */
  setFromMapboxClick(
    map: MapboxMap,
    screenPoint: { x: number; y: number }
  ): void {
    const modelOrigin = getModelOrigin();
    if (!modelOrigin) {
      console.warn('MapboxRaycaster: Model origin not set');
      return;
    }

    // 1. Get camera position from Mapbox
    // The camera looks at the map center from above
    const center = map.getCenter();
    const pitch = map.getPitch();
    const bearing = map.getBearing();
    const zoom = map.getZoom();

    // Calculate camera altitude using Mapbox's method
    // At zoom 0, the world is 512px, and altitude is roughly world height
    // This formula approximates Mapbox's internal camera altitude calculation
    const metersPerPixel = 156543.03392 * Math.cos((center.lat * Math.PI) / 180) / Math.pow(2, zoom);
    const canvas = map.getCanvas();
    const halfHeight = canvas.height / 2;

    // Camera altitude in meters (distance from ground to camera)
    // Adjust for pitch - when pitched, camera is further from center
    const pitchRadians = (pitch * Math.PI) / 180;
    const cameraAltitude = (halfHeight * metersPerPixel) / Math.cos(pitchRadians);

    // Convert camera position to model space
    const scale = getModelScale();
    const cameraModelPos = getModelPosition(center.lng, center.lat, 0);

    // Camera is above the center point
    // For pitched view, camera is offset backwards
    const cameraHeight = cameraAltitude * scale;

    // Calculate camera offset due to pitch and bearing
    const bearingRadians = (bearing * Math.PI) / 180;
    const horizontalOffset = cameraHeight * Math.tan(pitchRadians);

    // Camera position in model space
    this._origin.set(
      cameraModelPos.x - horizontalOffset * Math.sin(bearingRadians),
      cameraModelPos.y - horizontalOffset * Math.cos(bearingRadians),
      cameraHeight
    );

    // 2. Unproject the screen point to get target on ground
    // map.unproject() gives us the lng/lat at that screen point
    const targetLngLat = map.unproject([screenPoint.x, screenPoint.y]);
    const targetModelPos = getModelPosition(targetLngLat.lng, targetLngLat.lat, 0);

    this._target.set(targetModelPos.x, targetModelPos.y, 0);

    // 3. Calculate ray direction
    this._direction.copy(this._target).sub(this._origin).normalize();

    // 4. Set up the raycaster
    this.raycaster.set(this._origin, this._direction);

    // Store debug info
    this._lastDebugInfo = {
      origin: this._origin.clone(),
      direction: this._direction.clone(),
      cameraWorldPos: { lng: center.lng, lat: center.lat, altitude: cameraAltitude },
      targetWorldPos: { lng: targetLngLat.lng, lat: targetLngLat.lat },
      screenPoint: { ...screenPoint },
    };
  }

  /**
   * Alternative method using Mapbox's FreeCameraOptions (more accurate for 3D)
   *
   * This uses Mapbox's internal camera representation which may be more accurate
   * for complex pitch/bearing scenarios.
   */
  setFromMapboxClickPrecise(
    map: MapboxMap,
    screenPoint: { x: number; y: number }
  ): void {
    const modelOrigin = getModelOrigin();
    if (!modelOrigin) {
      console.warn('MapboxRaycaster: Model origin not set');
      return;
    }

    // Try to get free camera options (available in newer Mapbox versions)
    const freeCameraOptions = map.getFreeCameraOptions?.();

    if (freeCameraOptions?.position) {
      // Use Mapbox's actual camera position
      const camPos = freeCameraOptions.position;
      const camLngLat = camPos.toLngLat();
      const camAltitude = camPos.toAltitude();

      const scale = getModelScale();
      const cameraModelPos = getModelPosition(camLngLat.lng, camLngLat.lat, 0);

      this._origin.set(
        cameraModelPos.x,
        cameraModelPos.y,
        camAltitude * scale
      );
    } else {
      // Fall back to calculated position
      this.setFromMapboxClick(map, screenPoint);
      return;
    }

    // Unproject target
    const targetLngLat = map.unproject([screenPoint.x, screenPoint.y]);
    const targetModelPos = getModelPosition(targetLngLat.lng, targetLngLat.lat, 0);

    this._target.set(targetModelPos.x, targetModelPos.y, 0);
    this._direction.copy(this._target).sub(this._origin).normalize();

    this.raycaster.set(this._origin, this._direction);

    // Store debug info
    const center = map.getCenter();
    const freeCam = map.getFreeCameraOptions?.();
    const altitude = freeCam?.position?.toAltitude() ?? 0;

    this._lastDebugInfo = {
      origin: this._origin.clone(),
      direction: this._direction.clone(),
      cameraWorldPos: { lng: center.lng, lat: center.lat, altitude },
      targetWorldPos: { lng: targetLngLat.lng, lat: targetLngLat.lat },
      screenPoint: { ...screenPoint },
    };
  }

  /**
   * Test intersection with an array of Three.js objects
   *
   * @param objects - Array of Three.js objects to test
   * @param recursive - Whether to check descendants (default: true)
   * @returns Array of intersection results, sorted by distance (nearest first)
   */
  intersectObjects(
    objects: THREE.Object3D[],
    recursive: boolean = true
  ): RaycastHit[] {
    const intersections = this.raycaster.intersectObjects(objects, recursive);

    return intersections.map((intersection) => ({
      object: intersection.object,
      distance: intersection.distance,
      point: intersection.point,
      face: intersection.face,
      uv: intersection.uv,
      userData: intersection.object.userData,
    }));
  }

  /**
   * Test intersection with a single Three.js object
   *
   * @param object - The Three.js object to test
   * @param recursive - Whether to check descendants (default: true)
   * @returns Array of intersection results
   */
  intersectObject(
    object: THREE.Object3D,
    recursive: boolean = true
  ): RaycastHit[] {
    const intersections = this.raycaster.intersectObject(object, recursive);

    return intersections.map((intersection) => ({
      object: intersection.object,
      distance: intersection.distance,
      point: intersection.point,
      face: intersection.face,
      uv: intersection.uv,
      userData: intersection.object.userData,
    }));
  }

  /**
   * Get the underlying Three.js Raycaster for advanced usage
   */
  getRaycaster(): THREE.Raycaster {
    return this.raycaster;
  }

  /**
   * Get debug information about the last ray cast
   * Useful for visualizing the ray in debug mode
   */
  getLastDebugInfo(): RayDebugInfo | null {
    return this._lastDebugInfo;
  }

  /**
   * Set custom near/far planes for the raycaster
   *
   * @param near - Near plane distance
   * @param far - Far plane distance
   */
  setNearFar(near: number, far: number): void {
    this.raycaster.near = near;
    this.raycaster.far = far;
  }

  /**
   * Set raycaster line threshold for line geometry intersection
   * Useful when testing against lines or thin geometry
   *
   * @param threshold - Threshold in model units
   */
  setLineThreshold(threshold: number): void {
    if (this.raycaster.params.Line) {
      this.raycaster.params.Line.threshold = threshold;
    }
  }

  /**
   * Set raycaster point threshold for point geometry intersection
   *
   * @param threshold - Threshold in model units
   */
  setPointThreshold(threshold: number): void {
    if (this.raycaster.params.Points) {
      this.raycaster.params.Points.threshold = threshold;
    }
  }
}

/**
 * Create a debug helper to visualize the ray in the scene
 *
 * @param debugInfo - Debug info from raycaster
 * @param length - Length of the debug line
 * @returns A Three.js Line object to add to the scene
 */
export function createRayDebugHelper(
  debugInfo: RayDebugInfo,
  length: number = 1000
): THREE.Line {
  const points = [
    debugInfo.origin.clone(),
    debugInfo.origin.clone().add(debugInfo.direction.clone().multiplyScalar(length)),
  ];

  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color: 0xff0000,
    linewidth: 2,
    depthTest: false,
    depthWrite: false,
  });

  const line = new THREE.Line(geometry, material);
  line.renderOrder = 9999; // Render on top

  return line;
}

/**
 * Create a sphere helper to visualize the ray origin
 *
 * @param position - Position for the sphere
 * @param radius - Radius of the sphere
 * @param color - Color of the sphere
 * @returns A Three.js Mesh sphere
 */
export function createPointDebugHelper(
  position: THREE.Vector3,
  radius: number = 0.1,
  color: number = 0x00ff00
): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(radius, 16, 16);
  const material = new THREE.MeshBasicMaterial({
    color,
    depthTest: false,
    depthWrite: false,
  });

  const sphere = new THREE.Mesh(geometry, material);
  sphere.position.copy(position);
  sphere.renderOrder = 9999;

  return sphere;
}
