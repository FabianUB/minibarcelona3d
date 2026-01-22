import { useEffect, useState } from 'react';
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
import { useTrainState, useTrainActions } from '@/state/trains';
import { loadStations, loadRodaliesLines } from '@/lib/rodalies/dataLoader';
import { fetchTripDetailsCached } from '@/lib/api/trains';
import { cn } from '@/lib/utils';
import type { RodaliesLine } from '@/types/rodalies';
import type { TripDetails } from '@/types/trains';
import { StopList } from './StopList';

export function TrainInfoPanelMobile() {
  const { t } = useTranslation('vehicles');
  const { setActivePanel } = useMapActions();
  const { selectedTrain, isPanelOpen } = useTrainState();
  const { clearSelection } = useTrainActions();
  const [stationNames, setStationNames] = useState<Map<string, string>>(new Map());
  const [lines, setLines] = useState<RodaliesLine[]>([]);
  const [tripDetails, setTripDetails] = useState<TripDetails | null>(null);
  const [isTripDetailsLoading, setIsTripDetailsLoading] = useState(false);

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

  useEffect(() => {
    if (selectedTrain?.tripId) {
      setIsTripDetailsLoading(true);
      // Use cached version to avoid redundant API calls (Phase 3, T017)
      fetchTripDetailsCached(selectedTrain.tripId)
        .then((details) => {
          setTripDetails(details);
        })
        .catch((err) => {
          console.error('Failed to fetch trip details for delay calculation:', err);
          setTripDetails(null);
        })
        .finally(() => {
          setIsTripDetailsLoading(false);
        });
    } else {
      setTripDetails(null);
      setIsTripDetailsLoading(false);
    }
  }, [selectedTrain?.tripId]);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      clearSelection();
      setActivePanel('none');
    }
  };

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

  if (!selectedTrain) {
    return null;
  }

  // Get delay for next stop from GTFS-RT feed data
  const calculateScheduleDelay = (): { text: string; status: 'on-time' | 'delayed' | 'early' | 'unknown' } => {
    if (!tripDetails || !selectedTrain.nextStopId) {
      return { text: t('delay.unknown'), status: 'unknown' };
    }

    const nextStop = tripDetails.stopTimes.find(st => st.stopId === selectedTrain.nextStopId);
    if (!nextStop) {
      return { text: t('delay.unknown'), status: 'unknown' };
    }

    // Use real-time delay from GTFS-RT feed (already calculated)
    const delaySeconds = nextStop.arrivalDelaySeconds ?? nextStop.departureDelaySeconds;

    if (delaySeconds === null || delaySeconds === undefined) {
      return { text: t('delay.unknown'), status: 'unknown' };
    }

    if (delaySeconds === 0) {
      return { text: t('delay.onTime'), status: 'on-time' };
    }

    if (delaySeconds > 0) {
      const delayMinutes = Math.floor(delaySeconds / 60);
      const text = delayMinutes > 0
        ? t('delay.minLate', { count: delayMinutes })
        : t('delay.secLate', { count: delaySeconds });
      return { text, status: 'delayed' };
    }

    // Negative delay = early
    const delayMinutes = Math.floor(Math.abs(delaySeconds) / 60);
    const text = delayMinutes > 0
      ? t('delay.minEarly', { count: delayMinutes })
      : t('delay.secEarly', { count: Math.abs(delaySeconds) });
    return { text, status: 'early' };
  };

  const delay = calculateScheduleDelay();
  const nextStopName = selectedTrain.nextStopId
    ? stationNames.get(selectedTrain.nextStopId) || selectedTrain.nextStopId
    : null;
  const previousStopName = selectedTrain.previousStopId
    ? stationNames.get(selectedTrain.previousStopId) || selectedTrain.previousStopId
    : null;

  const lineCode = selectedTrain.routeId?.match(/R\w+/)?.[0] || selectedTrain.routeId || 'N/A';
  const lineInfo = lines.find((line) => line.id === lineCode);

  const currentStopName = selectedTrain.currentStopId
    ? stationNames.get(selectedTrain.currentStopId) || selectedTrain.currentStopId
    : null;
  const isStoppedAtStation = selectedTrain.status === 'STOPPED_AT';

  return (
    <Sheet open={isPanelOpen} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        className="h-auto max-h-[80vh] flex flex-col"
        data-testid="train-info-panel-mobile"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Badge variant="default" className="text-sm font-semibold">
              {selectedTrain.routeId || 'N/A'}
            </Badge>
            <span className="text-base font-normal text-muted-foreground">
              {selectedTrain.vehicleLabel}
            </span>
          </SheetTitle>
          <SheetDescription>{t('train.description')}</SheetDescription>
        </SheetHeader>

        <Separator className="my-1" />

        <div className="flex-1 overflow-y-auto pb-6 space-y-3">
          {isTripDetailsLoading && (
            <>
              <div className="px-3 py-2 rounded-md text-sm font-medium bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 flex items-center justify-center gap-2">
                <div className="animate-spin h-4 w-4 border-2 border-gray-300 border-t-gray-600 rounded-full" />
                <span className="text-gray-600 dark:text-gray-400">{t('train.loadingTrip')}</span>
              </div>
              <Separator />
            </>
          )}
          {!isTripDetailsLoading && delay.status !== 'unknown' && (
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

          <div className="flex items-center justify-center gap-2">
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
            <h3 className="text-sm font-semibold text-foreground text-center">{t('train.stops')}</h3>
            <StopList
              tripId={selectedTrain.tripId}
              currentStopId={selectedTrain.currentStopId}
              nextStopId={selectedTrain.nextStopId}
              previousStopName={previousStopName}
              currentStopName={currentStopName}
              nextStopName={nextStopName}
              isStoppedAtStation={isStoppedAtStation}
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
