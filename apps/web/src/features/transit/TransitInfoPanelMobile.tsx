/**
 * TransitInfoPanelMobile Component
 *
 * Mobile version of the transit info panel (Sheet-based slide-up drawer).
 * Displays information about selected Metro/TRAM/FGC/Bus vehicles.
 */

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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

export function TransitInfoPanelMobile() {
  const { t } = useTranslation('vehicles');
  const { setActivePanel } = useMapActions();
  const { selectedVehicle, isPanelOpen } = useTransitState();
  const { clearSelection } = useTransitActions();

  // Get network label for display using translations
  const getNetworkLabel = (networkType: TransportType): string => {
    switch (networkType) {
      case 'metro':
        return t('network.metro');
      case 'tram':
        return t('network.tram');
      case 'fgc':
        return t('network.fgc');
      case 'bus':
        return t('network.bus');
      default:
        return t('network.transit');
    }
  };

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
            {lineConfig?.name || t('transit.vehicleInfo')}
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
            <h3 className="text-sm font-semibold text-foreground text-center">{t('transit.stops')}</h3>
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
              ? t('transit.positionMetro')
              : t('transit.positionSchedule')}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
