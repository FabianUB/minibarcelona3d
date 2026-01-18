/**
 * ControlPanel Component
 *
 * Unified control panel for all transit networks.
 * Orchestrates between desktop (Card) and mobile (Sheet) variants.
 */

import type { TrainPosition } from '@/types/trains';
import type { Map as MapboxMap } from 'mapbox-gl';
import { ControlPanelDesktop } from './ControlPanelDesktop';
import { ControlPanelMobile } from './ControlPanelMobile';

interface ControlPanelProps {
  rodaliesTrains?: TrainPosition[];
  map?: MapboxMap | null;
  /** Optional function to get actual mesh position (accounts for line snapping) */
  getMeshPosition?: ((vehicleKey: string) => [number, number] | null) | null;
}

export function ControlPanel(props: ControlPanelProps) {
  return (
    <>
      {/* Desktop: Always visible card */}
      <div className="hidden md:block">
        <ControlPanelDesktop {...props} />
      </div>

      {/* Mobile: Button + Sheet */}
      <div className="block md:hidden">
        <ControlPanelMobile {...props} />
      </div>
    </>
  );
}

// Re-export components for direct usage if needed
export { ControlPanelDesktop } from './ControlPanelDesktop';
export { ControlPanelMobile } from './ControlPanelMobile';
