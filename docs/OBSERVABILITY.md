# Observability & Status Page

This document explains the observability features implemented in the `/status` page, including health monitoring, baseline learning, and anomaly detection.

## Overview

The status page (`/status`) provides real-time visibility into the health of all transit data sources:

- **Rodalies**: Real-time GPS from GTFS-RT API
- **Metro**: Schedule interpolation from TMB API
- **Bus/Tram/FGC**: Static schedule-based positioning

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Poller    │────▶│   SQLite    │◀────│    API      │
│  (metrics)  │     │  (baselines │     │  (health)   │
└─────────────┘     │   history)  │     └─────────────┘
                    └─────────────┘            │
                                               ▼
                                        ┌─────────────┐
                                        │  /status    │
                                        │   page      │
                                        └─────────────┘
```

## Health Scoring

Each network receives a health score (0-100) calculated from weighted components:

| Component | Weight | Description |
|-----------|--------|-------------|
| Data Freshness | 30% | How recent is the data (decays from 30s to 5min) |
| Service Level | 40% | Actual vs expected vehicle count |
| Data Quality | 20% | GPS accuracy (Rodalies) or confidence (Metro) |
| API Health | 10% | Whether the data source is responding |

### Health Status Thresholds

| Score | Status | Color |
|-------|--------|-------|
| 80-100 | Healthy | Green |
| 50-79 | Degraded | Yellow |
| 1-49 | Unhealthy | Red |
| 0 | Unknown | Gray |

## Baseline Learning (ML)

The system learns typical vehicle counts using **Welford's online algorithm** for incremental statistics.

### How It Works

1. **Poller** records vehicle counts every 30 seconds
2. For each observation, update the baseline for `(network, hour, day_of_week)`
3. Store running mean and standard deviation (no raw data stored)

### Time Slots

There are **168 time slots** per network (24 hours × 7 days). Each slot independently tracks:

- `vehicle_count_mean`: Average vehicles at this time
- `vehicle_count_stddev`: Standard deviation
- `sample_count`: Number of observations

### Maturity Levels

| Status | Criteria | Anomaly Detection |
|--------|----------|-------------------|
| Learning | < 30% slots have 7+ samples | Disabled |
| Developing | 30-79% slots mature | Enabled with caution |
| Established | 80%+ slots mature | Fully reliable |

### Database Schema

```sql
CREATE TABLE metrics_baselines (
    network TEXT NOT NULL,
    hour_of_day INTEGER NOT NULL,
    day_of_week INTEGER NOT NULL,
    vehicle_count_mean REAL NOT NULL,
    vehicle_count_stddev REAL NOT NULL,
    sample_count INTEGER NOT NULL,
    PRIMARY KEY (network, hour_of_day, day_of_week)
);
```

## Anomaly Detection

Uses **Z-score** to detect unusual vehicle counts:

```
Z = (actual - mean) / stddev
```

| Z-Score | Severity | Action |
|---------|----------|--------|
| |Z| > 2.0 | Warning | Record anomaly |
| |Z| > 3.0 | Critical | Record with higher severity |
| |Z| ≤ 2.0 | Normal | Auto-resolve existing anomaly |

### Requirements

- Anomaly detection only activates when `sample_count >= 7` for the time slot
- Expected count displays after `sample_count >= 3` (for visibility)

## Uptime Calculation

Uptime is calculated from **health history** (not hardcoded):

```sql
SELECT
    COUNT(*) FILTER (WHERE status IN ('healthy', 'degraded')) * 100.0 / COUNT(*)
FROM metrics_health_history
WHERE recorded_at > datetime('now', '-24 hours')
```

### Health History Schema

```sql
CREATE TABLE metrics_health_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recorded_at TEXT NOT NULL,
    network TEXT NOT NULL,
    health_score INTEGER NOT NULL,
    status TEXT NOT NULL,
    vehicle_count INTEGER NOT NULL DEFAULT 0
);
```

Records are kept for 48 hours, then cleaned up.

## API Endpoints

### GET /api/health/data
Returns data freshness for all networks.

### GET /api/health/networks
Returns health scores, expected counts, and anomaly status.

### GET /api/health/baselines
Returns all learned baselines (for debugging).

### GET /api/health/baselines/summary
Returns baseline maturity summary per network.

### GET /api/health/anomalies
Returns active anomalies.

### GET /api/health/history
Returns health score time series for sparkline visualization.

**Query params:**
- `network`: Network name or "overall" (default: "overall")
- `hours`: Hours of history (default: 2, max: 24)

## Status Page Components

### Health Sparkline
Small SVG chart showing health score trend over the last 2 hours. Color-coded by current status.

### Baseline Maturity
Shows learning progress for each network with:
- Progress bar (coverage vs maturity)
- Status badge (Learning/Developing/Established)
- Expandable details (slots, samples)

### Network Cards
Per-network status with:
- Health score bar
- Sparkline visualization
- Active vehicles / expected count
- Data freshness (real-time networks only)
- Confidence level badge
- Anomaly warnings

## Confidence Levels

| Network | Source | Confidence |
|---------|--------|------------|
| Rodalies | Real-time GPS | High |
| Metro | Schedule interpolation | Medium |
| Bus/Tram/FGC | Static schedule | Low |

## Files

### Backend (Go)
- `apps/api/handlers/health.go` - Health endpoint handlers
- `apps/api/repository/metrics.go` - Database queries
- `apps/api/models/health.go` - Type definitions
- `apps/poller/internal/metrics/welford.go` - Welford's algorithm
- `apps/poller/internal/metrics/baseline.go` - Baseline learner
- `apps/poller/internal/db/metrics.go` - Poller DB methods

### Frontend (React)
- `apps/web/src/features/status/StatusPage.tsx` - Main page
- `apps/web/src/features/status/HealthSparkline.tsx` - Sparkline chart
- `apps/web/src/features/status/BaselineMaturity.tsx` - Learning indicator
- `apps/web/src/lib/api/health.ts` - API client functions
