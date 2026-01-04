#!/bin/sh
set -e

DB_PATH="${SQLITE_DATABASE:-/data/transit.db}"
GTFS_DIR="${GTFS_DIR:-/data/gtfs}"
GTFS_DOWNLOAD_DIR="${GTFS_DOWNLOAD_DIR:-/data/gtfs_download}"
RODALIES_GTFS_URL="${RODALIES_GTFS_URL:-https://ssl.renfe.com/ftransit/Fichero_CER_FOMENTO/fomento_transit.zip}"

echo "Checking database initialization..."

# Check if pre_schedule_positions table has data (indicates full init was done)
if sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM pre_schedule_positions LIMIT 1;" 2>/dev/null | grep -q "^[1-9]"; then
    echo "Database already initialized with pre-calculated positions"
    exit 0
fi

echo "Database needs initialization..."

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
./import-gtfs -db "$DB_PATH" -gtfs-dir "$GTFS_DIR"

# Then import the downloaded Rodalies GTFS
./import-gtfs -db "$DB_PATH" -gtfs-dir "$GTFS_DOWNLOAD_DIR"

# Pre-calculate positions for schedule-based networks (FGC, TRAM, Bus)
# Note: Rodalies uses real-time GTFS-RT, so no pre-calculation needed
echo "Step 2/2: Pre-calculating schedule positions..."
./precalc-positions -db "$DB_PATH"

# Cleanup downloaded files
rm -rf "$GTFS_DOWNLOAD_DIR"

echo "Database initialization complete!"
