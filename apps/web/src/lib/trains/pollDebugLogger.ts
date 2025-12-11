/**
 * Lightweight in-memory poll debug log for animation/poll issues.
 * Stores a bounded buffer and exposes helpers to inspect or download the log.
 */

export interface PollDebugEntry {
  pollTimestampMs: number | null;
  receivedAtMs: number | null;
  processed: boolean;
  reason?: 'duplicate' | 'ok';
  trainCount: number;
  addedCount: number;
  removedCount: number;
  stuckCount: number;
  dataAgeMs: number | null;
  updateCallsThisSecond: number;
  // Optional per-train watch payload (shape is producer-defined)
  watch?: unknown;
}

const MAX_ENTRIES = 300;
const entries: PollDebugEntry[] = [];

export function logPollDebug(entry: PollDebugEntry): void {
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries.shift();
  }

  if (typeof window !== 'undefined' && import.meta.env?.VITE_LOG_POLLS_TO_FILE === 'true') {
    void sendEntryToDevServer(entry);
  }
}

export function getPollDebugLog(): PollDebugEntry[] {
  return [...entries];
}

export function clearPollDebugLog(): void {
  entries.length = 0;
}

export function downloadPollDebugLog(filename = 'train-poll-debug.json'): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    console.warn('downloadPollDebugLog is only available in the browser.');
    return;
  }

  const blob = new Blob([JSON.stringify(entries, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// Expose helpers for quick access in devtools
if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__trainPollDebugLog = {
    get: getPollDebugLog,
    clear: clearPollDebugLog,
    download: downloadPollDebugLog,
  };
}

async function sendEntryToDevServer(entry: PollDebugEntry): Promise<void> {
  try {
    await fetch('/__poll-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
      keepalive: true,
    });
  } catch (err) {
    // Swallow errors to avoid impacting runtime
    if (typeof console !== 'undefined') {
      console.debug('PollDebugLogger: failed to POST poll log', err);
    }
  }
}
