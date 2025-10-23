import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useLegendStore } from './legendStore';

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
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null);

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

  const handleMouseDown = (lineId: string) => {
    const timer = setTimeout(() => {
      legend.isolateLine(lineId);
      setLongPressTimer(null);
    }, 500);
    setLongPressTimer(timer);
  };

  const handleMouseUp = (lineId: string, isActive: boolean) => {
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

  const LegendContent = () => (
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
            onMouseUp={() => handleMouseUp(item.lineId, isActive)}
            onMouseLeave={handleMouseLeave}
            onTouchStart={() => handleMouseDown(item.lineId)}
            onTouchEnd={() => handleMouseUp(item.lineId, isActive)}
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
  );

  return (
    <>
      {/* Mobile: Sheet (≤768px) */}
      <div className="block md:hidden">
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetTrigger asChild>
            <Button
              variant="secondary"
              size="lg"
              className="fixed bottom-4 left-1/2 -translate-x-1/2 z-10 shadow-lg"
            >
              Lines ({legend.items.length})
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="h-auto max-h-[80vh]">
            <SheetHeader>
              <SheetTitle>Rodalies Lines</SheetTitle>
            </SheetHeader>
            <Separator className="my-4" />
            <div className="pb-6">
              <LegendContent />
            </div>
            {legend.mode !== 'all' && (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => legend.clearSelection()}
                >
                  Clear Selection
                </Button>
              </div>
            )}
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop: Expandable legend (>768px) */}
      <div className="hidden md:block">
        {!isExpanded ? (
          // Collapsed: Circular rail icon button
          <button
            onClick={() => setIsExpanded(true)}
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
                    onClick={() => setIsExpanded(false)}
                    className="h-6 w-6 p-0"
                    aria-label="Hide legend"
                  >
                    ✕
                  </Button>
                </div>
              </CardTitle>
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
