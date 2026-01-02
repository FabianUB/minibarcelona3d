package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"github.com/joho/godotenv"

	"github.com/you/myapp/apps/api/handlers"
	"github.com/you/myapp/apps/api/repository"
)

func main() {
	// Load .env files from repository root
	// Load base .env first, then .env.local (which overrides for local development)
	_ = godotenv.Load("../../.env")
	_ = godotenv.Overload("../../.env.local") // Overload forces override of existing values

	// Initialize SQLite database connection
	// Default to ../../data/transit.db relative to the api directory
	dbPath := os.Getenv("SQLITE_DATABASE")
	if dbPath == "" {
		dbPath = "../../data/transit.db"
	}
	log.Printf("Connecting to SQLite database: %s", dbPath)

	// Create SQLite database connection
	sqliteDB, err := repository.NewSQLiteDB(dbPath)
	if err != nil {
		log.Fatalf("Failed to initialize SQLite database: %v", err)
	}
	defer sqliteDB.Close()

	log.Println("SQLite database connection established")

	// Create train repository and handler
	trainRepo := repository.NewSQLiteTrainRepository(sqliteDB.GetDB())
	trainHandler := handlers.NewTrainHandler(trainRepo)

	// Create Metro repository and handler
	metroRepo := repository.NewSQLiteMetroRepository(sqliteDB.GetDB())
	metroHandler := handlers.NewMetroHandler(metroRepo)

	// Setup router
	r := chi.NewRouter()
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"http://localhost:5173"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"*"},
		AllowCredentials: true,
	}))

	// Health check endpoint with database connectivity test
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		// Test database connectivity by attempting to get all trains
		_, err := trainRepo.GetAllTrains(ctx)

		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"status":    "error",
				"database":  "disconnected",
				"timestamp": time.Now().UTC(),
				"error":     err.Error(),
			})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":    "ok",
			"database":  "connected",
			"timestamp": time.Now().UTC(),
		})
	})

	// Legacy health check endpoint (kept for backwards compatibility)
	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	// Legacy ping endpoint
	r.Get("/api/ping", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("pong"))
	})

	// Train API routes (Rodalies)
	r.Get("/api/trains", trainHandler.GetAllTrains)
	r.Get("/api/trains/positions", trainHandler.GetAllTrainPositions)
	r.Get("/api/trains/{vehicleKey}", trainHandler.GetTrainByKey)
	r.Get("/api/trips/{tripId}", trainHandler.GetTripDetails)

	// Metro API routes
	r.Get("/api/metro/positions", metroHandler.GetAllMetroPositions)
	r.Get("/api/metro/lines/{lineCode}", metroHandler.GetMetroByLine)

	// Static file serving (if configured)
	staticDir := os.Getenv("STATIC_DIR")
	if staticDir != "" {
		fs := http.FileServer(http.Dir(staticDir))
		r.Handle("/*", fs)
	}

	// Get port from environment variable, default to 8081
	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}

	log.Printf("API server starting on :%s", port)
	log.Println("Train endpoints (Rodalies):")
	log.Println("  GET /api/trains")
	log.Println("  GET /api/trains/positions")
	log.Println("  GET /api/trains/{vehicleKey}")
	log.Println("  GET /api/trips/{tripId}")
	log.Println("Metro endpoints:")
	log.Println("  GET /api/metro/positions")
	log.Println("  GET /api/metro/lines/{lineCode}")
	log.Println("Health:")
	log.Println("  GET /health (with database check)")

	if err := http.ListenAndServe(":"+port, r); err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
}
