import * as THREE from 'three';

// Reuse across calls to avoid GC pressure
const _raycaster = new THREE.Raycaster();
const _nearPoint = new THREE.Vector3();
const _farPoint = new THREE.Vector3();

export interface RaycastHitResult {
  vehicleKey: string;
  distance: number;
  routeId?: string;
  lineCode?: string;
}

/**
 * Traverse up the parent chain to find an ancestor with vehicleKey in userData.
 * GLB models can have deeply nested children; this handles arbitrary depth.
 */
function findVehicleData(
  object: THREE.Object3D,
): { vehicleKey: string; routeId?: string; lineCode?: string } | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    const ud = current.userData;
    if (ud?.vehicleKey) {
      return {
        vehicleKey: ud.vehicleKey as string,
        routeId: ud.routeId as string | undefined,
        lineCode: ud.lineCode as string | undefined,
      };
    }
    current = current.parent;
  }
  return null;
}

/**
 * Collect only Mesh objects from a scene graph, skipping Sprites/Lights/etc.
 * This avoids the "Raycaster.camera needs to be set" error from Sprites.
 */
function collectMeshes(objects: THREE.Object3D[]): THREE.Object3D[] {
  const meshes: THREE.Object3D[] = [];
  function walk(obj: THREE.Object3D) {
    if (obj instanceof THREE.Mesh) {
      meshes.push(obj);
    }
    for (const child of obj.children) {
      walk(child);
    }
  }
  for (const obj of objects) {
    walk(obj);
  }
  return meshes;
}

/**
 * Perform a raycast hit test against 3D vehicle meshes using the Mapbox custom layer camera.
 *
 * Takes the projectionMatrixInverse directly (captured during the render callback)
 * rather than reading it from the camera object, because the Mapbox custom layer's
 * camera.projectionMatrix gets reset to identity between render frames by Three.js
 * internal state management.
 *
 * Since camera.matrixWorld is identity in the Mapbox custom layer setup,
 * unproject is simply: point = projectionMatrixInverse * ndc_point
 */
export function raycastHitTest(
  projMatrixInverse: THREE.Matrix4,
  objects: THREE.Object3D[],
  canvasWidth: number,
  canvasHeight: number,
  screenX: number,
  screenY: number,
): RaycastHitResult | null {
  // Convert screen pixels (CSS) to NDC [-1, +1]
  const ndcX = (screenX / canvasWidth) * 2 - 1;
  const ndcY = -(screenY / canvasHeight) * 2 + 1;

  // Unproject near and far points through stored inverse projection matrix.
  // matrixWorld is identity, so unproject = projectionMatrixInverse * point.
  _nearPoint.set(ndcX, ndcY, -1).applyMatrix4(projMatrixInverse);
  _farPoint.set(ndcX, ndcY, 1).applyMatrix4(projMatrixInverse);

  // Construct ray in model space
  _raycaster.ray.origin.copy(_nearPoint);
  _raycaster.ray.direction.copy(_farPoint).sub(_nearPoint).normalize();

  // Only test against Mesh objects to avoid Sprite "raycaster.camera" errors
  const meshes = collectMeshes(objects);
  const intersects = _raycaster.intersectObjects(meshes, false);

  // Find first hit with vehicleKey in userData (traversing parent chain)
  for (const hit of intersects) {
    const data = findVehicleData(hit.object);
    if (data) {
      console.log(
        `[Raycast] Hit: ${data.vehicleKey} (distance: ${hit.distance.toExponential(4)}) at (${Math.round(screenX)}, ${Math.round(screenY)})`,
      );
      return {
        vehicleKey: data.vehicleKey,
        distance: hit.distance,
        routeId: data.routeId,
        lineCode: data.lineCode,
      };
    }
  }

  return null;
}
