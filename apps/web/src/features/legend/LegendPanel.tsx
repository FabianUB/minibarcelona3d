import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useLegendStore } from './legendStore';
import { useMapActions, useMapState } from '../../state/map';
import { LegendSheet } from './LegendSheet';

/**
 * LegendPanel - Accessible legend UI for line selection
 *
 * Responsive behavior:
 * - Mobile (≤768px): Sheet overlay from bottom
 * - Desktop (>768px): Expandable Card panel with rail icon button
 * - Compact badge-only layout with line brand colors
 */
export function LegendPanel() {
  const legend = useLegendStore();
  const { ui } = useMapState();
  const { setActivePanel } = useMapActions();
  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null);

  const isExpanded = ui.activePanel === 'legend';

  if (legend.isLoading) {
    return (
      <div className="legend-panel-loading">
        <Card className="w-full max-w-sm">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Loading lines...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (legend.error) {
    return (
      <div className="legend-panel-error">
        <Card className="w-full max-w-sm border-destructive">
          <CardContent className="pt-6">
            <p className="text-sm text-destructive">{legend.error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Desktop-only handlers
  const handleMouseDown = (lineId: string) => {
    const timer = setTimeout(() => {
      legend.isolateLine(lineId);
      setLongPressTimer(null);
    }, 500);
    setLongPressTimer(timer);
  };

  const handleMouseUp = (lineId: string) => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
      // Regular click behavior - toggle this line in highlight mode
      legend.highlightLine(lineId);
    }
  };

  const handleMouseLeave = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
  };

  // Get the selected lines for the status banner
  const selectedLines = legend.items.filter((item) => item.isHighlighted);
  const selectionText = selectedLines.length === 1
    ? selectedLines[0].label  // Show full name for single selection
    : selectedLines.map((item) => item.lineId).join(', '); // Show IDs for multiple selections

  const LegendContent = () => (
    <>
      {selectedLines.length > 0 && (
        <div
          data-testid="legend-selection-status"
          className="mb-3 px-3 py-2 bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-md text-sm text-yellow-900 dark:text-yellow-100"
          role="status"
          aria-live="polite"
        >
          <span className="font-medium">Selected:</span> {selectionText}
        </div>
      )}
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-3 gap-2">
        {legend.items.map((item) => {
          const isActive = item.isHighlighted;
          const dimmed = item.isDimmed;

          return (
            <button
              key={item.lineId}
              data-testid={`legend-entry-${item.lineId}`}
              aria-pressed={isActive}
              aria-label={`${item.lineId}: ${item.label.replace(/^[A-Z0-9]+\s*-\s*/, '')}`}
              onMouseDown={() => handleMouseDown(item.lineId)}
              onMouseUp={() => handleMouseUp(item.lineId)}
              onMouseLeave={handleMouseLeave}
              onTouchStart={() => handleMouseDown(item.lineId)}
              onTouchEnd={() => handleMouseUp(item.lineId)}
              onTouchCancel={handleMouseLeave}
              className={`
                relative rounded-md px-3 py-2 text-sm font-semibold
                transition-all cursor-pointer
                border-[3px]
                ${isActive ? 'border-yellow-400 scale-110 shadow-lg ring-2 ring-yellow-400/50' : 'border-transparent'}
                ${dimmed ? 'opacity-20' : 'opacity-100 hover:scale-105'}
              `}
              style={{
                backgroundColor: item.brandColor,
                color: '#ffffff',
              }}
              title={`${item.label.replace(/^[A-Z0-9]+\s*-\s*/, '')} (hold to isolate)`}
            >
              {item.lineId}
            </button>
          );
        })}
      </div>
    </>
  );

  return (
    <>
      {/* Mobile: Sheet (≤768px) */}
      <div className="block md:hidden">
        <LegendSheet
          items={legend.items}
          mode={legend.mode}
          onLineClick={(lineId) => legend.highlightLine(lineId)}
          onLinePress={(lineId) => legend.isolateLine(lineId)}
          onClearSelection={() => legend.clearSelection()}
        />
      </div>

      {/* Desktop: Expandable legend (>768px) */}
      <div className="hidden md:block">
        {!isExpanded ? (
          // Collapsed: Circular rail icon button
          <button
            onClick={() => setActivePanel('legend')}
            className="fixed top-4 left-4 w-12 h-12 rounded-full bg-card shadow-lg z-10 flex items-center justify-center hover:scale-105 transition-transform border border-border"
            aria-label="Show legend"
            title="Show Rodalies Lines legend"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-foreground"
            >
              {/* Train/Rail icon */}
              <rect x="4" y="6" width="16" height="10" rx="2" />
              <path d="M4 11h16" />
              <path d="M8 16h.01" />
              <path d="M16 16h.01" />
              <path d="M6 19l1.5-1.5" />
              <path d="M16.5 17.5L18 19" />
            </svg>
          </button>
        ) : (
          // Expanded: Full legend panel
          <Card className="fixed top-4 left-4 w-64 shadow-lg z-10" data-testid="legend-panel">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                <span>Rodalies Lines</span>
                <div className="flex gap-1">
                  {legend.mode !== 'all' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => legend.clearSelection()}
                      className="h-6 text-xs px-2"
                    >
                      Clear
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setActivePanel('none')}
                    className="h-6 w-6 p-0"
                    aria-label="Hide legend"
                  >
                    ✕
                  </Button>
                </div>
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Click to highlight, hold to isolate
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0 pb-3">
              <LegendContent />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
