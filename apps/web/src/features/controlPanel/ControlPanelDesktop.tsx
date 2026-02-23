/**
 * ControlPanelDesktop Component
 *
 * Desktop version of the unified control panel.
 * Fixed position on top-left, always visible.
 * Two modes: Controls and Vehicle List.
 * Collapsible — persists state to localStorage.
 */

import { useTranslation } from 'react-i18next';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { useMapNetwork, useMapActions } from '@/state/map';
import { useTransitState } from '@/state/transit';
import type { TrainPosition } from '@/types/trains';
import type { Map as MapboxMap } from 'mapbox-gl';
import { useMetroPositions } from '../transit/hooks/useMetroPositions';
import { useBusPositions } from '../transit/hooks/useBusPositions';
import { useTramPositions } from '../transit/hooks/useTramPositions';
import { useFgcPositions } from '../transit/hooks/useFgcPositions';
import { NetworkTabContent } from './components/NetworkTabContent';
import { VehicleListView } from './components/VehicleListView';
import { DataSourceBadge } from './components/DataSourceBadge';
import { LanguageToggle } from '@/components/LanguageToggle';
import { usePanelCollapsed } from './hooks/usePanelCollapsed';

interface ControlPanelDesktopProps {
  rodaliesTrains?: TrainPosition[];
  map?: MapboxMap | null;
  /** Optional function to get actual mesh position (accounts for line snapping) */
  getMeshPosition?: ((vehicleKey: string) => [number, number] | null) | null;
}

export function ControlPanelDesktop({
  rodaliesTrains = [],
  map,
  getMeshPosition,
}: ControlPanelDesktopProps) {
  const { t } = useTranslation('controlPanel');
  const { controlPanelMode, activeControlTab, showOnlyTopBusLines } = useMapNetwork();
  const { setControlPanelMode } = useMapActions();
  const { dataSourceStatus } = useTransitState();
  const { collapsed, toggle } = usePanelCollapsed();

  const isControlMode = controlPanelMode === 'controls';
  const activeNetwork = activeControlTab;
  const isVehicleMode = !isControlMode;

  // Only fetch positions when in vehicle list mode AND for the active network
  // This prevents unnecessary API polling for inactive tabs
  const { positions: metroPositions } = useMetroPositions({
    enabled: isVehicleMode && activeNetwork === 'metro',
  });
  const { positions: busPositions } = useBusPositions({
    enabled: isVehicleMode && activeNetwork === 'bus',
    filterTopLinesOnly: showOnlyTopBusLines,
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

  // Collapsed state: show a small tab peeking from the left edge
  if (collapsed) {
    return (
      <button
        onClick={toggle}
        aria-label={t('panel.expand')}
        title={t('panel.expand')}
        className="fixed top-3 left-0 z-10 flex items-center gap-1 pl-2 pr-2.5 py-2.5 bg-background/95 backdrop-blur-sm border border-l-0 border-border/50 rounded-r-xl shadow-xl hover:pl-3 transition-all duration-200 text-muted-foreground hover:text-foreground"
      >
        <ChevronsRight className="w-4 h-4" />
      </button>
    );
  }

  return (
    <div className="fixed top-3 left-4 z-10">
      <Card className="w-80 shadow-xl max-h-[calc(100vh-1.5rem)] flex flex-col border-0 bg-background/95 backdrop-blur-sm">
        {/* Header row: Language toggle + Mode toggle + DataSource */}
        <div className="px-3 pt-2.5 pb-2 shrink-0 flex items-center justify-between gap-2">
          <LanguageToggle />
          <div className="flex items-center gap-1 p-0.5 bg-muted/50 rounded-lg">
            <button
              onClick={() => setControlPanelMode('controls')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all duration-150 ${
                isControlMode
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('modes.controls')}
            </button>
            <button
              onClick={() => setControlPanelMode('vehicles')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all duration-150 ${
                !isControlMode
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('modes.vehicles')}
            </button>
          </div>
          <DataSourceBadge source={dataSource} />
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
              getMeshPosition={getMeshPosition}
            />
          )}
        </CardContent>
      </Card>

      {/* Collapse tab — bottom-right corner, like a page fold */}
      <button
        onClick={toggle}
        aria-label={t('panel.collapse')}
        title={t('panel.collapse')}
        className="absolute -bottom-3 -right-3 w-8 h-8 flex items-center justify-center rounded-full bg-background/95 backdrop-blur-sm border border-border/50 shadow-lg text-muted-foreground hover:text-foreground hover:scale-110 transition-all duration-200"
      >
        <ChevronsLeft className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
