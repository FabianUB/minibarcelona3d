/**
 * TransitInfoPanel Component
 *
 * Displays information about selected Metro/Bus vehicles.
 * Simpler than TrainInfoPanel since we have simulated data.
 */

import { useCallback, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useMapActions } from '@/state/map';
import { useTransitState, useTransitActions } from '@/state/transit';
import { getMetroLineConfig } from '@/config/metroConfig';
import { getBusRouteConfig } from '@/config/busConfig';

export function TransitInfoPanel() {
  const { setActivePanel } = useMapActions();
  const { selectedVehicle, isPanelOpen } = useTransitState();
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

    // Small delay to prevent immediate close on the same click
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [handleClose]);

  if (!selectedVehicle || !isPanelOpen) {
    return null;
  }

  // Get line configuration based on network type
  const lineConfig =
    selectedVehicle.networkType === 'metro'
      ? getMetroLineConfig(selectedVehicle.lineCode)
      : getBusRouteConfig(selectedVehicle.lineCode);

  const networkLabel = selectedVehicle.networkType === 'metro' ? 'Metro' : 'Bus';

  return (
    <Card
      ref={panelRef}
      className="fixed bottom-4 left-1/2 -translate-x-1/2 w-80 shadow-lg z-10 border border-border gap-0 animate-slide-up"
      data-testid="transit-info-panel"
    >
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center justify-between text-base">
          <div className="flex items-center gap-2">
            <Badge
              variant="default"
              style={{ backgroundColor: lineConfig?.color || '#666' }}
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
        {/* Line name */}
        {lineConfig && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{lineConfig.name}</span>
            </div>
            <Separator />
          </>
        )}

        {/* Previous Station */}
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">
            Previous Stop
          </div>
          <div className="text-sm font-medium">
            {selectedVehicle.previousStopName || '-'}
          </div>
        </div>

        <Separator />

        {/* Next Station */}
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">
            Next Stop
          </div>
          <div className="text-sm font-medium">
            {selectedVehicle.nextStopName || '-'}
          </div>
        </div>

        {/* Simulated indicator */}
        <Separator />
        <div className="text-xs text-muted-foreground text-center">
          Position estimated from schedule
        </div>
      </CardContent>
    </Card>
  );
}
