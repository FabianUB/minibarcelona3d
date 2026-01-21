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
import { useTransitState } from '@/state/transit';
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
import { DataSourceBadge } from './components/DataSourceBadge';
import { LanguageToggle } from '@/components/LanguageToggle';

interface ControlPanelMobileProps {
  rodaliesTrains?: TrainPosition[];
  map?: MapboxMap | null;
  /** Optional function to get actual mesh position (accounts for line snapping) */
  getMeshPosition?: ((vehicleKey: string) => [number, number] | null) | null;
}

export function ControlPanelMobile({
  rodaliesTrains = [],
  map,
  getMeshPosition,
}: ControlPanelMobileProps) {
  const { ui } = useMapState();
  const { dataSourceStatus } = useTransitState();
  const [isOpen, setIsOpen] = useState(false);

  const isControlMode = ui.controlPanelMode === 'controls';
  const activeNetwork = ui.activeControlTab;
  const isVehicleMode = !isControlMode;

  // Only fetch positions when in vehicle list mode AND for the active network
  // This prevents unnecessary API polling for inactive tabs
  const { positions: metroPositions } = useMetroPositions({
    enabled: isVehicleMode && activeNetwork === 'metro',
  });
  const { positions: busPositions } = useBusPositions({
    enabled: isVehicleMode && activeNetwork === 'bus',
    filterTopLinesOnly: ui.showOnlyTopBusLines,
  });
  const { positions: tramPositions } = useTramPositions({
    enabled: isVehicleMode && activeNetwork === 'tram',
  });
  const { positions: fgcPositions } = useFgcPositions({
    enabled: isVehicleMode && activeNetwork === 'fgc',
  });
  const dataSource = dataSourceStatus[activeNetwork];

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
            <div className="flex items-center gap-2">
              <LanguageToggle />
              <DataSourceBadge source={dataSource} />
            </div>
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
              getMeshPosition={getMeshPosition}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
