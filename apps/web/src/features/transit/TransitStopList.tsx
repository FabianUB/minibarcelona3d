/**
 * TransitStopList Component
 *
 * Displays the stop list for transit vehicles (Metro/TRAM/FGC/Bus).
 * Shows previous/current/next stops in collapsed view,
 * and full stop list when expanded (if trip details are available).
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { fetchTripDetailsCached } from '@/lib/api/transit';
import type { VehicleStatus, TransportType } from '@/types/transit';
import type { StopTime } from '@/types/trains';

interface TransitStopListProps {
  vehicleKey: string;
  tripId?: string | null;
  previousStopId: string | null;
  nextStopId: string | null;
  previousStopName: string | null;
  nextStopName: string | null;
  status: VehicleStatus;
  progressFraction: number;
  networkType: TransportType;
}

/**
 * Get the vehicle icon based on network type
 */
function getVehicleIcon(networkType: TransportType): string {
  switch (networkType) {
    case 'metro':
      return '🚇';
    case 'tram':
      return '🚊';
    case 'fgc':
      return '🚆';
    case 'bus':
      return '🚌';
    default:
      return '🚋';
  }
}

/**
 * Format time string to HH:MM
 * Returns null for "00:00:00" which in GTFS means "no time specified"
 */
function formatTime(timeString: string | null): string | null {
  if (!timeString) return null;
  // "00:00:00" means no time specified in GTFS for intermediate stops
  if (timeString === '00:00:00' || timeString === '00:00') return null;
  const parts = timeString.split(':');
  if (parts.length < 2) return timeString;
  return `${parts[0]}:${parts[1]}`;
}

export function TransitStopList({
  tripId,
  nextStopId,
  previousStopName,
  nextStopName,
  status,
  networkType,
}: TransitStopListProps) {
  const vehicleIcon = getVehicleIcon(networkType);
  const isStoppedAtStation = status === 'STOPPED_AT';

  // State for expandable stop list
  const [isExpanded, setIsExpanded] = useState(false);
  const [stopTimes, setStopTimes] = useState<StopTime[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch stop times when expanded
  useEffect(() => {
    if (isExpanded && tripId && stopTimes.length === 0) {
      setIsLoading(true);
      setError(null);

      fetchTripDetailsCached(tripId)
        .then((tripDetails) => {
          setStopTimes(tripDetails.stopTimes);
        })
        .catch((err) => {
          console.error('Failed to fetch trip details:', err);
          setError('Failed to load stops');
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [isExpanded, tripId, stopTimes.length]);

  // Determine stop status for expanded view
  const getStopStatus = (stop: StopTime): 'completed' | 'next' | 'upcoming' => {
    if (nextStopId && stop.stopId === nextStopId) return 'next';

    const nextStopIndex = nextStopId
      ? stopTimes.findIndex((s) => s.stopId === nextStopId)
      : -1;
    const stopIndex = stopTimes.findIndex((s) => s.stopId === stop.stopId);

    if (nextStopIndex === -1) return 'upcoming';
    if (stopIndex < nextStopIndex) return 'completed';

    return 'upcoming';
  };

  // When stop names aren't available (client-side simulation without stop data)
  if (!previousStopName && !nextStopName) {
    return (
      <div className="space-y-2">
        <div className="px-2 py-3">
          <div className="flex items-center justify-center gap-2">
            <div className="text-2xl">{vehicleIcon}</div>
            <span className="text-sm text-muted-foreground">
              In service
            </span>
          </div>
        </div>
        <div className="px-3 py-2 bg-muted/50 rounded-md text-xs text-muted-foreground text-center">
          Stop information not available for simulated positions
        </div>
      </div>
    );
  }

  // Expanded view with full stop list
  if (isExpanded) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-muted-foreground">All Stops</h4>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={() => setIsExpanded(false)}
          >
            Collapse
          </Button>
        </div>

        {isLoading && (
          <div className="px-3 py-4 text-sm text-muted-foreground text-center">
            Loading stops...
          </div>
        )}

        {error && (
          <div className="px-3 py-4 bg-destructive/10 rounded-md text-sm text-destructive text-center">
            {error}
          </div>
        )}

        {!isLoading && !error && stopTimes.length === 0 && (
          <div className="px-3 py-4 bg-muted/50 rounded-md text-sm text-muted-foreground text-center">
            No stop information available
          </div>
        )}

        {!isLoading && !error && stopTimes.length > 0 && (
          <div className="max-h-[300px] overflow-y-auto space-y-1">
            {stopTimes.map((stop) => {
              const stopStatus = getStopStatus(stop);
              const scheduledTime = formatTime(
                stop.scheduledArrival || stop.scheduledDeparture
              );

              return (
                <div
                  key={stop.stopId}
                  className={cn(
                    'px-3 py-2 rounded-md text-sm',
                    stopStatus === 'completed' && 'bg-muted/30 text-muted-foreground',
                    stopStatus === 'next' &&
                      'bg-primary/10 border border-primary/30 font-medium',
                    stopStatus === 'upcoming' && 'bg-background'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div
                        className={cn(
                          'w-2 h-2 rounded-full flex-shrink-0',
                          stopStatus === 'completed' && 'bg-muted-foreground',
                          stopStatus === 'next' && 'bg-primary',
                          stopStatus === 'upcoming' && 'bg-muted'
                        )}
                      />
                      <span className="truncate" title={stop.stopName || stop.stopId}>
                        {stop.stopName || stop.stopId}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {scheduledTime && (
                        <span
                          className={cn(
                            'text-xs',
                            stopStatus === 'completed' && 'text-muted-foreground'
                          )}
                        >
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

  // Collapsed view with previous/next stops
  if (isStoppedAtStation && nextStopName) {
    // Vehicle stopped at a station
    return (
      <div className="space-y-2">
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
              <div
                className="text-2xl self-center -mt-2"
                title={`${networkType} stopped at station`}
              >
                {vehicleIcon}
              </div>
              <span
                className="text-xs text-center font-medium max-w-[120px] line-clamp-3 w-full"
                title={nextStopName}
              >
                At: {nextStopName}
              </span>
            </div>

            {/* Show a future stop indicator */}
            <div className="flex-1 h-0.5 bg-muted" />
            <div className="flex-1 flex flex-col items-start gap-1">
              <div className="w-3 h-3 rounded-full border-2 bg-primary border-primary self-center" />
              <span className="text-xs text-center text-muted-foreground max-w-[120px] line-clamp-3 w-full">
                Next...
              </span>
            </div>
          </div>
        </div>

        {tripId && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setIsExpanded(true)}
          >
            Show all stops
          </Button>
        )}
      </div>
    );
  }

  // Vehicle in transit between stations
  return (
    <div className="space-y-2">
      <div className="px-2 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 flex flex-col items-start gap-1">
            <div
              className={cn(
                'w-3 h-3 rounded-full border-2 self-center',
                previousStopName
                  ? 'bg-muted-foreground border-muted-foreground'
                  : 'bg-muted border-muted'
              )}
            />
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
            <div className="text-lg" title={networkType}>
              {vehicleIcon}
            </div>
            <div className="flex-1 h-0.5 bg-muted" />
          </div>

          <div className="flex-1 flex flex-col items-start gap-1">
            <div
              className={cn(
                'w-3 h-3 rounded-full border-2 self-center',
                nextStopName ? 'bg-primary border-primary' : 'bg-muted border-muted'
              )}
            />
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

      {tripId && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => setIsExpanded(true)}
        >
          Show all stops
        </Button>
      )}
    </div>
  );
}
