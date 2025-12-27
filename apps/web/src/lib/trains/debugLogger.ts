/**
 * Structured Debug Logger for Train Visualization
 *
 * Features:
 * - Categorized logging (POLL, MESH, ANIMATE, PARKING)
 * - Log levels (ERROR, WARN, INFO, DEBUG)
 * - Circular buffer for log storage
 * - Downloadable JSON export
 * - Aggregated summaries for repetitive events
 * - Console groups for organization
 *
 * Usage:
 *   import { trainDebug } from './debugLogger';
 *   trainDebug.poll.info('Fetched trains', { count: 50 });
 *   trainDebug.mesh.warn('Missing position', { vehicleKey: 'X' });
 *
 * Download logs:
 *   trainDebug.download()  // or window.__trainDebug.download()
 */

export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
export type LogCategory = 'POLL' | 'MESH' | 'ANIMATE' | 'PARKING' | 'SYSTEM';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  data?: Record<string, unknown>;
}

interface PollSummary {
  timestamp: string;
  totalTrains: number;
  validTrains: number;
  filteredOut: number;
  nullRouteId: number;
  stoppedAt: number;
  inTransit: number;
  incomingAt: number;
  filledFromStation: number;
  newTrains: string[];
  removedTrains: string[];
  issues: Array<{ vehicleKey: string; issue: string; details?: Record<string, unknown> }>;
}

interface MeshSummary {
  timestamp: string;
  totalMeshes: number;
  created: number;
  updated: number;
  removed: number;
  stoppedAtVisible: number;
  parkingFailed: string[];
  invalidPositions: string[];
}

// Configuration
const CONFIG = {
  maxBufferSize: 500,        // Max log entries to keep
  maxSummaries: 50,          // Max poll summaries to keep
  consoleEnabled: true,      // Output to browser console
  minLevel: 'INFO' as LogLevel,  // Minimum level to log (DEBUG < INFO < WARN < ERROR)
};

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const LEVEL_STYLES: Record<LogLevel, string> = {
  DEBUG: 'color: #888',
  INFO: 'color: #4a9eff',
  WARN: 'color: #ff9800',
  ERROR: 'color: #f44336; font-weight: bold',
};

const CATEGORY_EMOJI: Record<LogCategory, string> = {
  POLL: '📡',
  MESH: '🚃',
  ANIMATE: '🎬',
  PARKING: '🅿️',
  SYSTEM: '⚙️',
};

class TrainDebugLogger {
  private logBuffer: LogEntry[] = [];
  private pollSummaries: PollSummary[] = [];
  private meshSummaries: MeshSummary[] = [];
  private currentPollSummary: Partial<PollSummary> | null = null;
  private currentMeshSummary: Partial<MeshSummary> | null = null;

  constructor() {
    // Expose globally for console access
    if (typeof window !== 'undefined') {
      (window as unknown as { __trainDebug: TrainDebugger }).__trainDebug = this;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Core Logging
  // ─────────────────────────────────────────────────────────────────

  private log(level: LogLevel, category: LogCategory, message: string, data?: Record<string, unknown>) {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[CONFIG.minLevel]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      data,
    };

    // Add to buffer (circular)
    this.logBuffer.push(entry);
    if (this.logBuffer.length > CONFIG.maxBufferSize) {
      this.logBuffer.shift();
    }

    // Console output
    if (CONFIG.consoleEnabled) {
      const prefix = `${CATEGORY_EMOJI[category]} [${category}]`;
      const style = LEVEL_STYLES[level];

      if (level === 'ERROR') {
        console.error(`%c${prefix} ${message}`, style, data ?? '');
      } else if (level === 'WARN') {
        console.warn(`%c${prefix} ${message}`, style, data ?? '');
      } else if (data && Object.keys(data).length > 0) {
        console.log(`%c${prefix} ${message}`, style, data);
      } else {
        console.log(`%c${prefix} ${message}`, style);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Category Loggers (convenient API)
  // ─────────────────────────────────────────────────────────────────

  poll = {
    debug: (msg: string, data?: Record<string, unknown>) => this.log('DEBUG', 'POLL', msg, data),
    info: (msg: string, data?: Record<string, unknown>) => this.log('INFO', 'POLL', msg, data),
    warn: (msg: string, data?: Record<string, unknown>) => this.log('WARN', 'POLL', msg, data),
    error: (msg: string, data?: Record<string, unknown>) => this.log('ERROR', 'POLL', msg, data),
  };

  mesh = {
    debug: (msg: string, data?: Record<string, unknown>) => this.log('DEBUG', 'MESH', msg, data),
    info: (msg: string, data?: Record<string, unknown>) => this.log('INFO', 'MESH', msg, data),
    warn: (msg: string, data?: Record<string, unknown>) => this.log('WARN', 'MESH', msg, data),
    error: (msg: string, data?: Record<string, unknown>) => this.log('ERROR', 'MESH', msg, data),
  };

  animate = {
    debug: (msg: string, data?: Record<string, unknown>) => this.log('DEBUG', 'ANIMATE', msg, data),
    info: (msg: string, data?: Record<string, unknown>) => this.log('INFO', 'ANIMATE', msg, data),
    warn: (msg: string, data?: Record<string, unknown>) => this.log('WARN', 'ANIMATE', msg, data),
    error: (msg: string, data?: Record<string, unknown>) => this.log('ERROR', 'ANIMATE', msg, data),
  };

  parking = {
    debug: (msg: string, data?: Record<string, unknown>) => this.log('DEBUG', 'PARKING', msg, data),
    info: (msg: string, data?: Record<string, unknown>) => this.log('INFO', 'PARKING', msg, data),
    warn: (msg: string, data?: Record<string, unknown>) => this.log('WARN', 'PARKING', msg, data),
    error: (msg: string, data?: Record<string, unknown>) => this.log('ERROR', 'PARKING', msg, data),
  };

  system = {
    debug: (msg: string, data?: Record<string, unknown>) => this.log('DEBUG', 'SYSTEM', msg, data),
    info: (msg: string, data?: Record<string, unknown>) => this.log('INFO', 'SYSTEM', msg, data),
    warn: (msg: string, data?: Record<string, unknown>) => this.log('WARN', 'SYSTEM', msg, data),
    error: (msg: string, data?: Record<string, unknown>) => this.log('ERROR', 'SYSTEM', msg, data),
  };

  // ─────────────────────────────────────────────────────────────────
  // Poll Summary (aggregated logging for each poll cycle)
  // ─────────────────────────────────────────────────────────────────

  startPollSummary() {
    this.currentPollSummary = {
      timestamp: new Date().toISOString(),
      totalTrains: 0,
      validTrains: 0,
      filteredOut: 0,
      nullRouteId: 0,
      stoppedAt: 0,
      inTransit: 0,
      incomingAt: 0,
      filledFromStation: 0,
      newTrains: [],
      removedTrains: [],
      issues: [],
    };
  }

  updatePollSummary(updates: Partial<PollSummary>) {
    if (this.currentPollSummary) {
      Object.assign(this.currentPollSummary, updates);
    }
  }

  addPollIssue(vehicleKey: string, issue: string, details?: Record<string, unknown>) {
    if (this.currentPollSummary) {
      this.currentPollSummary.issues = this.currentPollSummary.issues || [];
      this.currentPollSummary.issues.push({ vehicleKey, issue, details });
    }
  }

  endPollSummary() {
    if (!this.currentPollSummary) return;

    const summary = this.currentPollSummary as PollSummary;
    this.pollSummaries.push(summary);
    if (this.pollSummaries.length > CONFIG.maxSummaries) {
      this.pollSummaries.shift();
    }

    // Log the summary
    const hasIssues = summary.issues.length > 0;

    console.groupCollapsed(
      `%c📡 [POLL] ${summary.validTrains}/${summary.totalTrains} trains | ` +
      `STOPPED:${summary.stoppedAt} TRANSIT:${summary.inTransit} INCOMING:${summary.incomingAt}` +
      (hasIssues ? ` | ⚠️ ${summary.issues.length} issues` : ''),
      hasIssues ? 'color: #ff9800' : 'color: #4a9eff'
    );

    if (summary.filteredOut > 0) {
      console.log(`  ❌ Filtered out (null coords): ${summary.filteredOut}`);
    }
    if (summary.nullRouteId > 0) {
      console.log(`  ⚠️ Null routeId (N/A line): ${summary.nullRouteId}`);
    }
    if (summary.filledFromStation > 0) {
      console.log(`  ✅ Filled coords from station: ${summary.filledFromStation}`);
    }
    if (summary.newTrains.length > 0) {
      console.log(`  ➕ New: ${summary.newTrains.join(', ')}`);
    }
    if (summary.removedTrains.length > 0) {
      console.log(`  ➖ Removed: ${summary.removedTrains.join(', ')}`);
    }

    if (summary.issues.length > 0) {
      console.group('Issues:');
      summary.issues.forEach(issue => {
        console.warn(`  ${issue.vehicleKey}: ${issue.issue}`, issue.details ?? '');
      });
      console.groupEnd();
    }

    console.groupEnd();

    this.currentPollSummary = null;
  }

  // ─────────────────────────────────────────────────────────────────
  // Mesh Summary (aggregated logging for mesh updates)
  // ─────────────────────────────────────────────────────────────────

  startMeshSummary() {
    this.currentMeshSummary = {
      timestamp: new Date().toISOString(),
      totalMeshes: 0,
      created: 0,
      updated: 0,
      removed: 0,
      stoppedAtVisible: 0,
      parkingFailed: [],
      invalidPositions: [],
    };
  }

  updateMeshSummary(updates: Partial<MeshSummary>) {
    if (this.currentMeshSummary) {
      Object.assign(this.currentMeshSummary, updates);
    }
  }

  addMeshParkingFailed(vehicleKey: string) {
    if (this.currentMeshSummary) {
      this.currentMeshSummary.parkingFailed = this.currentMeshSummary.parkingFailed || [];
      this.currentMeshSummary.parkingFailed.push(vehicleKey);
    }
  }

  addMeshInvalidPosition(vehicleKey: string) {
    if (this.currentMeshSummary) {
      this.currentMeshSummary.invalidPositions = this.currentMeshSummary.invalidPositions || [];
      this.currentMeshSummary.invalidPositions.push(vehicleKey);
    }
  }

  endMeshSummary() {
    if (!this.currentMeshSummary) return;

    const summary = this.currentMeshSummary as MeshSummary;
    this.meshSummaries.push(summary);
    if (this.meshSummaries.length > CONFIG.maxSummaries) {
      this.meshSummaries.shift();
    }

    const hasIssues = summary.parkingFailed.length > 0 || summary.invalidPositions.length > 0;

    if (summary.created > 0 || summary.removed > 0 || hasIssues) {
      console.groupCollapsed(
        `%c🚃 [MESH] Total:${summary.totalMeshes} | +${summary.created} -${summary.removed} | ` +
        `STOPPED visible:${summary.stoppedAtVisible}` +
        (hasIssues ? ` | ⚠️ issues` : ''),
        hasIssues ? 'color: #ff9800' : 'color: #4a9eff'
      );

      if (summary.parkingFailed.length > 0) {
        console.warn(`  🅿️ Parking failed: ${summary.parkingFailed.join(', ')}`);
      }
      if (summary.invalidPositions.length > 0) {
        console.error(`  ❌ Invalid positions: ${summary.invalidPositions.join(', ')}`);
      }

      console.groupEnd();
    }

    this.currentMeshSummary = null;
  }

  // ─────────────────────────────────────────────────────────────────
  // Configuration
  // ─────────────────────────────────────────────────────────────────

  setMinLevel(level: LogLevel) {
    CONFIG.minLevel = level;
    this.system.info(`Log level set to ${level}`);
  }

  setConsoleEnabled(enabled: boolean) {
    CONFIG.consoleEnabled = enabled;
  }

  // ─────────────────────────────────────────────────────────────────
  // Export / Download
  // ─────────────────────────────────────────────────────────────────

  getExportData() {
    return {
      exportedAt: new Date().toISOString(),
      config: CONFIG,
      logs: this.logBuffer,
      pollSummaries: this.pollSummaries,
      meshSummaries: this.meshSummaries,
    };
  }

  download(filename?: string) {
    const data = this.getExportData();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename ?? `train-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.system.info('Debug log downloaded');
  }

  clear() {
    this.logBuffer = [];
    this.pollSummaries = [];
    this.meshSummaries = [];
    this.system.info('Debug log cleared');
  }

  // ─────────────────────────────────────────────────────────────────
  // Query / Filter (for console use)
  // ─────────────────────────────────────────────────────────────────

  filter(options: { category?: LogCategory; level?: LogLevel; search?: string }) {
    return this.logBuffer.filter(entry => {
      if (options.category && entry.category !== options.category) return false;
      if (options.level && LEVEL_PRIORITY[entry.level] < LEVEL_PRIORITY[options.level]) return false;
      if (options.search && !entry.message.toLowerCase().includes(options.search.toLowerCase())) return false;
      return true;
    });
  }

  getIssues() {
    return this.pollSummaries.flatMap(s => s.issues);
  }

  getParkingFailures() {
    return this.meshSummaries.flatMap(s => s.parkingFailed);
  }

  getInvalidPositions() {
    return this.meshSummaries.flatMap(s => s.invalidPositions);
  }

  // Print a quick status to console
  status() {
    const lastPoll = this.pollSummaries[this.pollSummaries.length - 1];
    const lastMesh = this.meshSummaries[this.meshSummaries.length - 1];

    console.group('%c🔍 Train Debug Status', 'font-weight: bold; font-size: 14px');

    console.log(`📊 Buffer: ${this.logBuffer.length} logs, ${this.pollSummaries.length} poll summaries`);

    if (lastPoll) {
      console.log(`📡 Last Poll: ${lastPoll.validTrains} trains, ${lastPoll.issues.length} issues`);
    }
    if (lastMesh) {
      console.log(`🚃 Last Mesh: ${lastMesh.totalMeshes} meshes, ${lastMesh.stoppedAtVisible} STOPPED_AT visible`);
    }

    const allIssues = this.getIssues();
    const parkingFails = this.getParkingFailures();
    const invalidPos = this.getInvalidPositions();

    if (allIssues.length > 0 || parkingFails.length > 0 || invalidPos.length > 0) {
      console.group('⚠️ Known Issues:');
      if (allIssues.length > 0) console.log(`  Poll issues: ${allIssues.length}`);
      if (parkingFails.length > 0) console.log(`  Parking failures: ${[...new Set(parkingFails)].join(', ')}`);
      if (invalidPos.length > 0) console.log(`  Invalid positions: ${[...new Set(invalidPos)].join(', ')}`);
      console.groupEnd();
    }

    console.log('\n💡 Commands: __trainDebug.download(), .clear(), .status(), .getIssues()');
    console.groupEnd();
  }
}

// Singleton instance
export const trainDebug = new TrainDebugLogger();

// Type for window augmentation
declare global {
  interface Window {
    __trainDebug: TrainDebugLogger;
  }
}
