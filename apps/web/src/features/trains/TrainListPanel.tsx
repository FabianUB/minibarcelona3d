import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { TrainPosition } from '../../types/trains';
import type { Map as MapboxMap } from 'mapbox-gl';
import { loadRodaliesLines } from '../../lib/rodalies/dataLoader';

interface TrainListPanelProps {
  trains: TrainPosition[];
  map: MapboxMap;
  isOpen: boolean;
  onClose: () => void;
}

export function TrainListPanel({ trains, map, isOpen, onClose }: TrainListPanelProps) {
  const [sortField, setSortField] = useState<keyof TrainPosition | 'line'>('line');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [filter, setFilter] = useState('');
  const [lineColors, setLineColors] = useState<Map<string, string>>(new Map());
  const [lineOrder, setLineOrder] = useState<Map<string, number>>(new Map());

  // Load line colors and order from RodaliesLines data (same source as Legend panel)
  useEffect(() => {
    let cancelled = false;

    loadRodaliesLines()
      .then((lines) => {
        if (cancelled) return;
        const colors = new Map<string, string>();
        const order = new Map<string, number>();
        for (const line of lines) {
          // Add # prefix to hex color (matching legendStore.ts)
          colors.set(line.id, `#${line.brand_color}`);
          // Store order for sorting
          order.set(line.id, line.order);
        }
        setLineColors(colors);
        setLineOrder(order);
      })
      .catch((err) => {
        console.error('Failed to load line colors:', err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSort = (field: keyof TrainPosition | 'line') => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleRowClick = useCallback((train: TrainPosition) => {
    if (train.latitude === null || train.longitude === null) return;

    map.flyTo({
      center: [train.longitude, train.latitude],
      zoom: 15,
      duration: 1000,
    });
  }, [map]);

  // Extract line code from routeId (e.g., "51T0048RL4" -> "RL4")
  const getLineCode = (routeId: string): string => {
    // Match line codes like R1, R2, R2N, R2S, R3, R4, R7, R8, R11, R14-R17, RG1, RL3, RL4, RT2
    const match = routeId.match(/R[GLT]?\d+[NS]?$/i);
    return match ? match[0].toUpperCase() : routeId.slice(-3);
  };

  // Get line color from loaded data, with fallback
  const getLineColor = (lineCode: string): string => {
    return lineColors.get(lineCode) || '#666666';
  };

  const sortedTrains = [...trains]
    .filter(train => {
      if (!filter) return true;
      const searchLower = filter.toLowerCase();
      return (
        train.vehicleKey.toLowerCase().includes(searchLower) ||
        train.routeId.toLowerCase().includes(searchLower) ||
        (train.nextStopId?.toLowerCase().includes(searchLower) ?? false) ||
        (train.status?.toLowerCase().includes(searchLower) ?? false) ||
        getLineCode(train.routeId).toLowerCase().includes(searchLower)
      );
    })
    .sort((a, b) => {
      // Special handling for 'line' sort field - use line order from data
      if (sortField === 'line') {
        const aLine = getLineCode(a.routeId);
        const bLine = getLineCode(b.routeId);
        const aOrder = lineOrder.get(aLine) ?? 999;
        const bOrder = lineOrder.get(bLine) ?? 999;
        const comparison = aOrder - bOrder;
        return sortDirection === 'asc' ? comparison : -comparison;
      }

      const aVal = a[sortField];
      const bVal = b[sortField];

      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      const comparison = String(aVal).localeCompare(String(bVal), undefined, { numeric: true });
      return sortDirection === 'asc' ? comparison : -comparison;
    });

  if (!isOpen) return null;

  // Render in a portal to avoid disrupting the component tree
  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-[9999]"
        onClick={onClose}
      />

      {/* Panel */}
      <Card className="fixed top-16 left-16 right-16 bottom-16 z-[10000] flex flex-col overflow-hidden">
        <CardHeader className="pb-2 border-b">
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span>Train List ({sortedTrains.length}/{trains.length})</span>
              <input
                type="text"
                placeholder="Filter trains..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-48 h-8 px-3 rounded-md border border-input bg-background text-sm"
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-8 w-8 p-0"
              aria-label="Close train list"
            >
              ✕
            </Button>
          </CardTitle>
        </CardHeader>

        <CardContent className="flex-1 overflow-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted sticky top-0">
              <tr>
                <SortableHeader field="vehicleKey" label="Vehicle" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                <SortableHeader field="line" label="Line" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                <SortableHeader field="status" label="Status" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                <SortableHeader field="nextStopId" label="Next Stop" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                <th className="px-3 py-2 text-left font-medium">Position</th>
                <SortableHeader field="polledAtUtc" label="Last Update" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
              </tr>
            </thead>
            <tbody>
              {sortedTrains.map((train) => (
                <tr
                  key={train.vehicleKey}
                  onClick={() => handleRowClick(train)}
                  className="border-b cursor-pointer hover:bg-accent transition-colors"
                >
                  <td className="px-3 py-2 font-mono">{train.vehicleKey}</td>
                  <td className="px-3 py-2">
                    <span
                      className="px-2 py-0.5 rounded text-xs font-bold text-white"
                      style={{ backgroundColor: getLineColor(getLineCode(train.routeId)) }}
                    >
                      {getLineCode(train.routeId)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={train.status} />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{train.nextStopId ?? '-'}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {train.longitude !== null && train.latitude !== null
                      ? `${train.longitude.toFixed(4)}, ${train.latitude.toFixed(4)}`
                      : 'N/A'}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {train.polledAtUtc ? new Date(train.polledAtUtc).toLocaleTimeString() : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>

        <div className="px-4 py-2 border-t bg-muted text-xs text-muted-foreground">
          Click on a row to focus the camera on that train
        </div>
      </Card>
    </>,
    document.body
  );
}

type SortField = keyof TrainPosition | 'line';

interface SortableHeaderProps {
  field: SortField;
  label: string;
  sortField: SortField;
  sortDirection: 'asc' | 'desc';
  onSort: (field: SortField) => void;
}

function SortableHeader({ field, label, sortField, sortDirection, onSort }: SortableHeaderProps) {
  const isActive = sortField === field;
  return (
    <th
      className="px-3 py-2 text-left font-medium cursor-pointer hover:bg-accent/50 select-none whitespace-nowrap"
      onClick={() => onSort(field)}
    >
      {label}
      {isActive && (
        <span className="ml-1">
          {sortDirection === 'asc' ? '▲' : '▼'}
        </span>
      )}
    </th>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  const getStatusClasses = (status: string | null): string => {
    const base = 'px-2 py-0.5 rounded text-xs font-medium';
    switch (status) {
      case 'STOPPED_AT':
        return `${base} bg-green-500 text-white`;
      case 'INCOMING_AT':
        return `${base} bg-blue-500 text-white`;
      case 'IN_TRANSIT_TO':
        return `${base} bg-orange-500 text-white`;
      default:
        return `${base} bg-gray-400 text-white`;
    }
  };

  return <span className={getStatusClasses(status)}>{status ?? 'UNKNOWN'}</span>;
}

