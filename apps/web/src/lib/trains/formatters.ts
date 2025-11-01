import type { Train } from '../../types/trains';

export function formatDelay(train: Train): {
  text: string;
  status: 'on-time' | 'delayed' | 'early' | 'unknown';
} {
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
