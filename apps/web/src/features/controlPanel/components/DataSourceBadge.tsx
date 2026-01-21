/**
 * DataSourceBadge Component
 *
 * Displays a small badge indicating whether vehicle positions
 * are from real-time data or schedule-based simulation.
 */

import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { DataSourceType } from '@/state/transit';

interface DataSourceBadgeProps {
  source: DataSourceType;
  className?: string;
}

const SOURCE_STYLES: Record<DataSourceType, string> = {
  realtime: 'bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30',
  schedule: 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30',
  unknown: 'bg-gray-500/20 text-gray-500 border-gray-500/30',
};

export function DataSourceBadge({ source, className }: DataSourceBadgeProps) {
  const { t } = useTranslation('common');

  const getLabel = (): string => {
    switch (source) {
      case 'realtime':
        return t('dataSource.realTime');
      case 'schedule':
        return t('dataSource.schedule');
      default:
        return t('loading.generic');
    }
  };

  const getTitle = (): string => {
    switch (source) {
      case 'realtime':
        return t('dataSource.realTimeTitle');
      case 'schedule':
        return t('dataSource.scheduleTitle');
      default:
        return '';
    }
  };

  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded border',
        SOURCE_STYLES[source],
        className
      )}
      title={getTitle()}
    >
      {getLabel()}
    </span>
  );
}
