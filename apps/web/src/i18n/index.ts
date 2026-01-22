import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import English translations
import enCommon from './locales/en/common.json';
import enStatus from './locales/en/status.json';
import enControlPanel from './locales/en/controlPanel.json';
import enStations from './locales/en/stations.json';
import enSettings from './locales/en/settings.json';
import enErrors from './locales/en/errors.json';
import enLegend from './locales/en/legend.json';
import enVehicles from './locales/en/vehicles.json';

// Import Spanish translations
import esCommon from './locales/es/common.json';
import esStatus from './locales/es/status.json';
import esControlPanel from './locales/es/controlPanel.json';
import esStations from './locales/es/stations.json';
import esSettings from './locales/es/settings.json';
import esErrors from './locales/es/errors.json';
import esLegend from './locales/es/legend.json';
import esVehicles from './locales/es/vehicles.json';

// Import Catalan translations
import caCommon from './locales/ca/common.json';
import caStatus from './locales/ca/status.json';
import caControlPanel from './locales/ca/controlPanel.json';
import caStations from './locales/ca/stations.json';
import caSettings from './locales/ca/settings.json';
import caErrors from './locales/ca/errors.json';
import caLegend from './locales/ca/legend.json';
import caVehicles from './locales/ca/vehicles.json';

export const SUPPORTED_LANGUAGES = ['en', 'es', 'ca'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const resources = {
  en: {
    common: enCommon,
    status: enStatus,
    controlPanel: enControlPanel,
    stations: enStations,
    settings: enSettings,
    errors: enErrors,
    legend: enLegend,
    vehicles: enVehicles,
  },
  es: {
    common: esCommon,
    status: esStatus,
    controlPanel: esControlPanel,
    stations: esStations,
    settings: esSettings,
    errors: esErrors,
    legend: esLegend,
    vehicles: esVehicles,
  },
  ca: {
    common: caCommon,
    status: caStatus,
    controlPanel: caControlPanel,
    stations: caStations,
    settings: caSettings,
    errors: caErrors,
    legend: caLegend,
    vehicles: caVehicles,
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common', 'status', 'controlPanel', 'stations', 'settings', 'errors', 'legend', 'vehicles'],

    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
      lookupLocalStorage: 'rodalies-language',
    },

    interpolation: {
      escapeValue: false, // React already escapes
    },

    react: {
      useSuspense: true,
    },
  });

export default i18n;
