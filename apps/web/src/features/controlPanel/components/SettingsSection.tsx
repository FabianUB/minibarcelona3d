/**
 * SettingsSection Component
 *
 * Settings controls within the control panel.
 * Contains a toggle for showing/hiding station markers and names.
 */

import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useMapState, useMapActions } from '@/state/map';
import { MapPin } from 'lucide-react';

interface SettingsSectionProps {
  className?: string;
}

export function SettingsSection({ className }: SettingsSectionProps) {
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
              Show Stations
            </label>
            <p className="text-xs text-muted-foreground">
              Display station markers on map
            </p>
          </div>
        </div>
        <Switch
          id="show-stations"
          checked={ui.showStations}
          onCheckedChange={toggleShowStations}
          aria-label="Toggle station markers visibility"
        />
      </div>
    </div>
  );
}
