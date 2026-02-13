/**
 * ModelSizeSelector Component
 *
 * Discrete button control for adjusting 3D model size per network.
 * Options are relative to each network's default: Small (70%), Normal (100%), Large (150%)
 */

import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useMapState, useMapActions } from '@/state/map';
import type { TransportType } from '@/types/rodalies';
import { DEFAULT_MODEL_SIZES } from '../types';

interface ModelSizeSliderProps {
  network: TransportType;
  className?: string;
}

const SIZE_MULTIPLIERS = [
  { key: 'small', multiplier: 0.7 },
  { key: 'medium', multiplier: 1.0 },
  { key: 'large', multiplier: 1.5 },
] as const;

export function ModelSizeSlider({ network, className }: ModelSizeSliderProps) {
  const { t } = useTranslation('controlPanel');
  const { ui } = useMapState();
  const { setModelSize } = useMapActions();

  const currentSize = ui.modelSizes[network];
  const networkDefault = DEFAULT_MODEL_SIZES[network];

  // Compute absolute values from multipliers relative to network default
  const options = useMemo(
    () =>
      SIZE_MULTIPLIERS.map(({ key, multiplier }) => ({
        key,
        // Clamp to [0.5, 2.0] to match reducer, round to avoid float issues
        value: Math.round(Math.max(0.5, Math.min(2.0, networkDefault * multiplier)) * 100) / 100,
      })),
    [networkDefault]
  );

  const handleSelect = useCallback(
    (value: number) => {
      setModelSize(network, value);
    },
    [network, setModelSize]
  );

  // Find which option is closest to the current size for highlighting
  const activeKey = useMemo(() => {
    let closest = options[0];
    let minDiff = Math.abs(currentSize - options[0].value);
    for (const opt of options) {
      const diff = Math.abs(currentSize - opt.value);
      if (diff < minDiff) {
        minDiff = diff;
        closest = opt;
      }
    }
    return closest.key;
  }, [currentSize, options]);

  return (
    <div className={cn('space-y-2', className)}>
      <label className="text-sm font-medium text-foreground">{t('modelSize.label')}</label>
      <div className="flex gap-2">
        {options.map(({ key, value }) => (
          <button
            key={key}
            onClick={() => handleSelect(value)}
            className={cn(
              'flex-1 px-3 py-1.5 text-sm rounded-md transition-colors',
              'border border-border',
              activeKey === key
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-foreground hover:bg-muted'
            )}
            aria-pressed={activeKey === key}
          >
            {t(`modelSize.${key}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
