import * as THREE from 'three';
import type { RodaliesLine } from '../../types/rodalies';
import type { LineColorMap } from '../../../../specs/003-train-line-colors-zoom/contracts/train-color-config';

export function buildLineColorMap(
  lines: RodaliesLine[],
  fallbackColor: string = 'CCCCCC'
): LineColorMap {
  const map = new Map<string, THREE.Color>();

  for (const line of lines) {
    const color = new THREE.Color(`#${line.brand_color}`);
    map.set(line.short_code.toUpperCase(), color);
  }

  map.set('__FALLBACK__', new THREE.Color(`#${fallbackColor}`));

  return map;
}

export function createOutlineMesh(
  trainMesh: THREE.Group,
  lineColor: THREE.Color,
  scaleFactor: number = 1.05,
  opacity: number = 0.8
): THREE.Group {
  const outlineGroup = new THREE.Group();

  trainMesh.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry) {
      const outlineMaterial = new THREE.MeshBasicMaterial({
        color: lineColor,
        side: THREE.BackSide,
        transparent: true,
        opacity,
      });

      const outlineMesh = new THREE.Mesh(child.geometry, outlineMaterial);
      outlineMesh.scale.set(scaleFactor, scaleFactor, scaleFactor);

      // Copy full transformation hierarchy from original mesh
      outlineMesh.position.copy(child.position);
      outlineMesh.rotation.copy(child.rotation);
      outlineMesh.quaternion.copy(child.quaternion);
      outlineMesh.scale.multiplyScalar(scaleFactor);

      // Get parent to maintain hierarchy
      if (child.parent && child.parent !== trainMesh) {
        // Find or create matching parent in outline hierarchy
        const parentOutline = outlineGroup;
        parentOutline.add(outlineMesh);
      } else {
        outlineGroup.add(outlineMesh);
      }
    }
  });

  outlineGroup.visible = false;

  return outlineGroup;
}
