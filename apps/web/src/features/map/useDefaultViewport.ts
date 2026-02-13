import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useMapActions, useMapCore } from '../../state/map';
import {
  getFallbackViewport,
  loadMapViewport,
} from '../../lib/rodalies/dataLoader';
import type { MapViewport } from '../../types/rodalies';

interface UseDefaultViewportResult {
  defaultViewport: MapViewport | null;
  effectiveViewport: MapViewport;
  isLoading: boolean;
  error: string | null;
  recenter(): void;
}

export function useDefaultViewport(): UseDefaultViewportResult {
  const fallbackViewport = useMemo(() => getFallbackViewport(), []);
  const { defaultViewport } = useMapCore();
  const { setDefaultViewport, resetViewport } = useMapActions();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(!defaultViewport);
  const hasRequestedViewportRef = useRef(false);

  useEffect(() => {
    if (defaultViewport) {
      setIsLoading(false);
      return;
    }

    if (hasRequestedViewportRef.current) {
      return;
    }

    hasRequestedViewportRef.current = true;
    let cancelled = false;

    (async () => {
      try {
        const viewport = await loadMapViewport();
        if (!cancelled) {
          setDefaultViewport(viewport);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setDefaultViewport(fallbackViewport);
          setError(
            'Using fallback Rodalies viewport while loading actual defaults.',
          );
          if (typeof console !== 'undefined') {
            console.error('Failed to load Rodalies default viewport', err);
          }
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [defaultViewport, fallbackViewport, setDefaultViewport]);

  const effectiveViewport = useMemo(
    () => defaultViewport ?? fallbackViewport,
    [defaultViewport, fallbackViewport],
  );

  const recenter = useCallback(() => {
    resetViewport();
  }, [resetViewport]);

  return {
    defaultViewport,
    effectiveViewport,
    isLoading,
    error,
    recenter,
  };
}
