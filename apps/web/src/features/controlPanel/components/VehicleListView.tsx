/**
 * VehicleListView Component
 *
 * Simplified vehicle list view for the control panel.
 * Shows active vehicles for the selected network tab.
 */

import { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useMapState, useMapActions } from '@/state/map';
import type { TransportType } from '@/types/rodalies';
import type { TrainPosition } from '@/types/trains';
import type { VehiclePosition } from '@/types/transit';
import { METRO_LINE_CONFIG } from '@/config/metroConfig';
import { TRAM_LINE_CONFIG } from '@/config/tramConfig';
import { FGC_LINE_CONFIG } from '@/config/fgcConfig';
import { getBusRouteConfig } from '@/config/busConfig';
import { NETWORK_TABS } from '../types';

interface VehicleListViewProps {
  network: TransportType;
  rodaliesTrains?: TrainPosition[];
  metroPositions?: VehiclePosition[];
  busPositions?: VehiclePosition[];
  tramPositions?: VehiclePosition[];
  fgcPositions?: VehiclePosition[];
  onVehicleClick?: (lat: number, lng: number) => void;
  className?: string;
}

function getLineColor(lineCode: string): string {
  // Check Metro config
  const metroConfig = METRO_LINE_CONFIG[lineCode];
  if (metroConfig) return metroConfig.color;

  // Check TRAM config
  const tramConfig = TRAM_LINE_CONFIG[lineCode];
  if (tramConfig) return tramConfig.color;

  // Check FGC config
  const fgcConfig = FGC_LINE_CONFIG[lineCode];
  if (fgcConfig) return fgcConfig.color;

  // Use Bus config
  const busConfig = getBusRouteConfig(lineCode);
  if (busConfig) return busConfig.color;

  return '#666666';
}

export function VehicleListView({
  network,
  rodaliesTrains = [],
  metroPositions = [],
  busPositions = [],
  tramPositions = [],
  fgcPositions = [],
  onVehicleClick,
  className,
}: VehicleListViewProps) {
  const { ui } = useMapState();
  const { setControlPanelMode } = useMapActions();
  const parentRef = useRef<HTMLDivElement>(null);
  const networkTab = NETWORK_TABS.find((t) => t.type === network);

  // Get vehicles for current network
  const vehicles = useMemo(() => {
    switch (network) {
      case 'rodalies':
        return rodaliesTrains.map((t) => ({
          key: t.vehicleKey,
          lineCode: t.routeId?.match(/R[GLT]?\d+[NS]?$/i)?.[0]?.toUpperCase() || 'N/A',
          status: t.status,
          nextStop: t.nextStopId || '-',
          lat: t.latitude,
          lng: t.longitude,
        }));
      case 'metro':
        return metroPositions.map((v) => ({
          key: v.vehicleKey,
          lineCode: v.lineCode,
          status: v.status,
          nextStop: v.nextStopName || '-',
          lat: v.latitude,
          lng: v.longitude,
        }));
      case 'bus':
        return busPositions.map((v) => ({
          key: v.vehicleKey,
          lineCode: v.lineCode,
          status: v.status,
          nextStop: v.nextStopName || '-',
          lat: v.latitude,
          lng: v.longitude,
        }));
      case 'tram':
        return tramPositions.map((v) => ({
          key: v.vehicleKey,
          lineCode: v.lineCode,
          status: v.status,
          nextStop: v.nextStopName || '-',
          lat: v.latitude,
          lng: v.longitude,
        }));
      case 'fgc':
        return fgcPositions.map((v) => ({
          key: v.vehicleKey,
          lineCode: v.lineCode,
          status: v.status,
          nextStop: v.nextStopName || '-',
          lat: v.latitude,
          lng: v.longitude,
        }));
      default:
        return [];
    }
  }, [network, rodaliesTrains, metroPositions, busPositions, tramPositions, fgcPositions]);

  const virtualizer = useVirtualizer({
    count: vehicles.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 5,
  });

  if (!ui.transportFilters[network]) {
    return (
      <div className={cn('py-8 text-center text-muted-foreground', className)}>
        <p className="text-sm">Network disabled</p>
        <p className="text-xs mt-1">Enable {network} to see vehicles</p>
      </div>
    );
  }

  if (vehicles.length === 0) {
    return (
      <div className={cn('py-8 text-center text-muted-foreground', className)}>
        <p className="text-sm">No active vehicles</p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {/* Header with back button */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="text-lg">{networkTab?.icon}</span>
          <span className="font-semibold text-sm">Vehicles</span>
          <span className="text-xs text-muted-foreground">
            ({vehicles.length})
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setControlPanelMode('controls')}
          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          title="Back to controls"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Controls
        </Button>
      </div>

      <div
        ref={parentRef}
        className="h-[300px] overflow-auto border rounded-md"
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const vehicle = vehicles[virtualItem.index];

            return (
              <div
                key={virtualItem.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualItem.size}px`,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <button
                  onClick={() => vehicle.lat && vehicle.lng && onVehicleClick?.(vehicle.lat, vehicle.lng)}
                  className="w-full h-full px-3 py-2 flex items-center gap-3 text-left hover:bg-muted/50 transition-colors border-b"
                >
                  <span
                    className="w-10 h-6 flex items-center justify-center rounded text-xs font-bold text-white shrink-0"
                    style={{ backgroundColor: getLineColor(vehicle.lineCode) }}
                  >
                    {vehicle.lineCode}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {vehicle.nextStop}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {vehicle.status || 'In service'}
                    </div>
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="text-xs text-muted-foreground text-center">
        Click on a vehicle to center the map
      </div>
    </div>
  );
}
