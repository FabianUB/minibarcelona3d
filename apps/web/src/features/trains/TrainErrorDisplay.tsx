/**
 * TrainErrorDisplay Component
 *
 * Displays user-friendly error messages when train data cannot be loaded.
 * Shows in overlay when API is unavailable or data fetch fails.
 *
 * Task: T096 - User-friendly error messages for train data failures
 */

import { useTranslation } from 'react-i18next';

interface TrainErrorDisplayProps {
  error: string;
  onRetry?: () => void;
}

export function TrainErrorDisplay({ error, onRetry }: TrainErrorDisplayProps) {
  const { t } = useTranslation('errors');

  return (
    <div
      style={{
        position: 'absolute',
        top: '80px',
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: 'rgba(239, 68, 68, 0.95)',
        color: 'white',
        padding: '12px 20px',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        zIndex: 10,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '14px',
        maxWidth: '400px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, marginBottom: '4px' }}>{t('trains.title')}</div>
        <div style={{ fontSize: '13px', opacity: 0.9 }}>
          {error.includes('fetch') || error.includes('network')
            ? t('trains.network')
            : error.includes('Failed to load')
            ? t('trains.unavailable')
            : t('trains.generic')}
        </div>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            backgroundColor: 'rgba(255, 255, 255, 0.2)',
            color: 'white',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            padding: '6px 12px',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {t('common:buttons.retry')}
        </button>
      )}
    </div>
  );
}
