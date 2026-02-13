import { Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ContrastToggle } from '../accessibility/ContrastToggle';
import { useMapUI, useMapActions } from '../../state/map';
import { SettingsSheet } from './SettingsSheet';

/**
 * SettingsMenu - Application settings menu
 *
 * Provides access to user preferences like high contrast mode.
 * Future settings can be added here (e.g., language, notifications, etc.)
 *
 * Responsive behavior:
 * - Mobile (≤768px): Sheet overlay from bottom, positioned in bottom-right
 * - Desktop (>768px): Expandable card (similar to legend) in top-left, below legend
 */
export function SettingsMenu() {
  const { activePanel } = useMapUI();
  const { setActivePanel } = useMapActions();

  const isExpanded = activePanel === 'settings';
  const isLegendExpanded = activePanel === 'legend';

  const SettingsContent = () => (
    <div className="space-y-4">
      {/* Line Visibility Enhancement Setting */}
      <Separator />
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <label className="text-sm font-medium">Enhance Line Visibility</label>
          <p className="text-xs text-muted-foreground">
            Make train lines thicker and easier to see
          </p>
        </div>
        <ContrastToggle />
      </div>

      <Separator />

      {/* Future settings can be added here */}
      <div className="text-xs text-muted-foreground text-center py-2">
        More settings coming soon...
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile: Sheet (≤768px) */}
      <div className="block md:hidden">
        <SettingsSheet />
      </div>

      {/* Desktop: Expandable card (>768px) - Similar to legend */}
      <div className="hidden md:block">
        {!isExpanded && !isLegendExpanded ? (
          // Collapsed: Settings icon button (below legend at top-4 and train list at top-20)
          <button
            onClick={() => setActivePanel('settings')}
            className="fixed top-36 left-4 w-12 h-12 rounded-full bg-card shadow-lg z-10 flex items-center justify-center hover:scale-105 transition-transform border border-border"
            aria-label="Show settings"
            title="Open Settings"
            data-testid="settings-trigger"
          >
            <Settings className="h-5 w-5 text-foreground" />
          </button>
        ) : isExpanded ? (
          // Expanded: Settings panel
          <Card className="fixed top-36 left-4 w-80 shadow-lg z-10" data-testid="settings-panel">
            <CardHeader className="pb-0">
              <CardTitle className="flex items-center justify-between text-sm">
                <span>Settings</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setActivePanel('none')}
                  className="h-6 w-6 p-0"
                  aria-label="Hide settings"
                >
                  ✕
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 pb-3">
              <SettingsContent />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
