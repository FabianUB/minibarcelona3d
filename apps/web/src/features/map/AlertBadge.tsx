import { useEffect, useState } from 'react';
import { fetchAlerts } from '../../lib/api/delays';

const POLL_INTERVAL = 60000; // 60 seconds

export function AlertBadge() {
  const [alertCount, setAlertCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const response = await fetchAlerts();
        if (!cancelled) {
          setAlertCount(response.count);
        }
      } catch {
        // Silently ignore - this is a non-critical indicator
      }
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (alertCount === 0) return null;

  return (
    <a
      href="/delays"
      style={{
        position: 'fixed',
        top: '1rem',
        right: '3.5rem',
        zIndex: 40,
        display: 'flex',
        alignItems: 'center',
        gap: '0.375rem',
        padding: '0.375rem 0.625rem',
        borderRadius: '9999px',
        backgroundColor: 'rgba(239, 68, 68, 0.9)',
        color: 'white',
        fontSize: '0.75rem',
        fontWeight: 600,
        textDecoration: 'none',
        backdropFilter: 'blur(6px)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        cursor: 'pointer',
      }}
    >
      <span style={{
        display: 'inline-block',
        width: '0.5rem',
        height: '0.5rem',
        borderRadius: '50%',
        backgroundColor: 'white',
        animation: 'pulse 2s infinite',
      }} />
      {alertCount} {alertCount === 1 ? 'alert' : 'alerts'}
    </a>
  );
}
