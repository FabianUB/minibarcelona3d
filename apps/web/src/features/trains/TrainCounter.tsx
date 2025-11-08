import { useEffect, useState } from 'react';
import { useMapHighlightSelectors } from '../../state/map';
import { extractLineFromRouteId } from '../../config/trainModels';
import type { TrainPosition } from '../../types/trains';

interface TrainCounterProps {
  trains: TrainPosition[];
}

/**
 * TrainCounter - Shows count of visible trains
 * Task: T094 - Add counter showing N trains visible / total in map UI
 */
export function TrainCounter({ trains }: TrainCounterProps) {
  const { highlightMode, highlightedLineIds, isLineHighlighted } = useMapHighlightSelectors();
  const [visibleCount, setVisibleCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    const total = trains.length;

    // Calculate visible trains based on highlight mode
    let visible = total;

    if (highlightMode !== 'none' && highlightedLineIds.length > 0) {
      visible = trains.filter(train => {
        const lineCode = extractLineFromRouteId(train.routeId);
        return lineCode ? isLineHighlighted(lineCode) : true;
      }).length;
    }

    setVisibleCount(visible);
    setTotalCount(total);
  }, [trains, highlightMode, highlightedLineIds, isLineHighlighted]);

  // Only show if filtering is active
  if (highlightMode === 'none' || highlightedLineIds.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '24px',
        right: '24px',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        padding: '8px 16px',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
        fontSize: '14px',
        fontWeight: 500,
        color: '#333',
        zIndex: 10,
        pointerEvents: 'none',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <span style={{ color: '#666' }}>Trains: </span>
      <span style={{ color: visibleCount < totalCount ? '#2563eb' : '#333' }}>
        {visibleCount}
      </span>
      <span style={{ color: '#999' }}> / {totalCount}</span>
    </div>
  );
}
