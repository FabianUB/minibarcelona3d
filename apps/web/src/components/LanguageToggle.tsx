/**
 * LanguageToggle Component
 *
 * A dropdown menu for switching between English, Spanish, and Catalan.
 * Uses SVG flags for consistent cross-platform display.
 */

import { useTranslation } from 'react-i18next';
import { useCallback, useMemo, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import type { SupportedLanguage } from '../i18n';

interface LanguageConfig {
  code: SupportedLanguage;
  label: string;
  name: string;
}

const LANGUAGES: LanguageConfig[] = [
  { code: 'en', label: 'EN', name: 'English' },
  { code: 'es', label: 'ES', name: 'Español' },
  { code: 'ca', label: 'CA', name: 'Català' },
];

/** UK flag (Union Jack) for English */
function FlagUK({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 60 30" className={className} aria-hidden="true">
      <clipPath id="uk-clip">
        <rect width="60" height="30" />
      </clipPath>
      <g clipPath="url(#uk-clip)">
        <rect width="60" height="30" fill="#012169" />
        <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
        <path d="M0,0 L60,30 M60,0 L0,30" stroke="#C8102E" strokeWidth="4" clipPath="url(#uk-diag)" />
        <clipPath id="uk-diag">
          <path d="M30,15 L60,30 L60,15 L30,0 L0,0 L0,15 L30,30 L60,30 Z" />
        </clipPath>
        <path d="M30,0 V30 M0,15 H60" stroke="#fff" strokeWidth="10" />
        <path d="M30,0 V30 M0,15 H60" stroke="#C8102E" strokeWidth="6" />
      </g>
    </svg>
  );
}

/** Spain flag (Rojigualda) */
function FlagSpain({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 750 500" className={className} aria-hidden="true">
      <rect width="750" height="500" fill="#c60b1e" />
      <rect width="750" height="250" y="125" fill="#ffc400" />
    </svg>
  );
}

/** Catalonia flag (La Senyera) */
function FlagCatalonia({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 810 540" className={className} aria-hidden="true">
      <rect width="810" height="540" fill="#FCDD09" />
      <path
        stroke="#DA121A"
        strokeWidth="60"
        d="M0,90H810 M0,210H810 M0,330H810 M0,450H810"
      />
    </svg>
  );
}

function getFlag(code: SupportedLanguage, className?: string) {
  const flagClass = className ?? 'w-5 h-3.5 rounded-[2px] shadow-sm';
  switch (code) {
    case 'en':
      return <FlagUK className={flagClass} />;
    case 'es':
      return <FlagSpain className={flagClass} />;
    case 'ca':
      return <FlagCatalonia className={flagClass} />;
  }
}

interface LanguageToggleProps {
  className?: string;
}

export function LanguageToggle({ className }: LanguageToggleProps) {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);

  const currentLanguage = useMemo(() => {
    const normalizedLang = i18n.language?.split('-')[0] as SupportedLanguage;
    return (
      LANGUAGES.find((lang) => lang.code === normalizedLang) ||
      LANGUAGES.find((lang) => lang.code === i18n.language) ||
      LANGUAGES[0]
    );
  }, [i18n.language]);

  const selectLanguage = useCallback(
    (code: SupportedLanguage) => {
      i18n.changeLanguage(code);
      setOpen(false);
    },
    [i18n]
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-accent transition-colors group ${className ?? ''}`}
          aria-label={`Current language: ${currentLanguage.name}. Click to change language.`}
        >
          {getFlag(currentLanguage.code)}
          <span className="text-[10px] font-medium text-muted-foreground group-hover:text-foreground transition-colors">
            {currentLanguage.label}
          </span>
          <ChevronDown className="h-3 w-3 text-muted-foreground group-hover:text-foreground transition-colors" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-36 p-1"
        align="start"
        sideOffset={8}
      >
        <div className="flex flex-col">
          {LANGUAGES.map((lang) => {
            const isSelected = lang.code === currentLanguage.code;
            return (
              <button
                key={lang.code}
                onClick={() => selectLanguage(lang.code)}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors ${
                  isSelected
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-muted'
                }`}
              >
                {getFlag(lang.code, 'w-5 h-3.5 rounded-[2px] shadow-sm')}
                <span className="text-xs font-medium flex-1">{lang.name}</span>
                {isSelected && (
                  <Check className="h-3.5 w-3.5 text-foreground" />
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
