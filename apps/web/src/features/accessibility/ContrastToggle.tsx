import { Switch } from '@/components/ui/switch';
import { useMapActions, useMapState } from '../../state/map';

/**
 * ContrastToggle - High contrast mode toggle component
 *
 * Provides an accessible switch to toggle between standard and high-contrast themes.
 * State is managed through the map state provider and persists across sessions (T029).
 *
 * Design decisions:
 * - Uses Switch component for clear on/off state
 * - Maintains ≥44x44px touch target for mobile accessibility (WCAG)
 * - aria-label indicates current state and action
 * - Used within Settings menu
 */
export function ContrastToggle() {
  const { ui } = useMapState();
  const { toggleHighContrast } = useMapActions();

  const isHighContrast = ui.isHighContrast;

  return (
    <Switch
      checked={isHighContrast}
      onCheckedChange={toggleHighContrast}
      aria-label={isHighContrast ? 'Disable enhanced line visibility' : 'Enable enhanced line visibility'}
      data-testid="contrast-toggle"
    />
  );
}
