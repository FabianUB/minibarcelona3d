/**
 * ModelSizeSelector Component
 *
 * Discrete button control for adjusting 3D model size per network.
 * Options: Small (70%), Normal (100%), Large (150%)
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useMapState, useMapActions } from '@/state/map';
import type { TransportType } from '@/types/rodalies';

interface ModelSizeSliderProps {
  network: TransportType;
  className?: string;
}

const SIZE_OPTIONS = [
  { key: 'small', value: 0.7 },
  { key: 'medium', value: 1.0 },
  { key: 'large', value: 1.5 },
] as const;

export function ModelSizeSlider({ network, className }: ModelSizeSliderProps) {
  const { t } = useTranslation('controlPanel');
  const { ui } = useMapState();
  const { setModelSize } = useMapActions();

  const currentSize = ui.modelSizes[network];

  const handleSelect = useCallback(
    (value: number) => {
      setModelSize(network, value);
    },
    [network, setModelSize]
  );

  return (
    <div className={cn('space-y-2', className)}>
      <label className="text-sm font-medium text-foreground">{t('modelSize.label')}</label>
      <div className="flex gap-2">
        {SIZE_OPTIONS.map(({ key, value }) => (
          <button
            key={key}
            onClick={() => handleSelect(value)}
            className={cn(
              'flex-1 px-3 py-1.5 text-sm rounded-md transition-colors',
              'border border-border',
              currentSize === value
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-foreground hover:bg-muted'
            )}
            aria-pressed={currentSize === value}
          >
            {t(`modelSize.${key}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
