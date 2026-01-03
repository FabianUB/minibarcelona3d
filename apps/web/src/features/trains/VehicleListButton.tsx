/**
 * VehicleListButton - Button and panel for viewing all vehicles
 *
 * Shows Rodalies, Metro, Bus, TRAM, and FGC vehicles in a unified tabbed interface.
 */

import { useState, useCallback } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import type { TrainPosition } from '../../types/trains';
import { VehicleListPanel } from './VehicleListPanel';
import { useMetroPositions } from '../transit/hooks/useMetroPositions';
import { useBusPositions } from '../transit/hooks/useBusPositions';
import { useTramPositions } from '../transit/hooks/useTramPositions';
import { useFgcPositions } from '../transit/hooks/useFgcPositions';
import { useMapState, useMapActions } from '../../state/map/useMapStore';

interface VehicleListButtonProps {
  trains: TrainPosition[];
  map: MapboxMap;
  getMeshPosition?: ((vehicleKey: string) => [number, number] | null) | null;
}

export function VehicleListButton({ trains, map, getMeshPosition }: VehicleListButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Get transport filters state and actions
  const { ui } = useMapState();
  const { setTransportFilter } = useMapActions();

  // Get Metro, Bus, TRAM, and FGC positions from hooks
  const { positions: metroPositions } = useMetroPositions({ enabled: true });
  const { positions: busPositions } = useBusPositions({ enabled: true });
  const { positions: tramPositions } = useTramPositions({ enabled: true });
  const { positions: fgcPositions } = useFgcPositions({ enabled: true });

  const handleOpen = useCallback(() => {
    setIsOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  return (
    <>
      {/* Vehicle List Button - positioned between legend and settings buttons on left */}
      <button
        onClick={handleOpen}
        className="hidden md:flex fixed top-20 left-4 w-12 h-12 rounded-full bg-card shadow-lg z-10 items-center justify-center hover:scale-105 transition-transform border border-border"
        aria-label="Show vehicle list"
        title="View Vehicle List"
        data-testid="vehicle-list-trigger"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-foreground"
        >
          {/* List icon */}
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      </button>

      {/* Vehicle List Panel */}
      <VehicleListPanel
        trains={trains}
        metroPositions={metroPositions}
        busPositions={busPositions}
        tramPositions={tramPositions}
        fgcPositions={fgcPositions}
        transportFilters={ui.transportFilters}
        setTransportFilter={setTransportFilter}
        map={map}
        isOpen={isOpen}
        onClose={handleClose}
        getMeshPosition={getMeshPosition}
      />
    </>
  );
}
