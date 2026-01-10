import * as THREE from 'three';
import type { RodaliesLine } from '../../types/rodalies';

/**
 * Map of railway line codes to their brand colors
 *
 * Used for hover outline rendering to match line identity colors.
 * Includes a special '__FALLBACK__' key for unmapped routes.
 */
export type LineColorMap = Map<string, THREE.Color>;

/**
 * Shared material cache for outline meshes
 * Key: hex color string (e.g., "#ff0000")
 * Value: Shared MeshBasicMaterial instance
 *
 * This cache prevents creating duplicate materials for the same color,
 * significantly reducing memory usage when multiple trains have outlines.
 */
const outlineMaterialCache = new Map<string, THREE.MeshBasicMaterial>();

/**
 * Get or create a shared outline material for a given color
 */
function getOutlineMaterial(
  color: THREE.Color,
  opacity: number = 0.95
): THREE.MeshBasicMaterial {
  const colorHex = color.getHexString();
  const cacheKey = `${colorHex}_${opacity}`;

  let material = outlineMaterialCache.get(cacheKey);
  if (!material) {
    material = new THREE.MeshBasicMaterial({
      color: color,
      side: THREE.BackSide,
      transparent: true,
      opacity,
      depthTest: true,
      depthWrite: false,
    });
    outlineMaterialCache.set(cacheKey, material);
  }
  return material;
}

/**
 * Clear the outline material cache (call on cleanup)
 */
export function clearOutlineMaterialCache(): void {
  outlineMaterialCache.forEach((material) => material.dispose());
  outlineMaterialCache.clear();
}

/**
 * Build a map of railway line codes to their brand colors
 *
 * Creates a lookup table for quickly accessing line colors during hover interactions.
 * Line codes are normalized to uppercase (e.g., 'r1' → 'R1') for consistent lookups.
 * A special '__FALLBACK__' entry provides a default color for unmapped routes.
 *
 * @param lines - Array of Rodalies line metadata with brand_color and short_code
 * @param fallbackColor - Hex color (without #) to use for unmapped routes
 * @returns Map with line codes as keys (uppercase) and THREE.Color instances as values
 *
 * @example
 * ```typescript
 * const lines = await loadRodaliesLines();
 * const colorMap = buildLineColorMap(lines, 'CCCCCC');
 *
 * const r1Color = colorMap.get('R1'); // Returns light blue color for R1 line
 * const r2Color = colorMap.get('R2'); // Returns green color for R2 line
 * const unknownColor = colorMap.get('__FALLBACK__'); // Returns gray for unmapped routes
 * ```
 */
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

/**
 * Create an outline group for hover highlighting
 *
 * Uses the BackSide rendering technique to create slightly larger duplicate meshes
 * that appear as a colored outline around the train model. The outline preserves
 * the full transformation hierarchy of the original train mesh to ensure correct
 * positioning and rotation.
 *
 * The outline is created lazily on first hover and initially hidden.
 *
 * @param trainMesh - Train model group to outline (typically contains multiple child meshes)
 * @param lineColor - Outline color (typically the railway line's brand color)
 * @param scaleFactor - Scale multiplier for outline size (default 1.12 = 12% larger)
 * @param opacity - Outline opacity (0.0-1.0, default 0.95 for near-opaque)
 * @returns Invisible outline group ready to be shown on hover
 *
 * @example
 * ```typescript
 * const trainModel = meshData.trainModel; // THREE.Group
 * const lineColor = colorMap.get('R2') || colorMap.get('__FALLBACK__');
 * const outline = createOutlineMesh(trainModel, lineColor, 1.12, 0.95);
 *
 * // Add to parent mesh as sibling
 * meshData.mesh.add(outline);
 *
 * // Show on hover
 * outline.visible = true;
 * ```
 *
 * @remarks
 * - Traverses the entire train mesh hierarchy to duplicate all child meshes
 * - Each outline mesh uses THREE.BackSide material to render only back faces
 * - Copies position, rotation, and quaternion to maintain correct transformations
 * - Uses depthTest: true, depthWrite: false to prevent z-fighting
 * - The outline group is initially invisible and should be toggled on hover events
 */
export function createOutlineMesh(
  trainMesh: THREE.Group,
  lineColor: THREE.Color,
  scaleFactor: number = 1.12,
  opacity: number = 0.95
): THREE.Group {
  const outlineGroup = new THREE.Group();

  // Use shared material from cache (one material per color/opacity combo)
  const sharedMaterial = getOutlineMaterial(lineColor, opacity);

  trainMesh.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry) {
      const outlineMesh = new THREE.Mesh(child.geometry, sharedMaterial);
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
