/**
 * Structured Error Logging Utility
 *
 * Provides consistent error logging across the application with:
 * - Structured format for easier parsing/monitoring
 * - Error categorization by severity and type
 * - Context preservation for debugging
 * - Optional external reporting hooks
 */

export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

export type ErrorCategory =
  | 'network'
  | 'api'
  | 'mapbox'
  | 'data'
  | 'render'
  | 'state'
  | 'unknown';

export interface ErrorContext {
  /** Component or module where error occurred */
  component?: string;
  /** Action being performed when error occurred */
  action?: string;
  /** Additional metadata for debugging */
  metadata?: Record<string, unknown>;
  /** User-facing message (if different from technical message) */
  userMessage?: string;
}

export interface LoggedError {
  timestamp: string;
  severity: ErrorSeverity;
  category: ErrorCategory;
  message: string;
  stack?: string;
  context: ErrorContext;
  errorId: string;
}

/**
 * Generate a unique error ID for tracking
 */
function generateErrorId(): string {
  return `err_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Determine error category from error message/type
 */
function categorizeError(error: Error): ErrorCategory {
  const message = error.message.toLowerCase();

  if (message.includes('network') || message.includes('fetch') || message.includes('timed out')) {
    return 'network';
  }
  if (message.includes('api') || message.includes('http')) {
    return 'api';
  }
  if (message.includes('mapbox') || message.includes('map')) {
    return 'mapbox';
  }
  if (message.includes('json') || message.includes('parse') || message.includes('manifest')) {
    return 'data';
  }
  if (message.includes('render') || message.includes('three') || message.includes('webgl')) {
    return 'render';
  }
  if (message.includes('state') || message.includes('reducer')) {
    return 'state';
  }

  return 'unknown';
}

/**
 * Determine error severity based on category and context
 */
function determineSeverity(
  category: ErrorCategory,
  context: ErrorContext
): ErrorSeverity {
  // Critical: Errors that prevent app from functioning
  if (context.component === 'MapCanvas' && category === 'mapbox') {
    return 'critical';
  }
  if (context.action === 'loadManifest' && category === 'data') {
    return 'critical';
  }

  // High: Errors that significantly impact user experience
  if (category === 'api' || category === 'network') {
    return 'high';
  }
  if (category === 'render') {
    return 'high';
  }

  // Medium: Errors that cause some degradation
  if (category === 'data') {
    return 'medium';
  }

  // Low: Minor errors that don't significantly impact UX
  return 'low';
}

/**
 * In-memory error buffer for recent errors
 * Limited to last 50 errors to prevent memory issues
 */
const errorBuffer: LoggedError[] = [];
const MAX_ERROR_BUFFER_SIZE = 50;

/**
 * Optional external error reporter
 * Can be set to send errors to Sentry, LogRocket, etc.
 */
let externalReporter: ((error: LoggedError) => void) | null = null;

/**
 * Set an external error reporter function
 */
export function setExternalReporter(
  reporter: (error: LoggedError) => void
): void {
  externalReporter = reporter;
}

/**
 * Log an error with structured context
 */
export function logError(
  error: Error,
  context: ErrorContext = {},
  overrideSeverity?: ErrorSeverity
): LoggedError {
  const category = categorizeError(error);
  const severity = overrideSeverity ?? determineSeverity(category, context);
  const errorId = generateErrorId();

  const loggedError: LoggedError = {
    timestamp: new Date().toISOString(),
    severity,
    category,
    message: error.message,
    stack: error.stack,
    context,
    errorId,
  };

  // Add to buffer
  errorBuffer.push(loggedError);
  if (errorBuffer.length > MAX_ERROR_BUFFER_SIZE) {
    errorBuffer.shift();
  }

  // Console output with appropriate level
  const logPrefix = `[${severity.toUpperCase()}] [${category}] [${errorId}]`;
  const contextStr = context.component
    ? ` (${context.component}${context.action ? ':' + context.action : ''})`
    : '';

  if (severity === 'critical' || severity === 'high') {
    console.error(`${logPrefix}${contextStr}`, error.message, {
      context,
      stack: error.stack,
    });
  } else if (severity === 'medium') {
    console.warn(`${logPrefix}${contextStr}`, error.message, { context });
  } else {
    console.log(`${logPrefix}${contextStr}`, error.message);
  }

  // Send to external reporter if configured
  if (externalReporter) {
    try {
      externalReporter(loggedError);
    } catch (reporterError) {
      console.warn('Failed to send error to external reporter:', reporterError);
    }
  }

  return loggedError;
}

/**
 * Log an API error with structured context
 */
export function logApiError(
  error: Error,
  endpoint: string,
  additionalContext: Partial<ErrorContext> = {}
): LoggedError {
  return logError(error, {
    component: 'API',
    action: endpoint,
    ...additionalContext,
  });
}

/**
 * Log a data loading error with structured context
 */
export function logDataError(
  error: Error,
  resource: string,
  additionalContext: Partial<ErrorContext> = {}
): LoggedError {
  return logError(error, {
    component: 'DataLoader',
    action: resource,
    ...additionalContext,
  });
}

/**
 * Log a map/render error with structured context
 */
export function logRenderError(
  error: Error,
  component: string,
  additionalContext: Partial<ErrorContext> = {}
): LoggedError {
  return logError(error, {
    component,
    action: 'render',
    ...additionalContext,
  });
}

/**
 * Get recent errors from buffer
 */
export function getRecentErrors(limit: number = 10): LoggedError[] {
  return errorBuffer.slice(-limit);
}

/**
 * Get errors by severity
 */
export function getErrorsBySeverity(severity: ErrorSeverity): LoggedError[] {
  return errorBuffer.filter((e) => e.severity === severity);
}

/**
 * Get error summary for monitoring
 */
export function getErrorSummary(): {
  total: number;
  bySeverity: Record<ErrorSeverity, number>;
  byCategory: Record<ErrorCategory, number>;
  recentCritical: LoggedError[];
} {
  const bySeverity: Record<ErrorSeverity, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };

  const byCategory: Record<ErrorCategory, number> = {
    network: 0,
    api: 0,
    mapbox: 0,
    data: 0,
    render: 0,
    state: 0,
    unknown: 0,
  };

  errorBuffer.forEach((error) => {
    bySeverity[error.severity]++;
    byCategory[error.category]++;
  });

  return {
    total: errorBuffer.length,
    bySeverity,
    byCategory,
    recentCritical: errorBuffer.filter((e) => e.severity === 'critical').slice(-5),
  };
}

/**
 * Clear error buffer
 */
export function clearErrors(): void {
  errorBuffer.length = 0;
}
