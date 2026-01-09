/**
 * useNetworkLines Hook
 *
 * Unified hook for loading line data for any transit network.
 * Returns line info with code, name, and color for display in the control panel.
 */

import { useState, useEffect, useMemo } from 'react';
import type { TransportType } from '@/types/rodalies';
import type { LineInfo } from '../types';
import { loadRodaliesLines } from '@/lib/rodalies/dataLoader';
import { METRO_LINE_CONFIG, getMetroLineCodes } from '@/config/metroConfig';
import { FGC_LINE_CONFIG, getFgcLineCodes } from '@/config/fgcConfig';
import { TRAM_LINE_CONFIG, getTramLineCodes } from '@/config/tramConfig';

interface UseNetworkLinesResult {
  lines: LineInfo[];
  isLoading: boolean;
  error: string | null;
}

/**
 * Load lines for Rodalies network from JSON
 * Only includes lines starting with "R" (Rodalies), not other Renfe lines
 */
async function loadRodaliesLinesData(): Promise<LineInfo[]> {
  const rodaliesLines = await loadRodaliesLines();
  return rodaliesLines
    .filter((line) => line.short_code.startsWith('R'))
    .map((line) => ({
      id: line.id,
      code: line.short_code,
      name: line.name,
      color: `#${line.brand_color}`,
    }));
}

/**
 * Load lines for Metro network from config
 */
function loadMetroLinesData(): LineInfo[] {
  const lineCodes = getMetroLineCodes();
  return lineCodes.map((code) => {
    const config = METRO_LINE_CONFIG[code];
    return {
      id: code,
      code: config.lineCode,
      name: config.name,
      color: config.color,
    };
  });
}

/**
 * Load lines for FGC network from config
 */
function loadFgcLinesData(): LineInfo[] {
  const lineCodes = getFgcLineCodes();
  return lineCodes.map((code) => {
    const config = FGC_LINE_CONFIG[code];
    return {
      id: code,
      code: config.lineCode,
      name: config.name,
      color: config.color,
    };
  });
}

/**
 * Load lines for TRAM network from config
 */
function loadTramLinesData(): LineInfo[] {
  const lineCodes = getTramLineCodes();
  return lineCodes.map((code) => {
    const config = TRAM_LINE_CONFIG[code];
    return {
      id: code,
      code: config.lineCode,
      name: config.name,
      color: config.color,
    };
  });
}

/**
 * Load bus routes - returns empty array since bus routes are loaded dynamically
 * Bus routes will be handled by a separate BusRouteList component with virtualization
 */
function loadBusRoutesData(): LineInfo[] {
  // Bus routes are loaded dynamically in BusRouteList component
  // This returns empty since we don't want to load 200+ routes upfront
  return [];
}

/**
 * Hook to load line data for a specific network
 */
export function useNetworkLines(network: TransportType): UseNetworkLinesResult {
  const [rodaliesLines, setRodaliesLines] = useState<LineInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load Rodalies lines (async)
  useEffect(() => {
    if (network === 'rodalies' && rodaliesLines.length === 0) {
      setIsLoading(true);
      setError(null);
      loadRodaliesLinesData()
        .then((lines) => {
          setRodaliesLines(lines);
        })
        .catch((err) => {
          console.error('Failed to load Rodalies lines:', err);
          setError('Failed to load lines');
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [network, rodaliesLines.length]);

  // Compute lines based on network type
  const lines = useMemo(() => {
    switch (network) {
      case 'rodalies':
        return rodaliesLines;
      case 'metro':
        return loadMetroLinesData();
      case 'fgc':
        return loadFgcLinesData();
      case 'tram':
        return loadTramLinesData();
      case 'bus':
        return loadBusRoutesData();
      default:
        return [];
    }
  }, [network, rodaliesLines]);

  return {
    lines,
    isLoading: network === 'rodalies' ? isLoading : false,
    error: network === 'rodalies' ? error : null,
  };
}
