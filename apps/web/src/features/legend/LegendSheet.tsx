import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';

/**
 * LegendSheet - Mobile legend UI using bottom sheet
 *
 * Displays legend as a bottom sheet overlay on mobile devices (≤768px).
 * Provides touch-friendly interface for line selection with clear visual feedback.
 *
 * Design decisions:
 * - Bottom sheet with max height 80vh for scrollable content
 * - Fixed bottom-center trigger button for easy thumb access
 * - Grid layout for compact line badge display
 * - Clear selection button when lines are highlighted
 */

interface LegendItem {
  lineId: string;
  label: string;
  brandColor: string;
  isHighlighted: boolean;
  isDimmed: boolean;
}

interface LegendSheetProps {
  items: LegendItem[];
  mode: 'all' | 'highlight' | 'isolate';
  onLineClick: (lineId: string) => void;
  onLinePress: (lineId: string) => void;
  onClearSelection: () => void;
}

export function LegendSheet({
  items,
  mode,
  onLineClick,
  onLinePress,
  onClearSelection,
}: LegendSheetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null);

  const handleMouseDown = (lineId: string) => {
    const timer = setTimeout(() => {
      onLinePress(lineId);
      setLongPressTimer(null);
    }, 500);
    setLongPressTimer(timer);
  };

  const handleMouseUp = (lineId: string) => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
      // Regular click behavior
      onLineClick(lineId);
    }
  };

  const handleMouseLeave = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button
          variant="secondary"
          size="lg"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-10 shadow-lg"
        >
          Lines ({items.length})
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="h-auto max-h-[80vh]">
        <SheetHeader>
          <SheetTitle>Rodalies Lines</SheetTitle>
          <SheetDescription>
            Tap to highlight, hold to isolate
          </SheetDescription>
        </SheetHeader>
        <Separator className="my-3" />
        <div className="pb-6 px-2">
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-3 gap-2">
            {items.map((item) => {
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
        </div>
        {mode !== 'all' && (
          <div className="mt-4 flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={onClearSelection}
            >
              Clear Selection
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
