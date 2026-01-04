/**
 * TransitInfoPanelDesktop Component
 *
 * Desktop version of the transit info panel (Card-based).
 * Displays information about selected Metro/TRAM/FGC/Bus vehicles.
 */

import { useCallback, useEffect, useRef } from 'react';
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

export function TransitInfoPanelDesktop() {
  const { setActivePanel } = useMapActions();
  const { selectedVehicle } = useTransitState();
  const { clearSelection } = useTransitActions();
  const panelRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(() => {
    clearSelection();
    setActivePanel('none');
  }, [clearSelection, setActivePanel]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [handleClose]);

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [handleClose]);

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
            aria-label="Close panel"
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
          <h3 className="text-sm font-semibold text-foreground">Stops</h3>
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
      </CardContent>
    </Card>
  );
}
