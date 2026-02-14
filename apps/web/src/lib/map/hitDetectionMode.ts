export type HitDetectionMode = 'obr' | 'raycast';

// Session-only override; defaults to 'raycast' on every page load.
// Only changeable via the debug panel (toggledebug).
let sessionMode: HitDetectionMode = 'raycast';

export function getHitDetectionMode(): HitDetectionMode {
  return sessionMode;
}

export function setHitDetectionMode(mode: HitDetectionMode): void {
  sessionMode = mode;
  window.dispatchEvent(new CustomEvent('hit-detection-mode-change', { detail: mode }));
}
