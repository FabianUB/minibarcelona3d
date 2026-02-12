/**
 * VehicleClickCoordinator
 *
 * Coordinates click detection across multiple 3D vehicle layers (Rodalies, Metro, Bus, Tram, FGC).
 * Instead of each layer registering its own click handler on the canvas (which causes wrong
 * selections when bounding boxes overlap), MapCanvas registers ONE click handler that queries
 * all visible layers and picks the closest hit.
 */

export interface VehicleHitResult {
  vehicleKey: string;
  distance: number; // normalized 0-1 (center=0, edge=1)
  metadata?: Record<string, unknown>;
}

export type HitResolverFn = (
  point: { x: number; y: number },
  paddingPx: number,
) => VehicleHitResult | null;

export type SelectionCallbackFn = (hit: VehicleHitResult) => void | Promise<void>;

interface LayerEntry {
  resolver: HitResolverFn;
  onSelect: SelectionCallbackFn;
  visible: boolean;
}

export class VehicleClickCoordinator {
  private layers = new Map<string, LayerEntry>();

  /** Register (or update) a layer's hit resolver and selection callback */
  register(
    id: string,
    resolver: HitResolverFn,
    onSelect: SelectionCallbackFn,
    visible: boolean,
  ): void {
    this.layers.set(id, { resolver, onSelect, visible });
  }

  /** Remove a layer from the coordinator */
  unregister(id: string): void {
    this.layers.delete(id);
  }

  /** Update a layer's visibility (hidden layers are skipped during hit resolution) */
  setLayerVisible(id: string, visible: boolean): void {
    const entry = this.layers.get(id);
    if (entry) {
      entry.visible = visible;
    }
  }

  /**
   * Query all visible layers for hits at the given point and return the closest one.
   * Returns null if no layer reports a hit.
   */
  resolveClick(
    point: { x: number; y: number },
    paddingPx: number,
  ): { hit: VehicleHitResult; layerId: string; onSelect: SelectionCallbackFn } | null {
    let best: { hit: VehicleHitResult; layerId: string; onSelect: SelectionCallbackFn } | null = null;

    for (const [layerId, entry] of this.layers) {
      if (!entry.visible) continue;

      const hit = entry.resolver(point, paddingPx);
      if (hit && (!best || hit.distance < best.hit.distance)) {
        best = { hit, layerId, onSelect: entry.onSelect };
      }
    }

    return best;
  }
}
