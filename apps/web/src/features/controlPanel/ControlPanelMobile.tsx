/**
 * ControlPanelMobile Component
 *
 * Mobile version of the unified control panel using Sheet (bottom drawer).
 */

import { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useMapState } from '@/state/map';
import type { TrainPosition } from '@/types/trains';
import type { Map as MapboxMap } from 'mapbox-gl';
import { useMetroPositions } from '../transit/hooks/useMetroPositions';
import { useBusPositions } from '../transit/hooks/useBusPositions';
import { useTramPositions } from '../transit/hooks/useTramPositions';
import { useFgcPositions } from '../transit/hooks/useFgcPositions';
import { NetworkTabs } from './components/NetworkTabs';
import { NetworkTabContent } from './components/NetworkTabContent';
import { VehicleListView } from './components/VehicleListView';
import { PanelModeToggle } from './components/PanelModeToggle';

interface ControlPanelMobileProps {
  rodaliesTrains?: TrainPosition[];
  map?: MapboxMap | null;
}

export function ControlPanelMobile({
  rodaliesTrains = [],
  map,
}: ControlPanelMobileProps) {
  const { ui } = useMapState();
  const [isOpen, setIsOpen] = useState(false);

  // Get transit positions from hooks
  const { positions: metroPositions } = useMetroPositions({ enabled: true });
  const { positions: busPositions } = useBusPositions({ enabled: true });
  const { positions: tramPositions } = useTramPositions({ enabled: true });
  const { positions: fgcPositions } = useFgcPositions({ enabled: true });

  const isControlMode = ui.controlPanelMode === 'controls';
  const activeNetwork = ui.activeControlTab;

  const handleVehicleClick = (lat: number, lng: number) => {
    if (map) {
      map.flyTo({
        center: [lng, lat],
        zoom: 15,
        duration: 1000,
      });
      setIsOpen(false);
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="fixed bottom-4 left-4 w-12 h-12 rounded-full shadow-lg z-10"
          aria-label="Open control panel"
        >
          <span className="text-xl">🚆</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="h-[70vh] flex flex-col">
        <SheetHeader className="pb-2 shrink-0">
          <SheetTitle className="flex items-center justify-between text-sm">
            <span>{isControlMode ? 'Transit Control' : 'Vehicle List'}</span>
            <PanelModeToggle />
          </SheetTitle>
        </SheetHeader>

        {/* Network Tabs */}
        <div className="pb-2 shrink-0">
          <NetworkTabs />
        </div>

        {/* Content area - scrollable */}
        <div className="flex-1 overflow-auto">
          {isControlMode ? (
            <NetworkTabContent network={activeNetwork} />
          ) : (
            <VehicleListView
              network={activeNetwork}
              rodaliesTrains={rodaliesTrains}
              metroPositions={metroPositions}
              busPositions={busPositions}
              tramPositions={tramPositions}
              fgcPositions={fgcPositions}
              onVehicleClick={handleVehicleClick}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
