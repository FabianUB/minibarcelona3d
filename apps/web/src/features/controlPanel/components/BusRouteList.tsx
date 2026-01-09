/**
 * BusRouteList Component
 *
 * Virtualized list for 200+ bus routes with search and grouping.
 * Uses @tanstack/react-virtual for performance.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useMapState, useMapActions } from '@/state/map';
import { BUS_ROUTE_GROUPS, type BusRoutePrefix } from '../types';

interface BusRoute {
  route_code: string;
  route_id: string;
  name: string;
  color: string;
}

interface BusManifest {
  files: Array<{
    type: string;
    path: string;
    route_code: string;
    route_id: string;
    name: string;
    color: string;
  }>;
}

interface BusRouteListProps {
  className?: string;
}

// Long press duration in ms
const LONG_PRESS_DURATION = 500;

/**
 * Get the prefix group for a route code
 */
function getRoutePrefix(routeCode: string): BusRoutePrefix | 'other' {
  const prefix = routeCode.charAt(0).toUpperCase();
  if (prefix in BUS_ROUTE_GROUPS) {
    return prefix as BusRoutePrefix;
  }
  return 'other';
}

export function BusRouteList({ className }: BusRouteListProps) {
  const { ui } = useMapState();
  const { setNetworkHighlight, toggleNetworkLine, clearNetworkHighlight } = useMapActions();
  const [routes, setRoutes] = useState<BusRoute[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const parentRef = useRef<HTMLDivElement>(null);

  const networkHighlight = ui.networkHighlights.bus;
  const hasSelection = networkHighlight.selectedLineIds.length > 0;
  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null);

  // Load bus routes from manifest
  useEffect(() => {
    fetch('/tmb_data/bus/manifest.json')
      .then((res) => res.json())
      .then((data: BusManifest) => {
        const busRoutes = data.files
          .filter((f) => f.type === 'bus_route')
          .map((f) => ({
            route_code: f.route_code,
            route_id: f.route_id,
            name: f.name,
            color: f.color,
          }))
          .sort((a, b) => {
            // Sort by prefix group first, then numerically
            const prefixA = getRoutePrefix(a.route_code);
            const prefixB = getRoutePrefix(b.route_code);
            if (prefixA !== prefixB) {
              const order = ['H', 'V', 'D', 'N', 'A', 'other'];
              return order.indexOf(prefixA) - order.indexOf(prefixB);
            }
            // Extract numeric part for sorting
            const numA = parseInt(a.route_code.replace(/\D/g, ''), 10) || 0;
            const numB = parseInt(b.route_code.replace(/\D/g, ''), 10) || 0;
            return numA - numB;
          });
        setRoutes(busRoutes);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load bus routes:', err);
        setError('Failed to load bus routes');
        setIsLoading(false);
      });
  }, []);

  // Filter routes based on search query
  const filteredRoutes = useMemo(() => {
    if (!searchQuery.trim()) return routes;
    const query = searchQuery.toLowerCase();
    return routes.filter(
      (r) =>
        r.route_code.toLowerCase().includes(query) ||
        r.name.toLowerCase().includes(query)
    );
  }, [routes, searchQuery]);

  // Virtual list setup
  const virtualizer = useVirtualizer({
    count: filteredRoutes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 10,
  });

  const handleMouseDown = useCallback(
    (routeCode: string) => {
      const timer = setTimeout(() => {
        // Long press - isolate this route
        setNetworkHighlight('bus', routeCode, 'isolate');
        setLongPressTimer(null);
      }, LONG_PRESS_DURATION);
      setLongPressTimer(timer);
    },
    [setNetworkHighlight]
  );

  const handleMouseUp = useCallback(
    (routeCode: string) => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        setLongPressTimer(null);
        // Short click - toggle highlight
        toggleNetworkLine('bus', routeCode);
      }
    },
    [longPressTimer, toggleNetworkLine]
  );

  const handleMouseLeave = useCallback(() => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
  }, [longPressTimer]);

  const handleClear = useCallback(() => {
    clearNetworkHighlight('bus');
  }, [clearNetworkHighlight]);

  const isRouteHighlighted = (routeCode: string): boolean => {
    return networkHighlight.selectedLineIds.includes(routeCode);
  };

  const isRouteDimmed = (routeCode: string): boolean => {
    if (networkHighlight.highlightMode !== 'isolate') {
      return false;
    }
    return !networkHighlight.selectedLineIds.includes(routeCode);
  };

  // Quick select handlers
  const handleSelectGroup = useCallback(
    (prefix: BusRoutePrefix) => {
      const groupRoutes = routes.filter((r) => getRoutePrefix(r.route_code) === prefix);
      groupRoutes.forEach((r) => {
        if (!networkHighlight.selectedLineIds.includes(r.route_code)) {
          toggleNetworkLine('bus', r.route_code);
        }
      });
    },
    [routes, networkHighlight.selectedLineIds, toggleNetworkLine]
  );

  if (isLoading) {
    return (
      <div className={cn('py-4 text-center text-muted-foreground', className)}>
        Loading bus routes...
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('py-4 text-center text-destructive', className)}>
        {error}
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {/* Search */}
      <Input
        type="search"
        placeholder="Search routes..."
        value={searchQuery}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
        className="h-8"
      />

      {/* Quick select buttons */}
      <div className="flex flex-wrap gap-1">
        {(Object.keys(BUS_ROUTE_GROUPS) as BusRoutePrefix[]).map((prefix) => (
          <Button
            key={prefix}
            variant="outline"
            size="sm"
            className="h-6 text-xs px-2"
            onClick={() => handleSelectGroup(prefix)}
          >
            {prefix}-Lines
          </Button>
        ))}
        {hasSelection && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs px-2 ml-auto"
            onClick={handleClear}
          >
            Clear
          </Button>
        )}
      </div>

      {/* Selection status */}
      {hasSelection && (
        <div className="px-3 py-2 bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-md text-xs">
          <span className="font-medium">
            {networkHighlight.highlightMode === 'isolate' ? 'Isolated: ' : 'Highlighted: '}
          </span>
          {networkHighlight.selectedLineIds.length} routes
        </div>
      )}

      {/* Route count */}
      <div className="text-xs text-muted-foreground">
        {filteredRoutes.length} routes {searchQuery && `matching "${searchQuery}"`}
      </div>

      {/* Virtualized route list */}
      <div
        ref={parentRef}
        className="h-[200px] overflow-auto border rounded-md"
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const route = filteredRoutes[virtualItem.index];
            const highlighted = isRouteHighlighted(route.route_code);
            const dimmed = isRouteDimmed(route.route_code);

            return (
              <div
                key={virtualItem.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualItem.size}px`,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <button
                  onMouseDown={() => handleMouseDown(route.route_code)}
                  onMouseUp={() => handleMouseUp(route.route_code)}
                  onMouseLeave={handleMouseLeave}
                  onTouchStart={() => handleMouseDown(route.route_code)}
                  onTouchEnd={() => handleMouseUp(route.route_code)}
                  onTouchCancel={handleMouseLeave}
                  className={cn(
                    'w-full h-full px-3 flex items-center gap-2 text-left',
                    'hover:bg-muted/50 transition-colors',
                    highlighted && 'bg-yellow-50 dark:bg-yellow-950',
                    dimmed && 'opacity-20'
                  )}
                  title="Click to highlight, hold to isolate"
                >
                  <span
                    className="w-8 h-6 flex items-center justify-center rounded text-xs font-semibold text-white"
                    style={{ backgroundColor: route.color }}
                  >
                    {route.route_code}
                  </span>
                  <span className="text-sm truncate flex-1">{route.name}</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
