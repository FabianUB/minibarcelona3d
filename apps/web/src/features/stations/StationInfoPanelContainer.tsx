import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { StationInfoPanel } from './StationInfoPanel';
import { loadRodaliesLines, loadStationList } from '../../lib/rodalies/dataLoader';
import { useMapActions, useMapUI } from '../../state/map';
import type { RodaliesLine, Station } from '../../types/rodalies';

const DEFAULT_ERROR_MESSAGE = 'Unable to load station details. Please try again.';

async function ensureStationCache(
  cacheRef: React.MutableRefObject<Station[] | null>,
): Promise<Station[]> {
  if (cacheRef.current) {
    return cacheRef.current;
  }
  const stations = await loadStationList();
  cacheRef.current = stations;
  return stations;
}

async function ensureLineCache(
  cacheRef: React.MutableRefObject<RodaliesLine[] | null>,
): Promise<RodaliesLine[]> {
  if (cacheRef.current) {
    return cacheRef.current;
  }
  const lines = await loadRodaliesLines();
  cacheRef.current = lines;
  return lines;
}

export function StationInfoPanelContainer() {
  const { selectedStationId, activePanel, stationLoadError } = useMapUI();
  const {
    selectStation,
    setActivePanel,
    retryStationLoad,
    setStationLoadError,
  } = useMapActions();

  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [lines, setLines] = useState<RodaliesLine[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const stationCacheRef = useRef<Station[] | null>(null);
  const lineCacheRef = useRef<RodaliesLine[] | null>(null);
  const currentRequestRef = useRef(0);

  useEffect(() => {
    ensureLineCache(lineCacheRef)
      .then(setLines)
      .catch((error) => {
        console.error('Failed to load Rodalies line metadata:', error);
      });
  }, []);

  useEffect(() => {
    const stationId = selectedStationId;
    if (!stationId) {
      setSelectedStation(null);
      setIsLoading(false);
      setStationLoadError(null);
      return;
    }

    const requestId = ++currentRequestRef.current;
    let isCancelled = false;

    setIsLoading(true);
    setStationLoadError(null);

    const run = async () => {
      try {
        const [stationList] = await Promise.all([
          ensureStationCache(stationCacheRef),
          ensureLineCache(lineCacheRef),
        ]);

        const match = stationList.find((station) => station.id === stationId);

        if (!match) {
          throw new Error('Station not found');
        }

        setSelectedStation(match);
      } catch (error) {
        if (isCancelled || requestId !== currentRequestRef.current) {
          return;
        }

        console.error('Failed to load station details:', error);
        setSelectedStation(null);
        const message =
          error instanceof Error && error.message.includes('not found')
            ? 'Selected station is unavailable. Please try another marker.'
            : DEFAULT_ERROR_MESSAGE;
        setStationLoadError(message);
      } finally {
        if (!isCancelled && requestId === currentRequestRef.current) {
          setIsLoading(false);
        }
      }
    };

    run();

    return () => {
      isCancelled = true;
    };
  }, [selectedStationId, retryNonce, setStationLoadError]);

  const closePanel = useCallback(() => {
    selectStation(null);
    setActivePanel('none');
    setStationLoadError(null);
  }, [selectStation, setActivePanel, setStationLoadError]);

  const handleRetry = useCallback(() => {
    retryStationLoad();
    setRetryNonce((value) => value + 1);
  }, [retryStationLoad]);

  const isPanelOpen = activePanel === 'stationInfo' && (isLoading || Boolean(selectedStation));

  const errorBanner = stationLoadError ? (
    <div
      className="fixed left-1/2 top-4 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-yellow-400/70 bg-yellow-50 px-4 py-2 text-sm text-yellow-900 shadow-lg"
      role="alert"
      data-testid="station-error-banner"
    >
      <span>{stationLoadError}</span>
      <button
        type="button"
        className="text-xs font-semibold uppercase tracking-wide text-yellow-800 underline-offset-2 hover:underline"
        onClick={handleRetry}
        data-testid="station-error-retry"
      >
        Retry
      </button>
    </div>
  ) : null;

  const memoizedLines = useMemo(() => lines, [lines]);

  return (
    <>
      {errorBanner}
      <StationInfoPanel
        station={selectedStation}
        lines={memoizedLines}
        isOpen={isPanelOpen}
        isLoading={isLoading}
        onClose={closePanel}
      />
    </>
  );
}
