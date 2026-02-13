import { Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { useMapUI, useMapNetwork, useMapActions } from '../../state/map';
import { TransportFilterSheet } from './TransportFilterSheet';
import { FILTER_OPTIONS } from './filterOptions';
import type { TransportType } from '../../types/rodalies';

/**
 * TransportFilterButton - Transport layer visibility filter
 *
 * Allows users to toggle visibility of different transport types on the map:
 * - Rodalies: trains, lines, and stations
 * - Metro: lines and stations
 * - Bus: lines and stops (future, currently disabled)
 *
 * Responsive behavior:
 * - Mobile (<=768px): Sheet overlay from bottom
 * - Desktop (>768px): Expandable card below settings button
 */
export function TransportFilterButton() {
  const { activePanel } = useMapUI();
  const { transportFilters } = useMapNetwork();
  const { setActivePanel, toggleTransportFilter } = useMapActions();

  const isExpanded = activePanel === 'transportFilter';
  const isOtherPanelExpanded = activePanel !== 'none' && activePanel !== 'transportFilter';

  const handleToggle = (type: TransportType) => {
    toggleTransportFilter(type);
  };

  const FilterContent = () => (
    <div className="space-y-3">
      {FILTER_OPTIONS.map((option, index) => (
        <div key={option.type}>
          {index > 0 && <Separator className="mb-3" />}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <label
                htmlFor={`filter-${option.type}`}
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
              id={`filter-${option.type}`}
              checked={transportFilters[option.type]}
              onCheckedChange={() => handleToggle(option.type)}
              disabled={option.disabled}
              aria-label={`Toggle ${option.label} visibility`}
            />
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <>
      {/* Mobile: Sheet (<=768px) */}
      <div className="block md:hidden">
        <TransportFilterSheet />
      </div>

      {/* Desktop: Expandable card (>768px) */}
      <div className="hidden md:block">
        {!isExpanded && !isOtherPanelExpanded ? (
          // Collapsed: Filter icon button (below settings at top-36)
          <button
            onClick={() => setActivePanel('transportFilter')}
            className="fixed top-52 left-4 w-12 h-12 rounded-full bg-card shadow-lg z-10 flex items-center justify-center hover:scale-105 transition-transform border border-border"
            aria-label="Show transport filters"
            title="Filter Transport Types"
            data-testid="transport-filter-trigger"
          >
            <Layers className="h-5 w-5 text-foreground" />
          </button>
        ) : isExpanded ? (
          // Expanded: Filter panel
          <Card
            className="fixed top-52 left-4 w-80 shadow-lg z-10"
            data-testid="transport-filter-panel"
          >
            <CardHeader className="pb-0">
              <CardTitle className="flex items-center justify-between text-sm">
                <span>Transport Filters</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setActivePanel('none')}
                  className="h-6 w-6 p-0"
                  aria-label="Hide transport filters"
                >
                  ✕
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-3 pb-3">
              <FilterContent />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
