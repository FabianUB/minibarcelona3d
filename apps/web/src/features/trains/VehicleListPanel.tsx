/**
 * VehicleListPanel - Unified list panel for all transport types
 *
 * Shows Rodalies trains, Metro, and Bus vehicles in a tabbed interface.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { TrainPosition } from '../../types/trains';
import type { VehiclePosition } from '../../types/transit';
import type { Map as MapboxMap } from 'mapbox-gl';
import { loadRodaliesLines, loadStations } from '../../lib/rodalies/dataLoader';
import { METRO_LINE_CONFIG } from '../../config/metroConfig';
import { getBusRouteConfig } from '../../config/busConfig';
import type { Station, StationFeatureCollection } from '../../types/rodalies';

interface VehicleListPanelProps {
  trains: TrainPosition[];
  metroPositions: VehiclePosition[];
  busPositions: VehiclePosition[];
  map: MapboxMap;
  isOpen: boolean;
  onClose: () => void;
  getMeshPosition?: ((vehicleKey: string) => [number, number] | null) | null;
}

type TransportTab = 'rodalies' | 'metro' | 'bus';

export function VehicleListPanel({
  trains,
  metroPositions,
  busPositions,
  map,
  isOpen,
  onClose,
  getMeshPosition,
}: VehicleListPanelProps) {
  const [activeTab, setActiveTab] = useState<TransportTab>('rodalies');
  const [sortField, setSortField] = useState<string>('line');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [filter, setFilter] = useState('');
  const [lineColors, setLineColors] = useState<Map<string, string>>(new Map());
  const [lineOrder, setLineOrder] = useState<Map<string, number>>(new Map());
  const [stationMap, setStationMap] = useState<Map<string, Station>>(new Map());

  // Load line colors and order from RodaliesLines data
  useEffect(() => {
    let cancelled = false;

    loadRodaliesLines()
      .then((lines) => {
        if (cancelled) return;
        const colors = new Map<string, string>();
        const order = new Map<string, number>();
        for (const line of lines) {
          colors.set(line.id, `#${line.brand_color}`);
          order.set(line.id, line.order ?? 0);
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

  // Load stations for name lookup
  useEffect(() => {
    let cancelled = false;
    loadStations()
      .then((collection: StationFeatureCollection) => {
        if (cancelled) return;
        const map = new Map<string, Station>();
        collection.features.forEach((feature) => {
          const station: Station = {
            id: feature.properties.id,
            name: feature.properties.name,
            code: feature.properties.code,
            lines: feature.properties.lines,
            geometry: feature.geometry,
          };
          map.set(station.id, station);
        });
        setStationMap(map);
      })
      .catch((err) => {
        console.error('Failed to load stations:', err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleRowClick = useCallback(
    (lng: number, lat: number, vehicleKey?: string) => {
      const meshPos = vehicleKey ? getMeshPosition?.(vehicleKey) : null;
      const center: [number, number] = meshPos ?? [lng, lat];

      map.flyTo({
        center,
        zoom: 15,
        duration: 1000,
      });
    },
    [map, getMeshPosition]
  );

  // Get line color from loaded data or config
  const getLineColor = useCallback(
    (lineCode: string): string => {
      // Check Rodalies colors first
      const rodaliesColor = lineColors.get(lineCode);
      if (rodaliesColor) return rodaliesColor;

      // Check Metro config (color already includes #)
      const metroConfig = METRO_LINE_CONFIG[lineCode];
      if (metroConfig) return metroConfig.color;

      // Use Bus config function (color already includes #)
      const busConfig = getBusRouteConfig(lineCode);
      if (busConfig) return busConfig.color;

      return '#666666';
    },
    [lineColors]
  );

  // Filter and sort Rodalies trains
  const filteredTrains = useMemo(() => {
    const getLineCode = (routeId: string | null): string => {
      if (!routeId) return 'N/A';
      const match = routeId.match(/R[GLT]?\d+[NS]?$/i);
      return match ? match[0].toUpperCase() : routeId.slice(-3);
    };

    return trains
      .filter((train) => {
        if (!filter) return true;
        const searchLower = filter.toLowerCase();
        return (
          train.vehicleKey.toLowerCase().includes(searchLower) ||
          (train.routeId?.toLowerCase().includes(searchLower) ?? false) ||
          getLineCode(train.routeId).toLowerCase().includes(searchLower)
        );
      })
      .sort((a, b) => {
        if (sortField === 'line') {
          const aLine = getLineCode(a.routeId);
          const bLine = getLineCode(b.routeId);
          const aOrder = lineOrder.get(aLine) ?? 999;
          const bOrder = lineOrder.get(bLine) ?? 999;
          const comparison = aOrder - bOrder;
          return sortDirection === 'asc' ? comparison : -comparison;
        }
        const aVal = a[sortField as keyof TrainPosition];
        const bVal = b[sortField as keyof TrainPosition];
        if (aVal === null || aVal === undefined) return 1;
        if (bVal === null || bVal === undefined) return -1;
        const comparison = String(aVal).localeCompare(String(bVal), undefined, { numeric: true });
        return sortDirection === 'asc' ? comparison : -comparison;
      });
  }, [trains, filter, sortField, sortDirection, lineOrder]);

  // Filter and sort Metro positions
  const filteredMetro = useMemo(() => {
    return metroPositions
      .filter((v) => {
        if (!filter) return true;
        return (
          v.vehicleKey.toLowerCase().includes(filter.toLowerCase()) ||
          v.lineCode.toLowerCase().includes(filter.toLowerCase())
        );
      })
      .sort((a, b) => {
        const comparison = a.lineCode.localeCompare(b.lineCode, undefined, { numeric: true });
        return sortDirection === 'asc' ? comparison : -comparison;
      });
  }, [metroPositions, filter, sortDirection]);

  // Filter and sort Bus positions
  const filteredBus = useMemo(() => {
    return busPositions
      .filter((v) => {
        if (!filter) return true;
        return (
          v.vehicleKey.toLowerCase().includes(filter.toLowerCase()) ||
          v.lineCode.toLowerCase().includes(filter.toLowerCase())
        );
      })
      .sort((a, b) => {
        const comparison = a.lineCode.localeCompare(b.lineCode, undefined, { numeric: true });
        return sortDirection === 'asc' ? comparison : -comparison;
      });
  }, [busPositions, filter, sortDirection]);

  if (!isOpen) return null;

  const getLineCodeFromRouteId = (routeId: string | null): string => {
    if (!routeId) return 'N/A';
    const match = routeId.match(/R[GLT]?\d+[NS]?$/i);
    return match ? match[0].toUpperCase() : routeId.slice(-3);
  };

  return createPortal(
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-[9999]" onClick={onClose} />

      {/* Panel */}
      <Card className="fixed top-16 left-16 right-16 bottom-16 z-[10000] flex flex-col overflow-hidden">
        <CardHeader className="pb-2 border-b">
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span>Vehicle List</span>
              <input
                type="text"
                placeholder="Filter..."
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
              aria-label="Close list"
            >
              ✕
            </Button>
          </CardTitle>
        </CardHeader>

        {/* Custom Tab Navigation */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="mx-4 mt-2 flex gap-1 w-fit">
            <button
              onClick={() => setActiveTab('rodalies')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'rodalies'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent'
              }`}
            >
              🚆 Rodalies ({filteredTrains.length})
            </button>
            <button
              onClick={() => setActiveTab('metro')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'metro'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent'
              }`}
            >
              🚇 Metro ({filteredMetro.length})
            </button>
            <button
              onClick={() => setActiveTab('bus')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'bus'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent'
              }`}
            >
              🚌 Bus ({filteredBus.length})
            </button>
          </div>

          <CardContent className="flex-1 overflow-auto p-0">
            {/* Rodalies Tab */}
            {activeTab === 'rodalies' && (
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <SortableHeader
                      field="vehicleKey"
                      label="Vehicle"
                      sortField={sortField}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      field="line"
                      label="Line"
                      sortField={sortField}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      field="status"
                      label="Status"
                      sortField={sortField}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                    <th className="px-3 py-2 text-left font-medium">Next Stop</th>
                    <th className="px-3 py-2 text-left font-medium">Position</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTrains.map((train) => (
                    <tr
                      key={train.vehicleKey}
                      onClick={() =>
                        train.longitude &&
                        train.latitude &&
                        handleRowClick(train.longitude, train.latitude, train.vehicleKey)
                      }
                      className="border-b cursor-pointer hover:bg-accent transition-colors"
                    >
                      <td className="px-3 py-2 font-mono text-xs">{train.vehicleKey}</td>
                      <td className="px-3 py-2">
                        <span
                          className="px-2 py-0.5 rounded text-xs font-bold text-white"
                          style={{ backgroundColor: getLineColor(getLineCodeFromRouteId(train.routeId)) }}
                        >
                          {getLineCodeFromRouteId(train.routeId)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={train.status} />
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {train.nextStopId
                          ? stationMap.get(train.nextStopId)?.name || train.nextStopId
                          : '-'}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {train.longitude && train.latitude
                          ? `${train.latitude.toFixed(4)}, ${train.longitude.toFixed(4)}`
                          : 'N/A'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Metro Tab */}
            {activeTab === 'metro' && (
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Line</th>
                    <th className="px-3 py-2 text-left font-medium">Previous Stop</th>
                    <th className="px-3 py-2 text-left font-medium">Next Stop</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMetro.map((vehicle) => (
                    <tr
                      key={vehicle.vehicleKey}
                      onClick={() => handleRowClick(vehicle.longitude, vehicle.latitude)}
                      className="border-b cursor-pointer hover:bg-accent transition-colors"
                    >
                      <td className="px-3 py-2">
                        <span
                          className="px-2 py-0.5 rounded text-xs font-bold text-white"
                          style={{ backgroundColor: getLineColor(vehicle.lineCode) }}
                        >
                          {vehicle.lineCode}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {vehicle.previousStopName || '-'}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {vehicle.nextStopName || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Bus Tab */}
            {activeTab === 'bus' && (
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Route</th>
                    <th className="px-3 py-2 text-left font-medium">Previous Stop</th>
                    <th className="px-3 py-2 text-left font-medium">Next Stop</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBus.map((vehicle) => (
                    <tr
                      key={vehicle.vehicleKey}
                      onClick={() => handleRowClick(vehicle.longitude, vehicle.latitude)}
                      className="border-b cursor-pointer hover:bg-accent transition-colors"
                    >
                      <td className="px-3 py-2">
                        <span
                          className="px-2 py-0.5 rounded text-xs font-bold text-white"
                          style={{ backgroundColor: getLineColor(vehicle.lineCode) }}
                        >
                          {vehicle.lineCode}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {vehicle.previousStopName || '-'}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {vehicle.nextStopName || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </div>

        <div className="px-4 py-2 border-t bg-muted text-xs text-muted-foreground">
          Click on a row to focus the camera on that vehicle
        </div>
      </Card>
    </>,
    document.body
  );
}

interface SortableHeaderProps {
  field: string;
  label: string;
  sortField: string;
  sortDirection: 'asc' | 'desc';
  onSort: (field: string) => void;
}

function SortableHeader({ field, label, sortField, sortDirection, onSort }: SortableHeaderProps) {
  const isActive = sortField === field;
  return (
    <th
      className="px-3 py-2 text-left font-medium cursor-pointer hover:bg-accent/50 select-none whitespace-nowrap"
      onClick={() => onSort(field)}
    >
      {label}
      {isActive && <span className="ml-1">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
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
