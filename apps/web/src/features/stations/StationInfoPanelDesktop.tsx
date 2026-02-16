import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { XIcon } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { RodaliesLine } from '../../types/rodalies';
import type {
  StationInfoPanelDesktopProps,
  StationInfoPanelProps,
} from './StationInfoPanel.types';

function getPositionClasses(position: Required<StationInfoPanelDesktopProps>['position']) {
  switch (position) {
    case 'bottom-left':
      return 'left-6 right-auto bottom-6 top-auto translate-x-0 translate-y-0';
    case 'top-right':
      return 'right-6 left-auto top-6 bottom-auto translate-x-0 translate-y-0';
    case 'top-left':
      return 'left-6 right-auto top-6 bottom-auto translate-x-0 translate-y-0';
    case 'bottom-right':
      return 'right-6 left-auto bottom-6 top-auto translate-x-0 translate-y-0';
    case 'bottom-center':
    default:
      return 'left-1/2 right-auto bottom-4 top-auto -translate-x-1/2 translate-y-0';
  }
}

function getStationLines(
  station: StationInfoPanelProps['station'],
  lines: RodaliesLine[],
) {
  const map = new Map(lines.map((line) => [line.id, line]));
  const orderedLines = station?.lines
    .map((lineId) => map.get(lineId) ?? null)
    .filter(Boolean) as RodaliesLine[] | undefined;
  if (!orderedLines) {
    return [];
  }
  return orderedLines.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
}

function getBadgeColor(color: string | undefined) {
  if (!color) {
    return '#111827';
  }
  if (color.startsWith('#')) {
    return color.length === 4 || color.length === 7 ? color : '#111827';
  }
  const clean = color.replace(/[^0-9a-f]/gi, '');
  return clean.length === 6 ? `#${clean}` : '#111827';
}

export function StationInfoPanelDesktop({
  station,
  lines,
  isOpen,
  onClose,
  isLoading,
  className,
  position = 'bottom-center',
}: StationInfoPanelDesktopProps) {
  const { t } = useTranslation('stations');
  const stationLines = useMemo(() => getStationLines(station, lines), [station, lines]);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const showPanel = isOpen && (Boolean(station) || Boolean(isLoading));

  useEffect(() => {
    if (!showPanel) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showPanel, onClose]);

  if (!showPanel) {
    return null;
  }

  return (
    <Card
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="station-panel-title"
      data-testid="station-info-panel"
      className={`fixed z-30 w-full max-w-md rounded-xl border border-border bg-card/95 shadow-xl ${getPositionClasses(position)} ${className ?? ''}`}
    >
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center justify-between gap-4 text-lg font-semibold">
          <span id="station-panel-title">{station?.name ?? (isLoading ? t('panel.loading') : t('panel.selectStation'))}</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 rounded-full"
            aria-label={t('panel.closePanel')}
            data-testid="station-panel-close"
          >
            <XIcon className="size-4" />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-3">
        {isLoading ? (
          <div
            className="h-20 animate-pulse rounded-md bg-muted"
            aria-live="polite"
            data-testid="station-info-loading"
          />
        ) : station ? (
          <section>
            {station.code && (
              <div className="mb-3">
                <h3 className="text-sm font-medium text-muted-foreground">{t('info.stationCode')}</h3>
                <p className="mt-1 text-base font-medium" data-testid="station-code">
                  {station.code}
                </p>
              </div>
            )}
            <h3 className="text-sm font-medium text-muted-foreground">{t('info.servingLines')}</h3>
            <div data-testid="station-line-badges" className="mt-2 flex flex-wrap gap-2">
              {stationLines.length > 0 ? (
                stationLines.map((line) => {
                  const label = line.short_code || line.id;
                  return (
                    <div
                      key={line.id}
                      data-testid="station-line-badge"
                      data-line-id={line.id}
                      className="relative rounded-md px-3 py-2 text-sm font-semibold text-white shadow-sm"
                      style={{
                        backgroundColor: getBadgeColor(line.brand_color),
                        boxShadow: '0 4px 10px rgba(0,0,0,0.25)',
                      }}
                    >
                      {label}
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-muted-foreground">{t('info.noLineData')}</p>
              )}
            </div>
          </section>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t('panel.selectPrompt')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
