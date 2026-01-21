/**
 * ServiceUnavailable Component
 *
 * Displays a friendly error page when Mapbox services are unavailable,
 * typically due to rate limits being exceeded or authentication issues.
 */

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface ServiceUnavailableProps {
  /** Error type that triggered this page */
  errorType: 'rate-limit' | 'auth' | 'network' | 'unknown';
  /** Optional callback when user clicks retry */
  onRetry?: () => void;
}

export function ServiceUnavailable({ errorType, onRetry }: ServiceUnavailableProps) {
  const { t } = useTranslation('errors');
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetry = useCallback(() => {
    if (onRetry) {
      setIsRetrying(true);
      // Give visual feedback before retry
      setTimeout(() => {
        onRetry();
        setIsRetrying(false);
      }, 500);
    } else {
      // Default: reload the page
      window.location.reload();
    }
  }, [onRetry]);

  const getErrorMessage = () => {
    switch (errorType) {
      case 'rate-limit':
        return {
          title: t('service.rateLimit.title'),
          description: t('service.rateLimit.description'),
          suggestion: t('service.rateLimit.suggestion'),
        };
      case 'auth':
        return {
          title: t('service.auth.title'),
          description: t('service.auth.description'),
          suggestion: t('service.auth.suggestion'),
        };
      case 'network':
        return {
          title: t('service.network.title'),
          description: t('service.network.description'),
          suggestion: t('service.network.suggestion'),
        };
      default:
        return {
          title: t('service.unknown.title'),
          description: t('service.unknown.description'),
          suggestion: t('service.unknown.suggestion'),
        };
    }
  };

  const { title, description, suggestion } = getErrorMessage();

  return (
    <div className="service-unavailable">
      <div className="service-unavailable__content">
        {/* Train icon */}
        <div className="service-unavailable__icon">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="service-unavailable__icon-svg"
          >
            <path d="M4 11V8a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v3" />
            <path d="M4 11v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />
            <path d="M4 11h16" />
            <circle cx="7.5" cy="14.5" r="1.5" />
            <circle cx="16.5" cy="14.5" r="1.5" />
            <path d="M6 20v2" />
            <path d="M18 20v2" />
          </svg>
        </div>

        {/* Error message */}
        <h1 className="service-unavailable__title">{title}</h1>
        <p className="service-unavailable__description">{description}</p>
        <p className="service-unavailable__suggestion">{suggestion}</p>

        {/* Retry button */}
        <button
          onClick={handleRetry}
          disabled={isRetrying}
          className="service-unavailable__retry-button"
        >
          {isRetrying ? t('buttons.retrying') : t('buttons.tryAgain')}
        </button>

        {/* Footer */}
        <p className="service-unavailable__footer">
          {t('footer')}
        </p>
      </div>

      <style>{`
        .service-unavailable {
          position: fixed;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
          color: #f1f5f9;
          font-family: system-ui, -apple-system, sans-serif;
          z-index: 9999;
          padding: 1.5rem;
        }

        .service-unavailable__content {
          max-width: 420px;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .service-unavailable__icon {
          margin-bottom: 1.5rem;
          background: rgba(59, 130, 246, 0.15);
          padding: 1.25rem;
          border-radius: 1rem;
        }

        .service-unavailable__icon-svg {
          width: 56px;
          height: 56px;
          color: #60a5fa;
        }

        .service-unavailable__title {
          font-size: 1.75rem;
          font-weight: 700;
          margin: 0 0 1rem 0;
          color: #f8fafc;
        }

        .service-unavailable__description {
          font-size: 1rem;
          line-height: 1.6;
          color: #cbd5e1;
          margin: 0 0 0.5rem 0;
        }

        .service-unavailable__suggestion {
          font-size: 0.9rem;
          color: #94a3b8;
          margin: 0 0 2rem 0;
        }

        .service-unavailable__retry-button {
          background: #3b82f6;
          color: white;
          border: none;
          padding: 0.875rem 2.5rem;
          font-size: 1rem;
          font-weight: 600;
          border-radius: 0.5rem;
          cursor: pointer;
          transition: background 0.2s, transform 0.1s;
        }

        .service-unavailable__retry-button:hover:not(:disabled) {
          background: #2563eb;
          transform: translateY(-1px);
        }

        .service-unavailable__retry-button:active:not(:disabled) {
          transform: translateY(0);
        }

        .service-unavailable__retry-button:disabled {
          background: #475569;
          cursor: not-allowed;
        }

        .service-unavailable__footer {
          margin-top: 3rem;
          font-size: 0.8rem;
          color: #475569;
        }

        @media (max-width: 480px) {
          .service-unavailable {
            padding: 1rem;
          }

          .service-unavailable__title {
            font-size: 1.5rem;
          }

          .service-unavailable__icon-svg {
            width: 48px;
            height: 48px;
          }
        }
      `}</style>
    </div>
  );
}
