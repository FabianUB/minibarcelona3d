import type { Train } from '../../types/trains';

/**
 * Format delay information for display
 *
 * Uses delay values directly from the GTFS-RT feed (arrivalDelaySeconds/departureDelaySeconds).
 * These are already calculated by the feed based on schedule vs actual/predicted times.
 *
 * Delay is only available when the train is at a stop (STOPPED_AT status).
 * Trains in transit (IN_TRANSIT_TO) typically don't have delay data, which is correct -
 * delay is measured at stations, not between them.
 */
export function formatDelay(train: Train): {
  text: string;
  status: 'on-time' | 'delayed' | 'early' | 'unknown';
} {
  // Use delay from real-time feed (already calculated by GTFS-RT system)
  const delay = train.arrivalDelaySeconds ?? train.departureDelaySeconds;

  if (delay === null || delay === undefined) {
    return { text: 'Unknown', status: 'unknown' };
  }

  if (delay === 0) {
    return { text: 'On time', status: 'on-time' };
  }

  if (delay > 0) {
    const minutes = Math.floor(delay / 60);
    const text = minutes > 0 ? `${minutes} min late` : `${delay}s late`;
    return { text, status: 'delayed' };
  }

  const minutes = Math.floor(Math.abs(delay) / 60);
  const text = minutes > 0 ? `${minutes} min early` : `${Math.abs(delay)}s early`;
  return { text, status: 'early' };
}
