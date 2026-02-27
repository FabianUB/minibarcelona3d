import { useState, useEffect } from 'react';

/**
 * Returns `true` when the browser tab is visible, `false` when hidden.
 * Useful for pausing GPU work, network polling, and animation loops
 * when the user has switched away from the tab.
 */
export function usePageVisibility(): boolean {
  const [visible, setVisible] = useState(!document.hidden);

  useEffect(() => {
    const handler = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  return visible;
}
