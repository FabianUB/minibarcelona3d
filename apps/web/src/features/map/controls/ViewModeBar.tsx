/**
 * ViewModeBar Component
 *
 * Floating segmented toggle below the NetworkBar for switching camera views.
 * Controlled component — parent owns the current mode state.
 */

import { useTranslation } from 'react-i18next';
import { Eye, Bird } from 'lucide-react';

export type ViewMode = 'free' | 'birdsEye';

interface ViewModeBarProps {
  currentMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

export function ViewModeBar({ currentMode, onViewModeChange }: ViewModeBarProps) {
  const { t } = useTranslation('common');

  return (
    <div className="fixed top-[3.75rem] left-1/2 -translate-x-1/2 z-[15] flex items-center gap-1 p-1 bg-background/95 backdrop-blur-sm border border-border/50 rounded-xl shadow-lg">
      <button
        onClick={() => onViewModeChange('free')}
        title={t('buttons.viewModeFreeView')}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-150 ${
          currentMode === 'free'
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
        }`}
      >
        <Eye className="w-3.5 h-3.5" />
        3D
      </button>
      <button
        onClick={() => onViewModeChange('birdsEye')}
        title={t('buttons.viewModeBirdsEye')}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-150 ${
          currentMode === 'birdsEye'
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
        }`}
      >
        <Bird className="w-3.5 h-3.5" />
        {t('buttons.viewModeBirdsEyeShort')}
      </button>
    </div>
  );
}
