import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useMapActions } from '@/state/map';
import { useTrainState, useTrainActions } from '@/state/trains';
import { formatDelay } from '@/lib/trains/formatters';
import { loadStations, loadRodaliesLines } from '@/lib/rodalies/dataLoader';
import { cn } from '@/lib/utils';
import type { RodaliesLine } from '@/types/rodalies';

export function TrainInfoPanelDesktop() {
  const { setActivePanel } = useMapActions();
  const { selectedTrain } = useTrainState();
  const { clearSelection } = useTrainActions();
  const panelRef = useRef<HTMLDivElement>(null);
  const [stationNames, setStationNames] = useState<Map<string, string>>(new Map());
  const [lines, setLines] = useState<RodaliesLine[]>([]);

  useEffect(() => {
    loadStations().then((stationCollection) => {
      const stationMap = new Map(
        stationCollection.features.map((feature) => [
          feature.properties.id,
          feature.properties.name,
        ])
      );
      setStationNames(stationMap);
    });

    loadRodaliesLines().then((lineData) => {
      setLines(lineData);
    });
  }, []);

  const handleClose = () => {
    clearSelection();
    setActivePanel('none');
  };

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!selectedTrain) {
    return null;
  }

  const delay = formatDelay(selectedTrain);
  const nextStopName = selectedTrain.nextStopId
    ? stationNames.get(selectedTrain.nextStopId) || selectedTrain.nextStopId
    : null;
  const previousStopName = selectedTrain.previousStopId
    ? stationNames.get(selectedTrain.previousStopId) || selectedTrain.previousStopId
    : null;

  const lineCode = selectedTrain.routeId.match(/R\w+/)?.[0] || selectedTrain.routeId;
  const lineInfo = lines.find((line) => line.id === lineCode);

  const currentStopName = selectedTrain.currentStopId
    ? stationNames.get(selectedTrain.currentStopId) || selectedTrain.currentStopId
    : null;
  const isStoppedAtStation = selectedTrain.status === 'STOPPED_AT';

  return (
    <Card
      ref={panelRef}
      className="fixed bottom-4 left-1/2 -translate-x-1/2 w-96 shadow-lg z-10 border border-border gap-0 animate-slide-up"
      data-testid="train-info-panel-desktop"
    >
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center justify-between text-base">
          <div className="flex items-center gap-2">
            <Badge variant="default" className="text-sm font-semibold">
              {selectedTrain.routeId}
            </Badge>
            <span className="text-sm font-normal text-muted-foreground">
              {selectedTrain.vehicleLabel}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
            className="h-7 w-7 p-0 hover:bg-accent"
            aria-label="Close train info"
          >
            ✕
          </Button>
        </CardTitle>
      </CardHeader>

      <CardContent className="pt-4 pb-4 space-y-3">
        {delay.status !== 'unknown' && (
          <>
            <div
              className={cn(
                'px-3 py-2 rounded-md text-sm font-medium',
                delay.status === 'on-time' &&
                  'bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 text-green-900 dark:text-green-100',
                delay.status === 'delayed' &&
                  'bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-red-900 dark:text-red-100',
                delay.status === 'early' &&
                  'bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-100'
              )}
            >
              {delay.text}
            </div>
            <Separator />
          </>
        )}

        <div className="flex items-center gap-2">
          {lineInfo ? (
            <>
              <Badge
                variant="default"
                style={{ backgroundColor: `#${lineInfo.brand_color}` }}
                className="text-white font-semibold"
              >
                {lineInfo.short_code}
              </Badge>
              <span className="text-sm font-medium">{lineInfo.name}</span>
            </>
          ) : (
            <span className="text-sm font-medium">{lineCode}</span>
          )}
        </div>

        <Separator />

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Stops</h3>
          {/* <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Stops</h3>
            <Badge
              variant="outline"
              className={cn(
                "text-xs font-medium",
                isStoppedAtStation
                  ? "bg-red-50 dark:bg-red-950 border-red-300 dark:border-red-800 text-red-700 dark:text-red-300"
                  : "bg-green-50 dark:bg-green-950 border-green-300 dark:border-green-800 text-green-700 dark:text-green-300"
              )}
            >
              {isStoppedAtStation ? "Stopped" : "Moving"}
            </Badge>
          </div> */}
          {isStoppedAtStation && currentStopName ? (
            <div className="px-2 py-3">
              <div className="flex items-start justify-between gap-2">
                {previousStopName && (
                  <>
                    <div className="flex-1 flex flex-col items-start gap-1">
                      <div className="w-3 h-3 rounded-full border-2 bg-muted-foreground border-muted-foreground self-center" />
                      <span
                        className="text-xs text-center text-muted-foreground max-w-[120px] line-clamp-3 w-full"
                        title={previousStopName}
                      >
                        {previousStopName}
                      </span>
                    </div>
                    <div className="flex-1 h-0.5 bg-muted" />
                  </>
                )}

                <div className="flex-1 flex flex-col items-start gap-1">
                  <div className="text-2xl self-center -mt-2" style={{ transform: 'scaleX(-1)' }} title="Train stopped at station">🚂</div>
                  <span
                    className="text-xs text-center font-medium max-w-[120px] line-clamp-3 w-full"
                    title={currentStopName}
                  >
                    {currentStopName}
                  </span>
                </div>

                {nextStopName && (
                  <>
                    <div className="flex-1 h-0.5 bg-muted" />
                    <div className="flex-1 flex flex-col items-start gap-1">
                      <div className="w-3 h-3 rounded-full border-2 bg-primary border-primary self-center" />
                      <span
                        className="text-xs text-center text-muted-foreground max-w-[120px] line-clamp-3 w-full"
                        title={nextStopName}
                      >
                        {nextStopName}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : previousStopName || nextStopName ? (
            <div className="px-2 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 flex flex-col items-start gap-1">
                  <div className={cn(
                    "w-3 h-3 rounded-full border-2 self-center",
                    previousStopName ? "bg-muted-foreground border-muted-foreground" : "bg-muted border-muted"
                  )} />
                  {previousStopName && (
                    <span
                      className="text-xs text-center text-muted-foreground max-w-[120px] line-clamp-3 w-full"
                      title={previousStopName}
                    >
                      {previousStopName}
                    </span>
                  )}
                </div>

                <div className="flex-1 flex items-center gap-1 -mt-1">
                  <div className="flex-1 h-0.5 bg-muted" />
                  <div className="text-lg" style={{ transform: 'scaleX(-1)' }} title="Train">🚂</div>
                  <div className="flex-1 h-0.5 bg-muted" />
                </div>

                <div className="flex-1 flex flex-col items-start gap-1">
                  <div className={cn(
                    "w-3 h-3 rounded-full border-2 self-center",
                    nextStopName ? "bg-primary border-primary" : "bg-muted border-muted"
                  )} />
                  {nextStopName && (
                    <span
                      className="text-xs text-center font-medium max-w-[120px] line-clamp-3 w-full"
                      title={nextStopName}
                    >
                      {nextStopName}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="px-3 py-4 bg-muted/50 rounded-md text-sm text-muted-foreground text-center">
              Journey information unavailable
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
