/**
 * SettingsSection Component
 *
 * Settings controls within the control panel.
 * Contains toggles for showing/hiding station markers and train parking.
 */

import { useTranslation } from 'react-i18next';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useMapState, useMapActions } from '@/state/map';
import { MapPin, ParkingCircle } from 'lucide-react';

interface SettingsSectionProps {
  className?: string;
  /** Only show Rodalies-specific settings */
  showRodaliesSettings?: boolean;
}

export function SettingsSection({ className, showRodaliesSettings = false }: SettingsSectionProps) {
  const { t } = useTranslation('controlPanel');
  const { ui } = useMapState();
  const { toggleShowStations, toggleEnableTrainParking } = useMapActions();

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

      {/* Train Parking Toggle - Rodalies only */}
      {showRodaliesSettings && (
        <div className="flex items-center justify-between py-1">
          <div className="flex items-center gap-2">
            <ParkingCircle className="h-4 w-4 text-muted-foreground" />
            <div className="space-y-0.5">
              <label
                htmlFor="train-parking"
                className="text-sm font-medium"
              >
                {t('settings.trainParking')}
              </label>
              <p className="text-xs text-muted-foreground">
                {t('settings.trainParkingDescription')}
              </p>
            </div>
          </div>
          <Switch
            id="train-parking"
            checked={ui.enableTrainParking}
            onCheckedChange={toggleEnableTrainParking}
            aria-label={t('settings.trainParking')}
          />
        </div>
      )}
    </div>
  );
}
