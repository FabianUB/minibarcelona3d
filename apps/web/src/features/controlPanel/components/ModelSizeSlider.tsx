/**
 * ModelSizeSlider Component
 *
 * Slider control for adjusting 3D model size per network.
 * Range: 50% to 200% (stored as 0.5 to 2.0)
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { useMapState, useMapActions } from '@/state/map';
import type { TransportType } from '@/types/rodalies';

interface ModelSizeSliderProps {
  network: TransportType;
  className?: string;
}

export function ModelSizeSlider({ network, className }: ModelSizeSliderProps) {
  const { t } = useTranslation('controlPanel');
  const { t: tCommon } = useTranslation('common');
  const { ui } = useMapState();
  const { setModelSize } = useMapActions();

  const currentSize = ui.modelSizes[network];
  const percentage = Math.round(currentSize * 100);

  const handleValueChange = useCallback(
    (values: number[]) => {
      const newSize = values[0] / 100;
      setModelSize(network, newSize);
    },
    [network, setModelSize]
  );

  const handleReset = useCallback(() => {
    setModelSize(network, 1.0);
  }, [network, setModelSize]);

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-foreground">{t('modelSize.label')}</label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground w-12 text-right">
            {percentage}%
          </span>
          {percentage !== 100 && (
            <button
              onClick={handleReset}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              {tCommon('buttons.reset')}
            </button>
          )}
        </div>
      </div>
      <Slider
        value={[percentage]}
        min={50}
        max={200}
        step={10}
        onValueChange={handleValueChange}
        aria-label={`${network} model size`}
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>50%</span>
        <span>100%</span>
        <span>200%</span>
      </div>
    </div>
  );
}
