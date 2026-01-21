/**
 * LanguageToggle Component
 *
 * A toggle button for switching between English, Spanish, and Catalan.
 * Uses SVG flags for consistent cross-platform display.
 * Click to cycle through languages: ENG → ESP → CAT → ENG
 */

import { useTranslation } from 'react-i18next';
import { useCallback, useMemo } from 'react';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../i18n';

interface LanguageConfig {
  code: SupportedLanguage;
  label: string;
}

const LANGUAGES: LanguageConfig[] = [
  { code: 'en', label: 'EN' },
  { code: 'es', label: 'ES' },
  { code: 'ca', label: 'CA' },
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

function getFlag(code: SupportedLanguage) {
  const flagClass = 'w-5 h-3.5 rounded-[2px] shadow-sm object-cover';
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

  const currentLanguage = useMemo(() => {
    const normalizedLang = i18n.language?.split('-')[0] as SupportedLanguage;
    return (
      LANGUAGES.find((lang) => lang.code === normalizedLang) ||
      LANGUAGES.find((lang) => lang.code === i18n.language) ||
      LANGUAGES[0]
    );
  }, [i18n.language]);

  const cycleLanguage = useCallback(() => {
    const normalizedLang = i18n.language?.split('-')[0];
    const currentIndex = SUPPORTED_LANGUAGES.indexOf(
      normalizedLang as SupportedLanguage
    );
    const nextIndex =
      currentIndex === -1 ? 0 : (currentIndex + 1) % SUPPORTED_LANGUAGES.length;
    const nextLanguage = SUPPORTED_LANGUAGES[nextIndex];
    i18n.changeLanguage(nextLanguage);
  }, [i18n]);

  return (
    <button
      onClick={cycleLanguage}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-accent transition-colors group ${className ?? ''}`}
      aria-label={`Current language: ${currentLanguage.label}. Click to change language.`}
      title="Change language"
    >
      {getFlag(currentLanguage.code)}
      <span className="text-[10px] font-medium text-muted-foreground group-hover:text-foreground transition-colors">
        {currentLanguage.label}
      </span>
    </button>
  );
}
