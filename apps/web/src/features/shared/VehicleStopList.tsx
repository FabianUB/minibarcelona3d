import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { VEHICLE_ICON_MOVING, VEHICLE_ICON_STOPPED } from '@/lib/transit/vehicleIcons';
import type { StopTime } from '@/types/trains';

export interface VehicleStopListProps {
  tripId: string | null;
  previousStopName: string | null;
  currentStopName?: string | null;
  nextStopName: string | null;
  nextStopId: string | null;
  isStoppedAtStation: boolean;
  showDelays?: boolean;
  fetchAllStops: (tripId: string) => Promise<StopTime[]>;
}

function formatTime(timeString: string | null): string | null {
  if (!timeString) return null;
  if (timeString === '00:00:00' || timeString === '00:00') return null;
  const parts = timeString.split(':');
  if (parts.length < 2) return timeString;
  return `${parts[0]}:${parts[1]}`;
}

function formatDelay(delaySeconds: number | null): string | null {
  if (delaySeconds === null || delaySeconds === 0) return null;
  const absDelay = Math.abs(delaySeconds);
  const minutes = Math.floor(absDelay / 60);
  return delaySeconds > 0 ? `+${minutes} min` : `-${minutes} min`;
}

function getStopDelay(stop: StopTime): number | null {
  return stop.arrivalDelaySeconds ?? stop.departureDelaySeconds ?? null;
}

export function VehicleStopList({
  tripId,
  previousStopName,
  currentStopName,
  nextStopName,
  nextStopId,
  isStoppedAtStation,
  showDelays = false,
  fetchAllStops,
}: VehicleStopListProps) {
  const { t } = useTranslation('vehicles');
  const [isExpanded, setIsExpanded] = useState(false);
  const [stopTimes, setStopTimes] = useState<StopTime[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isExpanded && tripId && stopTimes.length === 0) {
      setIsLoading(true);
      setError(null);

      fetchAllStops(tripId)
        .then((stops) => {
          setStopTimes(stops);
        })
        .catch((err) => {
          console.error('Failed to fetch trip details:', err);
          setError(t('stops.failedToLoad'));
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [isExpanded, tripId, stopTimes.length]);

  const getStopStatus = (stop: StopTime): 'completed' | 'next' | 'upcoming' => {
    if (nextStopId && stop.stopId === nextStopId) return 'next';

    const nextStopIndex = nextStopId ? stopTimes.findIndex(s => s.stopId === nextStopId) : -1;
    const stopIndex = stopTimes.findIndex(s => s.stopId === stop.stopId);

    if (nextStopIndex === -1) return 'upcoming';
    if (stopIndex < nextStopIndex) return 'completed';

    return 'upcoming';
  };

  const hasStopNames = !!(previousStopName || nextStopName || currentStopName);

  // No trip and no stop names at all — simulated position with no data
  if (!tripId && !hasStopNames) {
    return (
      <div className="space-y-2">
        <div className="px-2 py-3">
          <div className="flex items-center justify-center gap-2">
            <div className="text-2xl">{VEHICLE_ICON_MOVING}</div>
            <span className="text-sm text-muted-foreground">
              {t('stops.inService')}
            </span>
          </div>
        </div>
        <div className="px-3 py-2 bg-muted/50 rounded-md text-xs text-muted-foreground text-center">
          {t('stops.simulatedPosition')}
        </div>
      </div>
    );
  }

  if (!isExpanded) {
    return (
      <div className="space-y-2">
        {isStoppedAtStation && currentStopName ? (
          /* Stopped at station: show previous → stopped icon → next */
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
                <div className="text-2xl self-center -mt-2" title={t('stops.trainStopped')}>
                  {VEHICLE_ICON_STOPPED}
                </div>
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
          /* In transit: show previous → moving icon → next */
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
                <div className="text-lg" title={t('stops.train')}>
                  {VEHICLE_ICON_MOVING}
                </div>
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
            {t('stops.journeyUnavailable')}
          </div>
        )}

        {tripId && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setIsExpanded(true)}
          >
            {t('stops.showAll')}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-muted-foreground">{t('stops.allStops')}</h4>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs"
          onClick={() => setIsExpanded(false)}
        >
          {t('stops.collapse')}
        </Button>
      </div>

      {isLoading && (
        <div className="px-3 py-4 text-sm text-muted-foreground text-center">
          {t('stops.loading')}
        </div>
      )}

      {error && (
        <div className="px-3 py-4 bg-destructive/10 rounded-md text-sm text-destructive text-center">
          {error}
        </div>
      )}

      {!isLoading && !error && stopTimes.length === 0 && (
        <div className="px-3 py-4 bg-muted/50 rounded-md text-sm text-muted-foreground text-center">
          {t('stops.noInfo')}
        </div>
      )}

      {!isLoading && !error && stopTimes.length > 0 && (
        <div className="max-h-[300px] overflow-y-auto space-y-1">
          {stopTimes.map((stop) => {
            const status = getStopStatus(stop);
            const scheduledTime = formatTime(stop.scheduledArrival || stop.scheduledDeparture);
            const delaySeconds = showDelays ? getStopDelay(stop) : null;
            const delay = formatDelay(delaySeconds);

            return (
              <div
                key={stop.stopId}
                className={cn(
                  'px-3 py-2 rounded-md text-sm',
                  status === 'completed' && 'bg-muted/30 text-muted-foreground',
                  status === 'next' && 'bg-primary/10 border border-primary/30 font-medium',
                  status === 'upcoming' && 'bg-background'
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div className={cn(
                      'w-2 h-2 rounded-full flex-shrink-0',
                      status === 'completed' && 'bg-muted-foreground',
                      status === 'next' && 'bg-primary',
                      status === 'upcoming' && 'bg-muted'
                    )} />
                    <span className="truncate" title={stop.stopName || stop.stopId}>
                      {stop.stopName || stop.stopId}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {delay && (
                      <span className={cn(
                        'text-xs font-medium',
                        (delaySeconds || 0) > 0 ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'
                      )}>
                        {delay}
                      </span>
                    )}
                    {scheduledTime && (
                      <span className={cn(
                        'text-xs',
                        status === 'completed' && 'text-muted-foreground',
                        delay && status === 'completed' && 'line-through'
                      )}>
                        {scheduledTime}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
