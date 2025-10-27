/**
 * Unit tests for train model loader
 *
 * Tests GLB model loading, caching, and error handling.
 * Note: These tests use mocks since GLTFLoader requires a browser environment.
 */

import { describe, expect, test, vi, beforeEach } from 'vitest';

// Mock the GLTFLoader
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => {
  return {
    GLTFLoader: vi.fn().mockImplementation(() => ({
      load: vi.fn((path, onLoad, onProgress, onError) => {
        // Simulate successful load after a short delay
        setTimeout(() => {
          const mockGLTF = {
            scene: { type: 'Scene', children: [] },
            scenes: [],
            animations: [],
            cameras: [],
            asset: {},
            parser: {},
            userData: {},
          };
          onLoad(mockGLTF);
        }, 10);
      }),
    })),
  };
});

describe('modelLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('exports expected functions', async () => {
    const {
      loadTrainModel,
      preloadAllTrainModels,
      getCachedModel,
      isModelLoading,
      areAllModelsLoaded,
      clearModelCache,
    } = await import('../modelLoader');

    expect(typeof loadTrainModel).toBe('function');
    expect(typeof preloadAllTrainModels).toBe('function');
    expect(typeof getCachedModel).toBe('function');
    expect(typeof isModelLoading).toBe('function');
    expect(typeof areAllModelsLoaded).toBe('function');
    expect(typeof clearModelCache).toBe('function');
  });

  test('loadTrainModel accepts valid model types', async () => {
    const { loadTrainModel } = await import('../modelLoader');

    // These should not throw
    const validTypes = ['447', '470', 'civia'] as const;

    for (const type of validTypes) {
      await expect(loadTrainModel(type)).resolves.toBeDefined();
    }
  });

  test('preloadAllTrainModels loads all three models', async () => {
    const { preloadAllTrainModels, clearModelCache } = await import('../modelLoader');

    clearModelCache();

    await expect(preloadAllTrainModels()).resolves.toBeUndefined();
  });

  test('areAllModelsLoaded returns true after preload', async () => {
    const { preloadAllTrainModels, areAllModelsLoaded, clearModelCache } = await import(
      '../modelLoader'
    );

    clearModelCache();

    expect(areAllModelsLoaded()).toBe(false);

    await preloadAllTrainModels();

    expect(areAllModelsLoaded()).toBe(true);
  });

  test('getCachedModel returns undefined before loading', async () => {
    const { getCachedModel, clearModelCache } = await import('../modelLoader');

    clearModelCache();

    expect(getCachedModel('447')).toBeUndefined();
    expect(getCachedModel('470')).toBeUndefined();
    expect(getCachedModel('civia')).toBeUndefined();
  });

  test('getCachedModel returns model after loading', async () => {
    const { loadTrainModel, getCachedModel, clearModelCache } = await import('../modelLoader');

    clearModelCache();

    await loadTrainModel('447');

    const cached = getCachedModel('447');
    expect(cached).toBeDefined();
    expect(cached?.scene).toBeDefined();
  });

  test('clearModelCache clears all cached models', async () => {
    const { preloadAllTrainModels, areAllModelsLoaded, clearModelCache } = await import(
      '../modelLoader'
    );

    await preloadAllTrainModels();
    expect(areAllModelsLoaded()).toBe(true);

    clearModelCache();
    expect(areAllModelsLoaded()).toBe(false);
  });
});
