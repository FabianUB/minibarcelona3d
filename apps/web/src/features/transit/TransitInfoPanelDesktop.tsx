/**
 * TransitInfoPanelDesktop Component
 *
 * Desktop version of the transit info panel (Card-based).
 * Displays information about selected Metro/TRAM/FGC/Bus vehicles.
 */

import { useCallback, useRef } from 'react';
import { useDismissPanel } from '@/hooks/useDismissPanel';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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

export function TransitInfoPanelDesktop() {
  const { t } = useTranslation('vehicles');
  const { setActivePanel } = useMapActions();
  const { selectedVehicle } = useTransitState();
  const { clearSelection } = useTransitActions();
  const panelRef = useRef<HTMLDivElement>(null);

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

  const handleClose = useCallback(() => {
    clearSelection();
    setActivePanel('none');
  }, [clearSelection, setActivePanel]);

  useDismissPanel(panelRef, handleClose);

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
    <Card
      ref={panelRef}
      className="fixed bottom-4 left-1/2 -translate-x-1/2 w-96 shadow-lg z-10 border border-border gap-0 animate-slide-up"
      data-testid="transit-info-panel-desktop"
    >
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center justify-between text-base">
          <div className="flex items-center gap-2">
            <Badge
              variant="default"
              style={{ backgroundColor: lineConfig?.color || selectedVehicle.lineColor || '#666' }}
              className="text-white font-semibold"
            >
              {selectedVehicle.lineCode}
            </Badge>
            <span className="text-sm font-normal text-muted-foreground">
              {networkLabel}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
            className="h-7 w-7 p-0 hover:bg-accent"
            aria-label={t('transit.closePanel')}
          >
            ✕
          </Button>
        </CardTitle>
      </CardHeader>

      <CardContent className="pt-4 pb-4 space-y-3">
        {/* Line name with colored badge */}
        {(lineConfig || selectedVehicle.routeLongName) && (
          <>
            <div className="flex items-center gap-2">
              <Badge
                variant="default"
                style={{ backgroundColor: lineConfig?.color || selectedVehicle.lineColor || '#666' }}
                className="text-white font-semibold"
              >
                {lineConfig?.lineCode || selectedVehicle.lineCode}
              </Badge>
              <span className="text-sm font-medium">
                {selectedVehicle.routeLongName || lineConfig?.name}
              </span>
            </div>
            <Separator />
          </>
        )}

        {/* Stops section */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">{t('transit.stops')}</h3>
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
      </CardContent>
    </Card>
  );
}
