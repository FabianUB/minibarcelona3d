/**
 * SettingsSection Component
 *
 * Settings controls within the control panel.
 * Includes high contrast toggle and other global settings.
 */

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useMapState, useMapActions } from '@/state/map';
import { ChevronDown } from 'lucide-react';

interface SettingsSectionProps {
  className?: string;
  defaultOpen?: boolean;
}

export function SettingsSection({ className, defaultOpen = false }: SettingsSectionProps) {
  const { ui } = useMapState();
  const { toggleHighContrast } = useMapActions();

  return (
    <Collapsible defaultOpen={defaultOpen} className={cn('space-y-2', className)}>
      <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-sm font-medium hover:bg-muted/50 rounded-md px-2 transition-colors">
        <span>Settings</span>
        <ChevronDown className="h-4 w-4 transition-transform duration-200 [&[data-state=open]]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-2">
        {/* High Contrast Toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <label
              htmlFor="high-contrast"
              className="text-sm font-medium"
            >
              High Contrast
            </label>
            <p className="text-xs text-muted-foreground">
              Enhance line visibility
            </p>
          </div>
          <Switch
            id="high-contrast"
            checked={ui.isHighContrast}
            onCheckedChange={toggleHighContrast}
            aria-label="Toggle high contrast mode"
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
