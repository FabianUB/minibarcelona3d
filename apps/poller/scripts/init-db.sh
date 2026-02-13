#!/bin/sh
set -e

DB_PATH="${SQLITE_DATABASE:-/data/transit.db}"
GTFS_DIR="${GTFS_DIR:-/data/gtfs}"
GTFS_DOWNLOAD_DIR="${GTFS_DOWNLOAD_DIR:-/data/gtfs_download}"
RODALIES_GTFS_URL="${RODALIES_GTFS_URL:-https://ssl.renfe.com/ftransit/Fichero_CER_FOMENTO/fomento_transit.zip}"
TMB_DATA_DIR="${WEB_PUBLIC_DIR:-/app/web_public}/tmb_data"
SCHEMA_FILE="/app/schema.sql"

echo "Checking database initialization..."

# Always ensure schema exists (idempotent - CREATE TABLE IF NOT EXISTS)
# This is critical because the API needs the tables to exist for health checks
if [ -f "$SCHEMA_FILE" ]; then
    echo "Ensuring database schema exists..."
    sqlite3 "$DB_PATH" < "$SCHEMA_FILE"
    echo "Schema applied successfully"
else
    echo "Warning: schema.sql not found at $SCHEMA_FILE"
fi

# Check if GTFS data has been imported (dim_trips table has data)
GTFS_IMPORTED=false
if sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM dim_trips LIMIT 1;" 2>/dev/null | grep -q "^[1-9]"; then
    echo "GTFS data already imported, skipping import step"
    GTFS_IMPORTED=true
fi

if [ "$GTFS_IMPORTED" = false ]; then
    echo "Importing GTFS data..."

    # Create download directory (writable)
    mkdir -p "$GTFS_DOWNLOAD_DIR"

    # Download Rodalies GTFS (not included in mounted gtfs folder)
    RODALIES_GTFS="$GTFS_DOWNLOAD_DIR/fomento_transit.zip"
    echo "Downloading Rodalies GTFS from Renfe..."
    wget -q -O "$RODALIES_GTFS" "$RODALIES_GTFS_URL" || {
        echo "ERROR: Failed to download Rodalies GTFS"
        exit 1
    }
    echo "Downloaded: $RODALIES_GTFS"

    # Import GTFS data from both directories
    echo "Step 1/2: Importing GTFS data..."

    # First import the mounted GTFS files (FGC, TRAM, Bus)
    GEOJSON_FLAG=""
    if [ -d "$TMB_DATA_DIR" ]; then
        # Generate tram/fgc line geometry + stations GeoJSON and update the manifest
        GEOJSON_FLAG="-geojson-dir $TMB_DATA_DIR"
    fi
    ./import-gtfs -db "$DB_PATH" -gtfs-dir "$GTFS_DIR" $GEOJSON_FLAG

    # Then import the downloaded Rodalies GTFS
    ./import-gtfs -db "$DB_PATH" -gtfs-dir "$GTFS_DOWNLOAD_DIR"

    # Cleanup downloaded files
    rm -rf "$GTFS_DOWNLOAD_DIR"
fi

# Always re-run precalc to ensure latest algorithm is applied
# This clears and regenerates pre_schedule_positions table
echo "Pre-calculating schedule positions (always runs to apply latest algorithm)..."
./precalc-positions -db "$DB_PATH"

echo "Database initialization complete!"
