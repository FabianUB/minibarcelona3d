import { useState, useCallback } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import type { TrainPosition } from '../../types/trains';
import { TrainListPanel } from './TrainListPanel';

interface TrainListButtonProps {
  trains: TrainPosition[];
  map: MapboxMap;
}

/**
 * TrainListButton - Standalone button and panel for viewing all trains
 *
 * This component is intentionally separate from TrainLayer3D to avoid
 * re-renders that affect the map's internal state (which was causing
 * crashes in StationLayer).
 */
export function TrainListButton({ trains, map }: TrainListButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleOpen = useCallback(() => {
    setIsOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  return (
    <>
      {/* Train List Button - positioned between legend (top-4) and settings (top-36) buttons on left */}
      <button
        onClick={handleOpen}
        className="hidden md:flex fixed top-20 left-4 w-12 h-12 rounded-full bg-card shadow-lg z-10 items-center justify-center hover:scale-105 transition-transform border border-border"
        aria-label="Show train list"
        title="View Train List"
        data-testid="train-list-trigger"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-foreground"
        >
          {/* List icon */}
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      </button>
      {/* Train List Panel */}
      <TrainListPanel
        trains={trains}
        map={map}
        isOpen={isOpen}
        onClose={handleClose}
      />
    </>
  );
}
