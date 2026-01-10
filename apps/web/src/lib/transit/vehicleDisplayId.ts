/**
 * Vehicle Display ID Utilities
 *
 * Converts verbose vehicle keys into user-friendly display IDs.
 *
 * Vehicle keys are designed for uniqueness and internal tracking, but can be
 * verbose (e.g., "tram-101-1001_TRAM_T1_20240701_12_34").
 *
 * Display IDs are short and user-friendly (e.g., "T1 #4").
 */

/**
 * Format a vehicle key into a short display ID
 *
 * @param vehicleKey - The full vehicle key (e.g., "metro-L1-0-3" or "tram-101-trip_123")
 * @param lineCode - The line/route code (e.g., "L1", "T1", "H6")
 * @param index - Optional vehicle index within the line (extracted from key if not provided)
 * @returns A short display ID (e.g., "L1 #4")
 *
 * @example
 * formatVehicleDisplayId("metro-L1-0-3", "L1") // "L1 #4"
 * formatVehicleDisplayId("bus-H6-0-12", "H6") // "H6 #13"
 * formatVehicleDisplayId("tram-101-trip_abc", "T1") // "T1 #1"
 */
export function formatVehicleDisplayId(
  vehicleKey: string,
  lineCode: string,
  index?: number
): string {
  // If index is provided, use it directly
  if (typeof index === 'number') {
    return `${lineCode} #${index + 1}`;
  }

  // Try to extract index from the vehicle key
  // Format: "network-line-direction-index" (e.g., "metro-L1-0-3")
  const parts = vehicleKey.split('-');

  // Check if last part is a number (simulation format)
  const lastPart = parts[parts.length - 1];
  const extractedIndex = parseInt(lastPart, 10);

  if (!isNaN(extractedIndex) && extractedIndex >= 0) {
    return `${lineCode} #${extractedIndex + 1}`;
  }

  // For API-based keys with trip IDs, generate a stable hash-based number
  // This ensures the same trip always gets the same display number
  const hash = simpleHash(vehicleKey);
  const displayNum = (hash % 100) + 1; // 1-100 range

  return `${lineCode} #${displayNum}`;
}

/**
 * Simple hash function for generating stable numbers from strings
 */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Format a Rodalies vehicle key for display
 *
 * Rodalies keys are already short (e.g., "447-001") so we keep them as-is.
 *
 * @param vehicleKey - The Rodalies vehicle key
 * @returns The display ID (same as input for Rodalies)
 */
export function formatRodaliesDisplayId(vehicleKey: string): string {
  return vehicleKey;
}
