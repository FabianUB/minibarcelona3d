package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/mini-rodalies-3d/poller/internal/config"
	"github.com/mini-rodalies-3d/poller/internal/db"
	"github.com/mini-rodalies-3d/poller/internal/metrics"
	"github.com/mini-rodalies-3d/poller/internal/realtime/metro"
	"github.com/mini-rodalies-3d/poller/internal/realtime/rodalies"
	"github.com/mini-rodalies-3d/poller/internal/realtime/schedule"
	"github.com/mini-rodalies-3d/poller/internal/static"
)

// cleanupRunning tracks async cleanup to prevent overlapping runs using atomic CAS
var cleanupRunning atomic.Bool

func main() {
	log.Println("Starting Go Poller Service...")

	// Load configuration
	cfg := config.Load()
	log.Printf("Config loaded: poll_interval=%v, retention=%v", cfg.PollInterval, cfg.RetentionDuration)

	// ═══════════════════════════════════════════════════════
	// PHASE 1: Initialize Database (before static refresh)
	// ═══════════════════════════════════════════════════════
	database, err := db.Connect(cfg.DatabasePath)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer database.Close()

	if err := database.EnsureSchema(context.Background()); err != nil {
		log.Fatalf("Failed to ensure database schema: %v", err)
	}
	log.Println("Database initialized")

	// ═══════════════════════════════════════════════════════
	// PHASE 2: Static Data Refresh (startup)
	// ═══════════════════════════════════════════════════════
	log.Println("Checking static data freshness...")
	if err := static.RefreshIfStale(cfg, database); err != nil {
		log.Printf("Warning: static data refresh failed: %v", err)
		// Continue anyway - use existing data if available
	}

	// ═══════════════════════════════════════════════════════
	// PHASE 3: Initialize Pollers
	// ═══════════════════════════════════════════════════════
	rodaliesPoller := rodalies.NewPoller(database, cfg)
	metroPoller := metro.NewPoller(database, cfg)

	// Load Metro static data (stations and line geometries)
	if err := metroPoller.LoadStaticData(); err != nil {
		log.Printf("Warning: failed to load Metro static data: %v", err)
		// Continue - Metro polling will be skipped if no static data
	}

	// Initialize schedule poller for TRAM, FGC, and Bus
	schedulePoller, err := schedule.NewPoller(database, cfg)
	if err != nil {
		log.Printf("Warning: failed to create schedule poller: %v", err)
		// Continue without schedule-based estimation
	}

	// Initialize baseline learner for gradual ML learning
	baselineLearner := metrics.NewBaselineLearner(database)

	// ═══════════════════════════════════════════════════════
	// PHASE 4: Start Polling Loops
	// ═══════════════════════════════════════════════════════
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Initial poll immediately
	log.Println("Running initial poll...")
	pollOnce(ctx, rodaliesPoller, metroPoller, schedulePoller, database, cfg, baselineLearner)

	// Real-time polling goroutine
	go func() {
		ticker := time.NewTicker(cfg.PollInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				pollOnce(ctx, rodaliesPoller, metroPoller, schedulePoller, database, cfg, baselineLearner)
			case <-ctx.Done():
				log.Println("Polling loop stopped")
				return
			}
		}
	}()

	// Weekly static data refresh goroutine
	go func() {
		// Check every 24 hours
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				log.Println("Running daily static data freshness check...")
				if err := static.RefreshIfStale(cfg, database); err != nil {
					log.Printf("Weekly refresh failed: %v", err)
				}
			case <-ctx.Done():
				log.Println("Static refresh loop stopped")
				return
			}
		}
	}()

	log.Printf("Poller running (poll every %v, retain %v)", cfg.PollInterval, cfg.RetentionDuration)

	// ═══════════════════════════════════════════════════════
	// PHASE 5: Graceful Shutdown
	// ═══════════════════════════════════════════════════════
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig

	log.Println("Shutting down...")
	cancel()

	// Give goroutines time to finish
	time.Sleep(100 * time.Millisecond)
	log.Println("Goodbye!")
}

func pollOnce(ctx context.Context, rodaliesPoller *rodalies.Poller, metroPoller *metro.Poller, schedulePoller *schedule.Poller, database *db.DB, cfg *config.Config, baselineLearner *metrics.BaselineLearner) {
	// Poll Rodalies
	if err := rodaliesPoller.Poll(ctx); err != nil {
		log.Printf("Rodalies poll error: %v", err)
	}

	// Poll Metro
	if err := metroPoller.Poll(ctx); err != nil {
		log.Printf("Metro poll error: %v", err)
	}

	// Poll Schedule-based (TRAM, FGC, Bus)
	if schedulePoller != nil {
		if err := schedulePoller.Poll(ctx); err != nil {
			log.Printf("Schedule poll error: %v", err)
		}
	}

	// Update baselines with current vehicle counts (gradual learning)
	if err := baselineLearner.UpdateBaselines(ctx); err != nil {
		log.Printf("Baseline update error: %v", err)
	}

	// Record health status for uptime tracking
	if err := baselineLearner.RecordHealthStatuses(ctx); err != nil {
		log.Printf("Health status recording error: %v", err)
	}

	// Async cleanup - don't block polling, skip if already running
	go runCleanupAsync(database, cfg.RetentionDuration)
}

// runCleanupAsync runs cleanup in background, skipping if already running.
// Uses atomic CompareAndSwap to avoid TOCTOU race conditions.
func runCleanupAsync(database *db.DB, retention time.Duration) {
	// Atomically set flag to true only if currently false
	if !cleanupRunning.CompareAndSwap(false, true) {
		return // Already running, skip this cleanup cycle
	}
	defer cleanupRunning.Store(false)

	if err := database.Cleanup(context.Background(), retention); err != nil {
		log.Printf("Cleanup error: %v", err)
	}
}
