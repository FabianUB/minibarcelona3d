/**
 * NetworkLineGrid Component
 *
 * Grid of line buttons for highlight/isolate selection.
 * - Click: Toggle highlight for a line
 * - Long press: Isolate a single line
 */

import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useMapNetwork, useMapActions } from '@/state/map';
import type { TransportType } from '@/types/rodalies';
import { useNetworkLines } from '../hooks/useNetworkLines';

interface NetworkLineGridProps {
  network: TransportType;
  className?: string;
}

export function NetworkLineGrid({ network, className }: NetworkLineGridProps) {
  const { t } = useTranslation('controlPanel');
  const { networkHighlights } = useMapNetwork();
  const { setNetworkHighlight, toggleNetworkLine, clearNetworkHighlight } = useMapActions();
  const { lines, isLoading, error } = useNetworkLines(network);
  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null);

  const networkHighlight = networkHighlights[network];
  const hasSelection = networkHighlight.selectedLineIds.length > 0;

  const handleMouseDown = useCallback(
    (lineId: string) => {
      const timer = setTimeout(() => {
        // Long press - isolate this line
        setNetworkHighlight(network, lineId, 'isolate');
        setLongPressTimer(null);
      }, 500);
      setLongPressTimer(timer);
    },
    [network, setNetworkHighlight]
  );

  const handleMouseUp = useCallback(
    (lineId: string) => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        setLongPressTimer(null);
        // Short click - toggle highlight
        toggleNetworkLine(network, lineId);
      }
    },
    [longPressTimer, network, toggleNetworkLine]
  );

  const handleMouseLeave = useCallback(() => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
  }, [longPressTimer]);

  const handleClear = useCallback(() => {
    clearNetworkHighlight(network);
  }, [network, clearNetworkHighlight]);

  const isLineHighlighted = (lineId: string): boolean => {
    return networkHighlight.selectedLineIds.includes(lineId);
  };

  const isLineDimmed = (lineId: string): boolean => {
    if (networkHighlight.highlightMode !== 'isolate') {
      return false;
    }
    return !networkHighlight.selectedLineIds.includes(lineId);
  };

  // Bus routes are handled by BusRouteList component
  if (network === 'bus') {
    return null;
  }

  if (isLoading) {
    return (
      <div className={cn('py-4 text-center text-muted-foreground', className)}>
        {t('lineGrid.loading')}
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('py-4 text-center text-destructive', className)}>
        {t('lineGrid.failedToLoad')}
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className={cn('py-4 text-center text-muted-foreground', className)}>
        {t('lineGrid.noLines')}
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      {/* Selection status banner */}
      {hasSelection && (
        <div
          className="flex items-center justify-between px-2.5 py-1.5 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded-lg text-xs"
          role="status"
          aria-live="polite"
        >
          <span>
            <span className="font-medium">
              {networkHighlight.highlightMode === 'isolate'
                ? `${t('lineGrid.isolated')}: `
                : `${t('lineGrid.highlighted')}: `}
            </span>
            {networkHighlight.selectedLineIds.join(', ')}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            className="h-5 text-xs px-1.5 hover:bg-amber-100 dark:hover:bg-amber-900"
          >
            {t('lineGrid.clear')}
          </Button>
        </div>
      )}

      {/* Line grid */}
      <div className="grid grid-cols-5 gap-1.5">
        {lines.map((line) => {
          const highlighted = isLineHighlighted(line.id);
          const dimmed = isLineDimmed(line.id);

          return (
            <button
              key={line.id}
              aria-pressed={highlighted}
              aria-label={`${line.code}: ${line.name}`}
              onMouseDown={() => handleMouseDown(line.id)}
              onMouseUp={() => handleMouseUp(line.id)}
              onMouseLeave={handleMouseLeave}
              onTouchStart={() => handleMouseDown(line.id)}
              onTouchEnd={() => handleMouseUp(line.id)}
              onTouchCancel={handleMouseLeave}
              className={cn(
                'relative rounded-lg px-1 py-2 text-xs font-bold',
                'transition-all duration-150 cursor-pointer',
                'shadow-sm hover:shadow-md',
                highlighted
                  ? 'ring-2 ring-amber-400 ring-offset-1 scale-105 shadow-lg'
                  : '',
                dimmed ? 'opacity-25' : 'opacity-100 hover:scale-105'
              )}
              style={{
                backgroundColor: line.color,
                color: '#ffffff',
                textShadow: '0 1px 2px rgba(0,0,0,0.3)',
              }}
              title={`${line.name}\n${t('lineGrid.lineTitle')}`}
            >
              {line.code}
            </button>
          );
        })}
      </div>

      {/* Help text */}
      <p className="text-[10px] lg:text-xs text-muted-foreground text-center pt-1">
        {t('lineGrid.helpText')}
      </p>
    </div>
  );
}
