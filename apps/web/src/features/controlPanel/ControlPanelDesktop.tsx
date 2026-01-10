/**
 * ControlPanelDesktop Component
 *
 * Desktop version of the unified control panel.
 * Fixed position on top-left, always visible.
 * Two modes: Controls and Vehicle List.
 */

import { Card, CardContent } from '@/components/ui/card';
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
import { DataSourceBadge } from './components/DataSourceBadge';

interface ControlPanelDesktopProps {
  rodaliesTrains?: TrainPosition[];
  map?: MapboxMap | null;
}

export function ControlPanelDesktop({
  rodaliesTrains = [],
  map,
}: ControlPanelDesktopProps) {
  const { ui } = useMapState();
  const { dataSourceStatus } = useTransitState();

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
    }
  };

  return (
    <Card className="fixed top-4 left-4 w-80 shadow-xl z-10 max-h-[calc(100vh-2rem)] flex flex-col border-0 bg-background/95 backdrop-blur-sm">
      {/* Data source indicator */}
      <div className="px-4 pt-3 pb-1 shrink-0 flex justify-end">
        <DataSourceBadge source={dataSource} />
      </div>

      {/* Network Tabs */}
      <div className="px-4 pb-3 shrink-0">
        <NetworkTabs />
      </div>

      {/* Content area - scrollable */}
      <CardContent className="flex-1 overflow-auto pt-0 pb-4 px-4">
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
      </CardContent>
    </Card>
  );
}
