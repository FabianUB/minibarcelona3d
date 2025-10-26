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

	"github.com/you/myapp/apps/api/handlers"
	"github.com/you/myapp/apps/api/repository"
)

func main() {
	// Initialize database connection from DATABASE_URL environment variable
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL environment variable is required")
	}

	// Create repository with connection pool
	repo, err := repository.NewTrainRepository(databaseURL)
	if err != nil {
		log.Fatalf("Failed to initialize database repository: %v", err)
	}
	defer repo.Close()

	log.Println("Database connection established")

	// Create train handler with repository
	trainHandler := handlers.NewTrainHandler(repo)

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
		_, err := repo.GetAllTrains(ctx)

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

	// Train API routes
	r.Get("/api/trains", trainHandler.GetAllTrains)
	r.Get("/api/trains/positions", trainHandler.GetAllTrainPositions)
	r.Get("/api/trains/{vehicleKey}", trainHandler.GetTrainByKey)

	// Static file serving (if configured)
	staticDir := os.Getenv("STATIC_DIR")
	if staticDir != "" {
		fs := http.FileServer(http.Dir(staticDir))
		r.Handle("/*", fs)
	}

	log.Println("API server starting on :8080")
	log.Println("Train endpoints:")
	log.Println("  GET /api/trains")
	log.Println("  GET /api/trains/positions")
	log.Println("  GET /api/trains/{vehicleKey}")
	log.Println("  GET /health (with database check)")

	if err := http.ListenAndServe(":8080", r); err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
}
