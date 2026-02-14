import { useCallback, useSyncExternalStore } from 'react';
import {
  getHitDetectionMode,
  setHitDetectionMode,
  type HitDetectionMode,
} from '../lib/map/hitDetectionMode';

function subscribe(onStoreChange: () => void): () => void {
  const handleCustom = () => onStoreChange();
  const handleStorage = (e: StorageEvent) => {
    if (e.key === 'hit-detection-mode') onStoreChange();
  };

  window.addEventListener('hit-detection-mode-change', handleCustom);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener('hit-detection-mode-change', handleCustom);
    window.removeEventListener('storage', handleStorage);
  };
}

export function useHitDetectionMode(): [HitDetectionMode, (mode: HitDetectionMode) => void] {
  const mode = useSyncExternalStore(subscribe, getHitDetectionMode, () => 'obr' as const);
  const setMode = useCallback((m: HitDetectionMode) => setHitDetectionMode(m), []);
  return [mode, setMode];
}
