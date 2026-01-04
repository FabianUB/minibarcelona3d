/**
 * TransitInfoPanelMobile Component
 *
 * Mobile version of the transit info panel (Sheet-based slide-up drawer).
 * Displays information about selected Metro/TRAM/FGC/Bus vehicles.
 */

import { useEffect } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useMapActions } from '@/state/map';
import { useTransitState, useTransitActions } from '@/state/transit';
import { getMetroLineConfig } from '@/config/metroConfig';
import { getTramLineConfig } from '@/config/tramConfig';
import { getFgcLineConfig } from '@/config/fgcConfig';
import { getBusRouteConfig } from '@/config/busConfig';
import type { TransportType } from '@/types/transit';
import type { LineConfig } from '@/types/transit';
import { TransitStopList } from './TransitStopList';

/**
 * Get line configuration for any transit network type
 */
function getTransitLineConfig(
  networkType: TransportType,
  lineCode: string
): LineConfig | undefined {
  switch (networkType) {
    case 'metro':
      return getMetroLineConfig(lineCode);
    case 'tram':
      return getTramLineConfig(lineCode);
    case 'fgc':
      return getFgcLineConfig(lineCode);
    case 'bus':
      return getBusRouteConfig(lineCode);
    default:
      return undefined;
  }
}

/**
 * Get network label for display
 */
function getNetworkLabel(networkType: TransportType): string {
  switch (networkType) {
    case 'metro':
      return 'Metro';
    case 'tram':
      return 'Tram';
    case 'fgc':
      return 'FGC';
    case 'bus':
      return 'Bus';
    default:
      return 'Transit';
  }
}

export function TransitInfoPanelMobile() {
  const { setActivePanel } = useMapActions();
  const { selectedVehicle, isPanelOpen } = useTransitState();
  const { clearSelection } = useTransitActions();

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      clearSelection();
      setActivePanel('none');
    }
  };

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isPanelOpen) {
        clearSelection();
        setActivePanel('none');
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isPanelOpen, clearSelection, setActivePanel]);

  if (!selectedVehicle) {
    return null;
  }

  // Get line configuration based on network type
  const lineConfig = getTransitLineConfig(
    selectedVehicle.networkType,
    selectedVehicle.lineCode
  );
  const networkLabel = getNetworkLabel(selectedVehicle.networkType);

  return (
    <Sheet open={isPanelOpen} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        className="h-auto max-h-[80vh] flex flex-col"
        data-testid="transit-info-panel-mobile"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Badge
              variant="default"
              style={{ backgroundColor: lineConfig?.color || selectedVehicle.lineColor || '#666' }}
              className="text-white font-semibold"
            >
              {selectedVehicle.lineCode}
            </Badge>
            <span className="text-base font-normal text-muted-foreground">
              {networkLabel}
            </span>
          </SheetTitle>
          <SheetDescription>
            {lineConfig?.name || 'Vehicle information'}
          </SheetDescription>
        </SheetHeader>

        <Separator className="my-1" />

        <div className="flex-1 overflow-y-auto pb-6 space-y-3">
          {/* Line info with colored badge */}
          {lineConfig && (
            <>
              <div className="flex items-center justify-center gap-2">
                <Badge
                  variant="default"
                  style={{ backgroundColor: lineConfig.color }}
                  className="text-white font-semibold"
                >
                  {lineConfig.lineCode}
                </Badge>
                <span className="text-sm font-medium">{lineConfig.name}</span>
              </div>
              <Separator />
            </>
          )}

          {/* Stops section */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground text-center">Stops</h3>
            <TransitStopList
              vehicleKey={selectedVehicle.vehicleKey}
              tripId={selectedVehicle.tripId}
              previousStopId={selectedVehicle.previousStopId}
              nextStopId={selectedVehicle.nextStopId}
              previousStopName={selectedVehicle.previousStopName}
              nextStopName={selectedVehicle.nextStopName}
              status={selectedVehicle.status}
              progressFraction={selectedVehicle.progressFraction}
              networkType={selectedVehicle.networkType}
            />
          </div>

          {/* Position source indicator */}
          <Separator />
          <div className="text-xs text-muted-foreground text-center">
            {selectedVehicle.networkType === 'metro'
              ? 'Position from iMetro / simulation'
              : 'Position estimated from schedule'}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
