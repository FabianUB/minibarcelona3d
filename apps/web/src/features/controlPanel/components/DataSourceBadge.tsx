/**
 * DataSourceBadge Component
 *
 * Displays a small badge indicating whether vehicle positions
 * are from real-time data or schedule-based simulation.
 */

import { cn } from '@/lib/utils';
import type { DataSourceType } from '@/state/transit';

interface DataSourceBadgeProps {
  source: DataSourceType;
  className?: string;
}

const SOURCE_CONFIG: Record<DataSourceType, { label: string; className: string; title: string }> = {
  realtime: {
    label: 'Real-time',
    className: 'bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30',
    title: 'Vehicle positions from real-time API data',
  },
  schedule: {
    label: 'Schedule',
    className: 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30',
    title: 'Vehicle positions simulated from schedule data',
  },
  unknown: {
    label: 'Loading...',
    className: 'bg-gray-500/20 text-gray-500 border-gray-500/30',
    title: 'Determining data source...',
  },
};

export function DataSourceBadge({ source, className }: DataSourceBadgeProps) {
  const config = SOURCE_CONFIG[source];

  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded border',
        config.className,
        className
      )}
      title={config.title}
    >
      {config.label}
    </span>
  );
}
