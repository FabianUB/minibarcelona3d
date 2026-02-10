import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { ContrastToggle } from '../accessibility/ContrastToggle';

/**
 * SettingsSheet - Mobile settings UI using bottom sheet
 *
 * Displays settings as a bottom sheet overlay on mobile devices (≤768px).
 * Provides touch-friendly interface for user preferences.
 *
 * Design decisions:
 * - Bottom sheet for modal settings access
 * - Fixed bottom-right trigger button for easy thumb access
 * - Vertical layout for settings with clear labels and descriptions
 */

export function SettingsSheet() {
  const { t } = useTranslation('settings');
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button
          variant="secondary"
          size="icon"
          className="fixed bottom-4 right-4 z-10 shadow-lg w-12 h-12"
          aria-label={t('openSettings')}
          data-testid="settings-trigger"
        >
          <Settings className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="h-auto max-h-[80vh]">
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
        </SheetHeader>
        <Separator className="my-3" />
        <div className="pb-6 px-2">
          <div className="space-y-4">
            {/* Line Visibility Enhancement Setting */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <label className="text-sm font-medium">{t('enhanceVisibility.label')}</label>
                <p className="text-xs text-muted-foreground">
                  {t('enhanceVisibility.description')}
                </p>
              </div>
              <ContrastToggle />
            </div>

            <Separator />

            {/* Future settings can be added here */}
            <div className="text-xs text-muted-foreground text-center py-2">
              {t('comingSoon')}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
