/**
 * NetworkStatusAlert Component
 *
 * Displays inline warning alerts when a network has data issues:
 * - Rodalies: "Unable to load positions" when API is completely unavailable
 * - Metro/etc: "Using schedule-based positions" when real-time is unavailable
 */

import { useTranslation } from 'react-i18next';
import { AlertTriangle, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DataSourceType } from '@/state/transit';

interface NetworkStatusAlertProps {
  source: DataSourceType;
  className?: string;
}

export function NetworkStatusAlert({ source, className }: NetworkStatusAlertProps) {
  const { t } = useTranslation('controlPanel');

  // Only show alert for problematic states
  if (source === 'realtime' || source === 'unknown') {
    return null;
  }

  const isUnavailable = source === 'unavailable';

  return (
    <div
      className={cn(
        'flex items-start gap-2 px-3 py-2 rounded-md text-xs',
        isUnavailable
          ? 'bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/20'
          : 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20',
        className
      )}
    >
      {isUnavailable ? (
        <WifiOff className="h-4 w-4 shrink-0 mt-0.5" />
      ) : (
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
      )}
      <div>
        <p className="font-medium">
          {isUnavailable
            ? t('statusAlert.unavailableTitle')
            : t('statusAlert.scheduleTitle')}
        </p>
        <p className="opacity-80">
          {isUnavailable
            ? t('statusAlert.unavailableDescription')
            : t('statusAlert.scheduleDescription')}
        </p>
      </div>
    </div>
  );
}
