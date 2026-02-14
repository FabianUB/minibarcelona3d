package static

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestIsStaleOrMissing_MissingFile(t *testing.T) {
	// A non-existent manifest should trigger refresh
	result := isStaleOrMissing("/tmp/does-not-exist-manifest.json", 7)
	if !result {
		t.Error("isStaleOrMissing should return true for missing file")
	}
}

func TestIsStaleOrMissing_FreshManifest(t *testing.T) {
	dir := t.TempDir()
	manifestPath := filepath.Join(dir, "manifest.json")

	manifest := Manifest{
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	data, _ := json.Marshal(manifest)
	os.WriteFile(manifestPath, data, 0644)

	result := isStaleOrMissing(manifestPath, 7)
	if result {
		t.Error("isStaleOrMissing should return false for fresh manifest")
	}
}

func TestIsStaleOrMissing_StaleManifest(t *testing.T) {
	dir := t.TempDir()
	manifestPath := filepath.Join(dir, "manifest.json")

	// 10 days old
	manifest := Manifest{
		UpdatedAt: time.Now().Add(-10 * 24 * time.Hour).UTC().Format(time.RFC3339),
	}
	data, _ := json.Marshal(manifest)
	os.WriteFile(manifestPath, data, 0644)

	result := isStaleOrMissing(manifestPath, 7)
	if !result {
		t.Error("isStaleOrMissing should return true for stale manifest")
	}
}

func TestIsStaleOrMissing_CorruptJSON(t *testing.T) {
	dir := t.TempDir()
	manifestPath := filepath.Join(dir, "manifest.json")

	os.WriteFile(manifestPath, []byte("{invalid json"), 0644)

	result := isStaleOrMissing(manifestPath, 7)
	if !result {
		t.Error("isStaleOrMissing should return true for corrupt manifest")
	}
}

func TestIsStaleOrMissing_LegacyGeneratedAt(t *testing.T) {
	dir := t.TempDir()
	manifestPath := filepath.Join(dir, "manifest.json")

	// Legacy manifest with generated_at instead of updated_at
	manifest := Manifest{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
	}
	data, _ := json.Marshal(manifest)
	os.WriteFile(manifestPath, data, 0644)

	result := isStaleOrMissing(manifestPath, 7)
	if result {
		t.Error("isStaleOrMissing should handle legacy generated_at field")
	}
}

func TestGetStoredGeneratorVersion(t *testing.T) {
	dir := t.TempDir()
	manifestPath := filepath.Join(dir, "manifest.json")

	// No file → empty string
	if v := getStoredGeneratorVersion("/tmp/nope.json"); v != "" {
		t.Errorf("expected empty string for missing file, got %q", v)
	}

	// Manifest without generator_version → empty string
	data, _ := json.Marshal(map[string]interface{}{"updated_at": "2025-01-01T00:00:00Z"})
	os.WriteFile(manifestPath, data, 0644)
	if v := getStoredGeneratorVersion(manifestPath); v != "" {
		t.Errorf("expected empty string for manifest without version, got %q", v)
	}

	// Manifest with generator_version
	data, _ = json.Marshal(map[string]interface{}{
		"updated_at":        "2025-01-01T00:00:00Z",
		"generator_version": "2",
	})
	os.WriteFile(manifestPath, data, 0644)
	if v := getStoredGeneratorVersion(manifestPath); v != "2" {
		t.Errorf("expected %q, got %q", "2", v)
	}
}
