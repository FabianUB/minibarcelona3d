package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/mini-rodalies-3d/poller/internal/config"
	"github.com/mini-rodalies-3d/poller/internal/db"
	"github.com/mini-rodalies-3d/poller/internal/realtime/metro"
	"github.com/mini-rodalies-3d/poller/internal/realtime/rodalies"
	"github.com/mini-rodalies-3d/poller/internal/static"
)

func main() {
	log.Println("Starting Go Poller Service...")

	// Load configuration
	cfg := config.Load()
	log.Printf("Config loaded: poll_interval=%v, retention=%v", cfg.PollInterval, cfg.RetentionDuration)

	// ═══════════════════════════════════════════════════════
	// PHASE 1: Static Data Refresh (startup)
	// ═══════════════════════════════════════════════════════
	log.Println("Checking static data freshness...")
	if err := static.RefreshIfStale(cfg); err != nil {
		log.Printf("Warning: static data refresh failed: %v", err)
		// Continue anyway - use existing data if available
	}

	// ═══════════════════════════════════════════════════════
	// PHASE 2: Initialize Database
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
	// PHASE 3: Initialize Pollers
	// ═══════════════════════════════════════════════════════
	rodaliesPoller := rodalies.NewPoller(database, cfg)
	metroPoller := metro.NewPoller(database, cfg)

	// Load Metro static data (stations and line geometries)
	if err := metroPoller.LoadStaticData(); err != nil {
		log.Printf("Warning: failed to load Metro static data: %v", err)
		// Continue - Metro polling will be skipped if no static data
	}

	// ═══════════════════════════════════════════════════════
	// PHASE 4: Start Polling Loops
	// ═══════════════════════════════════════════════════════
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Initial poll immediately
	log.Println("Running initial poll...")
	pollOnce(ctx, rodaliesPoller, metroPoller, database, cfg)

	// Real-time polling goroutine
	go func() {
		ticker := time.NewTicker(cfg.PollInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				pollOnce(ctx, rodaliesPoller, metroPoller, database, cfg)
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
				if err := static.RefreshIfStale(cfg); err != nil {
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

func pollOnce(ctx context.Context, rodaliesPoller *rodalies.Poller, metroPoller *metro.Poller, database *db.DB, cfg *config.Config) {
	// Poll Rodalies
	if err := rodaliesPoller.Poll(ctx); err != nil {
		log.Printf("Rodalies poll error: %v", err)
	}

	// Poll Metro
	if err := metroPoller.Poll(ctx); err != nil {
		log.Printf("Metro poll error: %v", err)
	}

	// Cleanup old data
	if err := database.Cleanup(ctx, cfg.RetentionDuration); err != nil {
		log.Printf("Cleanup error: %v", err)
	}
}
