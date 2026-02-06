package config

import (
	"os"
	"strconv"
	"time"
)

// Config holds all configuration for the poller service
type Config struct {
	// Database
	DatabasePath string

	// Real-time polling
	PollInterval      time.Duration
	RetentionDuration time.Duration

	// Static data refresh
	StaticRefreshDays int
	WebPublicDir      string
	CacheDir          string

	// Rodalies (real-time)
	GTFSVehiclePositionsURL string
	GTFSTripUpdatesURL      string
	GTFSAlertsURL           string

	// Rodalies (static)
	RenfeGTFSURL string

	// Metro/TMB
	TMBAppID        string
	TMBAppKey       string
	TMBGTFSURL      string
	StationsGeoJSON string
	LinesDir        string
}

// Load reads configuration from environment variables with sensible defaults
func Load() *Config {
	cfg := &Config{
		// Database
		DatabasePath: getEnv("SQLITE_DATABASE", "/data/transit.db"),

		// Real-time polling
		PollInterval:      time.Duration(getEnvInt("POLL_INTERVAL", 30)) * time.Second,
		RetentionDuration: time.Duration(getEnvInt("RETENTION_HOURS", 1)) * time.Hour,

		// Static data refresh
		StaticRefreshDays: getEnvInt("STATIC_REFRESH_DAYS", 7),
		WebPublicDir:      getEnv("WEB_PUBLIC_DIR", "/app/web_public"),
		CacheDir:          getEnv("CACHE_DIR", "/data/cache"),

		// Rodalies (real-time)
		GTFSVehiclePositionsURL: getEnv("GTFS_VEHICLE_POSITIONS_URL", "https://gtfsrt.renfe.com/vehicle_positions.pb"),
		GTFSTripUpdatesURL:      getEnv("GTFS_TRIP_UPDATES_URL", "https://gtfsrt.renfe.com/trip_updates.pb"),
		GTFSAlertsURL:           getEnv("GTFS_ALERTS_URL", "https://gtfsrt.renfe.com/alerts.pb"),

		// Rodalies (static)
		RenfeGTFSURL: getEnv("RENFE_GTFS_URL", "https://ssl.renfe.com/ftransit/Fichero_CER_FOMENTO/fomento_transit.zip"),

		// Metro/TMB
		TMBAppID:   getEnv("TMB_APP_ID", ""),
		TMBAppKey:  getEnv("TMB_APP_KEY", ""),
		TMBGTFSURL: getEnv("TMB_GTFS_URL", "https://api.tmb.cat/v1/static/datasets/gtfs.zip"),
	}

	// Derived paths
	cfg.StationsGeoJSON = cfg.WebPublicDir + "/tmb_data/metro/stations.geojson"
	cfg.LinesDir = cfg.WebPublicDir + "/tmb_data/metro/lines"

	return cfg
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intValue, err := strconv.Atoi(value); err == nil {
			return intValue
		}
	}
	return defaultValue
}
