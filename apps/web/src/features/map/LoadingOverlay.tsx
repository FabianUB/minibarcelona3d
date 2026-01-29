/**
 * LoadingOverlay Component
 *
 * Full-screen loading overlay that covers the app until essential assets are loaded.
 * Shows progress stages indicating what's currently loading.
 *
 * Task: T013 - Loading screen overlay
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface LoadingStages {
  map: boolean;
  models: boolean;
  trains: boolean;
}

interface LoadingOverlayProps {
  stages: LoadingStages;
}

type StageKey = keyof LoadingStages;

const STAGE_ORDER: StageKey[] = ['map', 'models', 'trains'];

export function LoadingOverlay({ stages }: LoadingOverlayProps) {
  const { t } = useTranslation('common');
  const [isVisible, setIsVisible] = useState(true);
  const [isFadingOut, setIsFadingOut] = useState(false);

  const allComplete = stages.map && stages.models && stages.trains;

  // Start fade-out when all stages complete
  useEffect(() => {
    if (allComplete && !isFadingOut) {
      setIsFadingOut(true);
      // Remove from DOM after fade animation completes
      const timer = setTimeout(() => {
        setIsVisible(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [allComplete, isFadingOut]);

  if (!isVisible) {
    return null;
  }

  // Determine which stage is currently in progress (first incomplete stage)
  const currentStageIndex = STAGE_ORDER.findIndex((key) => !stages[key]);

  const getStageIcon = (key: StageKey, index: number) => {
    if (stages[key]) {
      // Complete - checkmark
      return (
        <span className="text-green-400" aria-hidden="true">
          ✓
        </span>
      );
    }
    if (index === currentStageIndex) {
      // In progress - spinner
      return (
        <span
          className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"
          aria-hidden="true"
        />
      );
    }
    // Pending - circle
    return (
      <span className="text-white/50" aria-hidden="true">
        ○
      </span>
    );
  };

  const getStageLabel = (key: StageKey): string => {
    switch (key) {
      case 'map':
        return t('loading.stages.map');
      case 'models':
        return t('loading.stages.models');
      case 'trains':
        return t('loading.stages.trains');
    }
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 transition-opacity duration-300 ${
        isFadingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      role="status"
      aria-live="polite"
      aria-label={t('loading.stages.title')}
    >
      <h2 className="text-white text-2xl font-semibold mb-8">
        {t('loading.stages.title')}
      </h2>

      <ul className="space-y-3 text-white text-lg">
        {STAGE_ORDER.map((key, index) => (
          <li key={key} className="flex items-center gap-3">
            <span className="w-5 flex justify-center">
              {getStageIcon(key, index)}
            </span>
            <span
              className={
                stages[key]
                  ? 'text-white'
                  : index === currentStageIndex
                    ? 'text-white'
                    : 'text-white/50'
              }
            >
              {getStageLabel(key)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
