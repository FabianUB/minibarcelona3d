import { useState } from 'react';
import { Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { useMapState, useMapActions } from '../../state/map';
import { FILTER_OPTIONS } from './filterOptions';
import type { TransportType } from '../../types/rodalies';

/**
 * TransportFilterSheet - Mobile transport filter UI using bottom sheet
 *
 * Displays transport filters as a bottom sheet overlay on mobile devices (<=768px).
 * Provides touch-friendly interface for toggling transport type visibility.
 *
 * Design decisions:
 * - Bottom sheet for modal filter access
 * - Fixed bottom-left trigger button (opposite side from settings)
 * - Vertical layout with clear labels and descriptions
 */
export function TransportFilterSheet() {
  const [isOpen, setIsOpen] = useState(false);
  const { ui } = useMapState();
  const { toggleTransportFilter } = useMapActions();

  const handleToggle = (type: TransportType) => {
    toggleTransportFilter(type);
  };

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button
          variant="secondary"
          size="icon"
          className="fixed bottom-4 left-4 z-10 shadow-lg w-12 h-12"
          aria-label="Open transport filters"
          data-testid="transport-filter-trigger"
        >
          <Layers className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="h-auto max-h-[80vh]">
        <SheetHeader>
          <SheetTitle>Transport Filters</SheetTitle>
        </SheetHeader>
        <Separator className="my-3" />
        <div className="pb-6 px-2">
          <div className="space-y-3">
            {FILTER_OPTIONS.map((option, index) => (
              <div key={option.type}>
                {index > 0 && <Separator className="mb-3" />}
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <label
                      htmlFor={`filter-mobile-${option.type}`}
                      className={`text-sm font-medium ${option.disabled ? 'text-muted-foreground' : ''}`}
                    >
                      {option.label}
                      {option.disabled && option.disabledReason && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({option.disabledReason})
                        </span>
                      )}
                    </label>
                    <p className="text-xs text-muted-foreground">{option.description}</p>
                  </div>
                  <Switch
                    id={`filter-mobile-${option.type}`}
                    checked={ui.transportFilters[option.type]}
                    onCheckedChange={() => handleToggle(option.type)}
                    disabled={option.disabled}
                    aria-label={`Toggle ${option.label} visibility`}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
