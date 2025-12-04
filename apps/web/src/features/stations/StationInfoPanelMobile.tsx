import { useMemo } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { RodaliesLine } from '../../types/rodalies';
import type { StationInfoPanelMobileProps } from './StationInfoPanel.types';

function getStationLines(
  station: StationInfoPanelMobileProps['station'],
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

export function StationInfoPanelMobile({
  station,
  lines,
  isOpen,
  onClose,
  isLoading,
  maxHeightPercent = 65,
  className,
}: StationInfoPanelMobileProps) {
  const stationLines = useMemo(() => getStationLines(station, lines), [station, lines]);

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <SheetContent
        side="bottom"
        data-testid="station-info-panel"
        className={`z-30 min-h-40 w-full rounded-t-3xl border-t border-border bg-card/95 backdrop-blur ${className ?? ''}`}
        style={{
          maxHeight: `${maxHeightPercent}vh`,
        }}
      >
        <SheetHeader className="px-1 pb-1">
          <SheetTitle className="text-lg font-semibold leading-tight">
            {station?.name ?? (isLoading ? 'Loading station…' : 'Select a station')}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {stationLines.length > 0
              ? `Serving ${stationLines.length} line${stationLines.length > 1 ? 's' : ''}`
              : 'Select a station to view its lines'}
          </SheetDescription>
        </SheetHeader>
        <div className="h-px w-full bg-border" />
        <div className="overflow-y-auto px-1 py-3">
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
                  <h3 className="text-sm font-medium text-muted-foreground">Station code</h3>
                  <p className="mt-1 text-base font-medium" data-testid="station-code">
                    {station.code}
                  </p>
                </div>
              )}
              <h3 className="text-sm font-medium text-muted-foreground">Serving lines</h3>
              <div data-testid="station-line-badges" className="mt-3 flex flex-wrap gap-2">
                {stationLines.length > 0 ? (
                  stationLines.map((line) => (
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
                      {line.short_code || line.id}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No line data available.</p>
                )}
              </div>
            </section>
          ) : (
            <p className="text-sm text-muted-foreground">Select a station marker on the map.</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
