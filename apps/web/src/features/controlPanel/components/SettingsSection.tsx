/**
 * SettingsSection Component
 *
 * Settings controls within the control panel.
 * Contains a toggle for showing/hiding station markers and names.
 */

import { useTranslation } from 'react-i18next';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useMapState, useMapActions } from '@/state/map';
import { MapPin } from 'lucide-react';

interface SettingsSectionProps {
  className?: string;
}

export function SettingsSection({ className }: SettingsSectionProps) {
  const { t } = useTranslation('controlPanel');
  const { ui } = useMapState();
  const { toggleShowStations } = useMapActions();

  return (
    <div className={cn('space-y-2', className)}>
      {/* Show Stations Toggle */}
      <div className="flex items-center justify-between py-1">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-muted-foreground" />
          <div className="space-y-0.5">
            <label
              htmlFor="show-stations"
              className="text-sm font-medium"
            >
              {t('settings.showStations')}
            </label>
            <p className="text-xs text-muted-foreground">
              {t('settings.showStationsDescription')}
            </p>
          </div>
        </div>
        <Switch
          id="show-stations"
          checked={ui.showStations}
          onCheckedChange={toggleShowStations}
          aria-label={t('settings.showStations')}
        />
      </div>
    </div>
  );
}
