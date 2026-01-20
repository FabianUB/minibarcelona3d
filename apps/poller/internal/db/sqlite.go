package db

import (
	"context"
	"database/sql"
	_ "embed"
	"fmt"
	"log"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

// schemaSQL is the single source of truth for the database schema.
// It is embedded at compile time from schema.sql.
// Both Go code (EnsureSchema) and init-db.sh use this same file.
//
//go:embed schema.sql
var schemaSQL string

// DB wraps a SQLite database connection with write serialization
type DB struct {
	conn    *sql.DB
	writeMu sync.Mutex // Serializes all write operations to prevent transaction conflicts
}

// Connect opens a SQLite database with WAL mode enabled
func Connect(dbPath string) (*DB, error) {
	// Open with WAL mode and foreign keys enabled
	dsn := dbPath + "?_journal=WAL&_fk=1&_busy_timeout=5000"
	conn, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Configure connection pool
	// SQLite only supports one writer at a time. We use a combination of:
	// 1. MaxOpenConns(1) to ensure a single connection
	// 2. A write mutex (writeMu) to serialize all write operations
	// This prevents "cannot start a transaction within a transaction" errors
	// when async operations (like cleanup) run concurrently with polling.
	conn.SetMaxOpenConns(1)
	conn.SetMaxIdleConns(1)
	conn.SetConnMaxLifetime(time.Hour)

	// Test connection
	if err := conn.Ping(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	// Performance tuning PRAGMAs
	pragmas := []string{
		"PRAGMA synchronous = NORMAL",  // Faster writes, still safe with WAL
		"PRAGMA cache_size = 10000",    // ~40MB cache for faster reads
		"PRAGMA temp_store = MEMORY",   // Use RAM for temp tables
		"PRAGMA mmap_size = 268435456", // 256MB memory-mapped I/O
	}
	for _, pragma := range pragmas {
		if _, err := conn.Exec(pragma); err != nil {
			log.Printf("Warning: failed to set %s: %v", pragma, err)
		}
	}

	log.Printf("Connected to SQLite database: %s", dbPath)
	return &DB{conn: conn}, nil
}

// Close closes the database connection
func (db *DB) Close() error {
	return db.conn.Close()
}

// Conn returns the underlying database connection for use by writers
func (db *DB) Conn() *sql.DB {
	return db.conn
}

// LockWrite acquires the write mutex. Must be paired with UnlockWrite.
// Use this for any operation that modifies the database to prevent
// "cannot start a transaction within a transaction" errors.
func (db *DB) LockWrite() {
	db.writeMu.Lock()
}

// UnlockWrite releases the write mutex.
func (db *DB) UnlockWrite() {
	db.writeMu.Unlock()
}

// EnsureSchema creates tables if they don't exist.
// Uses the embedded schema.sql file as the single source of truth.
func (db *DB) EnsureSchema(ctx context.Context) error {
	db.LockWrite()
	defer db.UnlockWrite()

	_, err := db.conn.ExecContext(ctx, schemaSQL)
	if err != nil {
		return fmt.Errorf("failed to create schema: %w", err)
	}

	log.Println("Database schema ensured (from embedded schema.sql)")
	return nil
}

// GetSchemaSQL returns the embedded schema for external use (e.g., init scripts).
func GetSchemaSQL() string {
	return schemaSQL
}
