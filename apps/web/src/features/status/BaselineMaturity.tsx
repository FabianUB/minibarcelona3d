/**
 * BaselineMaturity Component
 *
 * Shows the maturity level of baseline learning for each network.
 * Displays coverage (time slots mapped) and maturity (slots with enough samples).
 * Helps users understand how reliable anomaly detection is.
 */

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  fetchBaselineSummary,
  type BaselineSummary,
  getNetworkDisplayName,
} from '../../lib/api/health';

interface BaselineMaturityProps {
  /** How often to refresh (ms). Default: 60000 (1 min) */
  refreshInterval?: number;
}

export function BaselineMaturity({ refreshInterval = 60000 }: BaselineMaturityProps) {
  const [summaries, setSummaries] = useState<BaselineSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    try {
      const response = await fetchBaselineSummary();
      setSummaries(response.networks);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSummary();
    const interval = setInterval(loadSummary, refreshInterval);
    return () => clearInterval(interval);
  }, [loadSummary, refreshInterval]);

  if (loading) {
    return (
      <Card className="bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            Baseline Learning
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-24">
            <div className="w-5 h-5 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            Baseline Learning
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center">{error}</p>
        </CardContent>
      </Card>
    );
  }

  // Calculate overall stats
  const totalSlots = summaries.reduce((acc, s) => acc + s.totalSlots, 0);
  const totalMature = summaries.reduce((acc, s) => acc + s.matureSlots, 0);
  const overallMaturity = totalSlots > 0 ? (totalMature / totalSlots) * 100 : 0;

  return (
    <Card className="bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            Baseline Learning
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            {overallMaturity.toFixed(0)}% mature
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          The system learns typical vehicle counts for each hour/day. Higher maturity means more reliable anomaly detection.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {summaries.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center">
            No baseline data yet. Check back in a few minutes.
          </p>
        ) : (
          <div className="space-y-2">
            {summaries.map((summary) => (
              <NetworkMaturityRow key={summary.network} summary={summary} />
            ))}
          </div>
        )}

        {/* Legend */}
        <div className="flex items-center justify-center gap-4 pt-2 border-t border-border text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            <span>Learning</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-yellow-500" />
            <span>Developing</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span>Established</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function NetworkMaturityRow({ summary }: { summary: BaselineSummary }) {
  const [expanded, setExpanded] = useState(false);

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'established':
        return 'bg-green-500';
      case 'developing':
        return 'bg-yellow-500';
      case 'learning':
        return 'bg-blue-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getStatusBadgeClass = (status: string): string => {
    switch (status) {
      case 'established':
        return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'developing':
        return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'learning':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      default:
        return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  return (
    <div className="space-y-1">
      <div
        className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1 py-0.5"
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setExpanded(!expanded)}
      >
        {/* Network name */}
        <span className="text-sm font-medium min-w-[70px]">
          {getNetworkDisplayName(summary.network as Parameters<typeof getNetworkDisplayName>[0])}
        </span>

        {/* Progress bar */}
        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
          <div className="relative h-full">
            {/* Coverage (lighter) */}
            <div
              className="absolute inset-y-0 left-0 bg-muted-foreground/20 rounded-full"
              style={{ width: `${summary.coveragePercent}%` }}
            />
            {/* Maturity (solid) */}
            <div
              className={`absolute inset-y-0 left-0 ${getStatusColor(summary.status)} rounded-full transition-all duration-500`}
              style={{ width: `${summary.maturityPercent}%` }}
            />
          </div>
        </div>

        {/* Status badge */}
        <Badge
          variant="outline"
          className={`text-[10px] px-1.5 capitalize ${getStatusBadgeClass(summary.status)}`}
        >
          {summary.status}
        </Badge>

        {/* Expand indicator */}
        <span className={`text-xs text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="ml-[70px] pl-2 text-xs text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-0.5 border-l border-border">
          <span>Time slots:</span>
          <span className="text-foreground">
            {summary.matureSlots} / {summary.totalSlots} mature
          </span>
          <span>Coverage:</span>
          <span className="text-foreground">{summary.coveragePercent.toFixed(0)}%</span>
          <span>Maturity:</span>
          <span className="text-foreground">{summary.maturityPercent.toFixed(0)}%</span>
          <span>Total samples:</span>
          <span className="text-foreground">{summary.totalSamples.toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}
