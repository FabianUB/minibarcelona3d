package static

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/mini-rodalies-3d/poller/internal/config"
	"github.com/mini-rodalies-3d/poller/internal/static/gtfs"
	rodaliesgen "github.com/mini-rodalies-3d/poller/internal/static/rodalies"
	tmbgen "github.com/mini-rodalies-3d/poller/internal/static/tmb"
)

// Manifest represents the manifest.json structure
type Manifest struct {
	GeneratedAt string `json:"generated_at"`
	Version     string `json:"version"`
}

// RefreshIfStale checks manifest files and refreshes data if older than threshold
func RefreshIfStale(cfg *config.Config) error {
	rodaliesManifest := filepath.Join(cfg.WebPublicDir, "rodalies_data", "manifest.json")
	tmbManifest := filepath.Join(cfg.WebPublicDir, "tmb_data", "manifest.json")

	rodaliesStale := isStaleOrMissing(rodaliesManifest, cfg.StaticRefreshDays)
	tmbStale := isStaleOrMissing(tmbManifest, cfg.StaticRefreshDays)

	if !rodaliesStale && !tmbStale {
		log.Println("Static data is fresh, skipping refresh")
		return nil
	}

	// Ensure cache directory exists
	if err := os.MkdirAll(cfg.CacheDir, 0755); err != nil {
		return err
	}

	// Refresh Rodalies data - DISABLED
	// The Renfe GTFS contains all Spanish Cercanías, not just Catalunya's Rodalies.
	// The generator needs filtering to only include R* lines before re-enabling.
	if rodaliesStale {
		log.Println("Rodalies static refresh disabled - using existing data")
		// if err := refreshRodalies(cfg); err != nil {
		// 	log.Printf("Failed to refresh Rodalies data: %v", err)
		// } else {
		// 	log.Println("Rodalies static data refreshed successfully")
		// }
	}

	// Refresh TMB data
	if tmbStale {
		log.Println("Refreshing TMB static data...")
		if err := refreshTMB(cfg); err != nil {
			log.Printf("Failed to refresh TMB data: %v", err)
		} else {
			log.Println("TMB static data refreshed successfully")
		}
	}

	return nil
}

func isStaleOrMissing(manifestPath string, maxAgeDays int) bool {
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		// File doesn't exist or can't be read
		return true
	}

	var manifest Manifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return true
	}

	generatedAt, err := time.Parse(time.RFC3339, manifest.GeneratedAt)
	if err != nil {
		return true
	}

	age := time.Since(generatedAt)
	maxAge := time.Duration(maxAgeDays) * 24 * time.Hour

	return age > maxAge
}

func refreshRodalies(cfg *config.Config) error {
	// Download GTFS zip
	zipPath := filepath.Join(cfg.CacheDir, "renfe_gtfs.zip")
	if err := gtfs.Download(cfg.RenfeGTFSURL, zipPath); err != nil {
		return err
	}

	// Parse GTFS data
	data, err := gtfs.Parse(zipPath)
	if err != nil {
		return err
	}

	// Generate GeoJSON files
	outputDir := filepath.Join(cfg.WebPublicDir, "rodalies_data")
	return rodaliesgen.Generate(data, outputDir)
}

func refreshTMB(cfg *config.Config) error {
	// Check if TMB credentials are configured
	if cfg.TMBAppID == "" || cfg.TMBAppKey == "" {
		log.Println("TMB API credentials not configured, skipping TMB refresh")
		return nil
	}

	// Download GTFS zip with credentials
	zipPath := filepath.Join(cfg.CacheDir, "tmb_gtfs.zip")
	url := cfg.TMBGTFSURL
	if url == "" {
		url = "https://api.tmb.cat/v1/static/datasets/gtfs.zip"
	}

	if err := gtfs.DownloadWithAuth(url, zipPath, cfg.TMBAppID, cfg.TMBAppKey); err != nil {
		return err
	}

	// Parse GTFS data
	data, err := gtfs.Parse(zipPath)
	if err != nil {
		return err
	}

	// Generate GeoJSON files
	outputDir := filepath.Join(cfg.WebPublicDir, "tmb_data")
	return tmbgen.Generate(data, outputDir)
}
