import type { Train } from '../../types/trains';

/**
 * Calculate delay based on scheduled time vs current time
 * Used as fallback when real-time delay data is not available
 */
export function calculateScheduleDelay(scheduledTime: string | null): number | null {
  if (!scheduledTime) return null;

  const now = new Date();
  const [hours, minutes, seconds] = scheduledTime.split(':').map(Number);

  const scheduled = new Date(now);
  scheduled.setHours(hours, minutes, seconds || 0, 0);

  // Handle times past midnight (e.g., 00:30 is tomorrow)
  if (hours < 12 && now.getHours() > 12) {
    scheduled.setDate(scheduled.getDate() + 1);
  }

  const delayMs = now.getTime() - scheduled.getTime();
  return Math.floor(delayMs / 1000);
}

/**
 * Format delay information for display
 *
 * Priority:
 * 1. Use real-time delay from vehicle position feed if available
 * 2. Fallback to schedule-based calculation if train has current/next stop scheduled time
 * 3. Show "Unknown" if no delay information available
 */
export function formatDelay(train: Train): {
  text: string;
  status: 'on-time' | 'delayed' | 'early' | 'unknown';
} {
  // Try to get delay from real-time feed first
  let delay = train.arrivalDelaySeconds ?? train.departureDelaySeconds;

  // If no real-time delay, calculate from schedule
  if (delay === null || delay === undefined) {
    // Try current stop first, then next stop as fallback
    const scheduledTime = train.predictedArrivalUtc || train.predictedDepartureUtc;

    if (scheduledTime) {
      // For predicted times (ISO format), calculate delay directly
      const predictedDate = new Date(scheduledTime);
      const now = new Date();
      delay = Math.floor((now.getTime() - predictedDate.getTime()) / 1000);
    }
  }

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
