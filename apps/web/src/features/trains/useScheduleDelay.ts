import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TripDetails } from '@/types/trains';

export function useScheduleDelay(
  tripDetails: TripDetails | null,
  nextStopId: string | null,
): { text: string; status: 'on-time' | 'delayed' | 'early' | 'unknown' } {
  const { t } = useTranslation('vehicles');

  return useMemo(() => {
    if (!tripDetails || !nextStopId) {
      return { text: t('delay.unknown'), status: 'unknown' as const };
    }

    const nextStop = tripDetails.stopTimes.find(st => st.stopId === nextStopId);
    if (!nextStop) {
      return { text: t('delay.unknown'), status: 'unknown' as const };
    }

    const delaySeconds = nextStop.arrivalDelaySeconds ?? nextStop.departureDelaySeconds;

    if (delaySeconds === null || delaySeconds === undefined) {
      return { text: t('delay.unknown'), status: 'unknown' as const };
    }

    if (delaySeconds === 0) {
      return { text: t('delay.onTime'), status: 'on-time' as const };
    }

    if (delaySeconds > 0) {
      const delayMinutes = Math.floor(delaySeconds / 60);
      const text = delayMinutes > 0
        ? t('delay.minLate', { count: delayMinutes })
        : t('delay.secLate', { count: delaySeconds });
      return { text, status: 'delayed' as const };
    }

    // Negative delay = early
    const delayMinutes = Math.floor(Math.abs(delaySeconds) / 60);
    const text = delayMinutes > 0
      ? t('delay.minEarly', { count: delayMinutes })
      : t('delay.secEarly', { count: Math.abs(delaySeconds) });
    return { text, status: 'early' as const };
  }, [tripDetails, nextStopId, t]);
}
