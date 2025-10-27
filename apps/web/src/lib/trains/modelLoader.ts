/**
 * Train model loader utility
 *
 * Handles loading and caching 3D train models (GLB format) using Three.js GLTFLoader.
 * Provides efficient model loading with caching to prevent duplicate network requests.
 *
 * Related task: T045
 */

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { TRAIN_MODELS, type TrainModelType } from '../../config/trainModels';

/**
 * Cache for loaded models
 * Prevents duplicate loading of the same model
 */
const modelCache = new Map<string, GLTF>();

/**
 * In-flight loading promises
 * Prevents duplicate simultaneous loads of the same model
 */
const loadingPromises = new Map<string, Promise<GLTF>>();

/**
 * Shared GLTFLoader instance
 * Reuse across all model loads for efficiency
 */
let gltfLoader: GLTFLoader | null = null;

/**
 * Get or create the shared GLTFLoader instance
 */
function getLoader(): GLTFLoader {
  if (!gltfLoader) {
    gltfLoader = new GLTFLoader();
  }
  return gltfLoader;
}

/**
 * Load a train model by type
 *
 * Uses caching to prevent duplicate loads. If a model is already loading,
 * returns the existing promise. If already loaded, returns cached result.
 *
 * @param modelType - Type of train model to load ('447', '470', or 'civia')
 * @returns Promise that resolves to the loaded GLTF model
 * @throws Error if model fails to load
 *
 * Task: T045
 *
 * Example usage:
 * ```typescript
 * const gltf = await loadTrainModel('civia');
 * const trainMesh = gltf.scene.clone();
 * scene.add(trainMesh);
 * ```
 */
export async function loadTrainModel(modelType: TrainModelType): Promise<GLTF> {
  const config = TRAIN_MODELS[modelType];

  if (!config) {
    throw new Error(`Unknown train model type: ${modelType}`);
  }

  const { modelPath } = config;

  // Return cached model if available
  const cached = modelCache.get(modelPath);
  if (cached) {
    return cached;
  }

  // Return existing loading promise if already in progress
  const loading = loadingPromises.get(modelPath);
  if (loading) {
    return loading;
  }

  // Start new load
  const loader = getLoader();
  const loadPromise = new Promise<GLTF>((resolve, reject) => {
    loader.load(
      modelPath,
      (gltf) => {
        // Cache the loaded model
        modelCache.set(modelPath, gltf);
        loadingPromises.delete(modelPath);
        console.log(`Model loaded successfully: ${modelPath}`);
        resolve(gltf);
      },
      (progress) => {
        // Optional: Log loading progress
        if (progress.total > 0) {
          const percent = Math.round((progress.loaded / progress.total) * 100);
          if (percent % 25 === 0) {
            // Log at 25% intervals to avoid spam
            console.log(`Loading ${modelType}: ${percent}%`);
          }
        }
      },
      (error) => {
        loadingPromises.delete(modelPath);
        console.error(`Failed to load model: ${modelPath}`, error);
        reject(new Error(`Failed to load train model: ${modelType}`));
      }
    );
  });

  loadingPromises.set(modelPath, loadPromise);
  return loadPromise;
}

/**
 * Preload all train models
 *
 * Loads all three train models in parallel to prepare for rendering.
 * Call this during app initialization to avoid loading delays later.
 *
 * @returns Promise that resolves when all models are loaded
 * @throws Error if any model fails to load
 *
 * Task: T045
 *
 * Example usage:
 * ```typescript
 * // During TrainLayer3D initialization
 * await preloadAllTrainModels();
 * console.log('All train models ready!');
 * ```
 */
export async function preloadAllTrainModels(): Promise<void> {
  const modelTypes: TrainModelType[] = ['447', '470', 'civia'];

  console.log('Preloading train models...');

  try {
    // Load all models in parallel
    await Promise.all(modelTypes.map((type) => loadTrainModel(type)));

    console.log('All train models preloaded successfully');
  } catch (error) {
    console.error('Failed to preload train models:', error);
    throw error;
  }
}

/**
 * Get a cached model if available
 *
 * Returns the cached model immediately without loading.
 * Useful for checking if a model is ready without triggering a load.
 *
 * @param modelType - Type of train model
 * @returns Cached GLTF model or undefined if not loaded
 */
export function getCachedModel(modelType: TrainModelType): GLTF | undefined {
  const config = TRAIN_MODELS[modelType];
  if (!config) {
    return undefined;
  }
  return modelCache.get(config.modelPath);
}

/**
 * Check if a model is currently loading
 *
 * @param modelType - Type of train model
 * @returns True if model is currently being loaded
 */
export function isModelLoading(modelType: TrainModelType): boolean {
  const config = TRAIN_MODELS[modelType];
  if (!config) {
    return false;
  }
  return loadingPromises.has(config.modelPath);
}

/**
 * Check if all models are loaded and cached
 *
 * @returns True if all three train models are loaded
 */
export function areAllModelsLoaded(): boolean {
  const modelTypes: TrainModelType[] = ['447', '470', 'civia'];
  return modelTypes.every((type) => getCachedModel(type) !== undefined);
}

/**
 * Clear the model cache
 *
 * Useful for memory management or forcing model reload.
 * Note: This does not dispose of Three.js geometries/materials.
 */
export function clearModelCache(): void {
  modelCache.clear();
  loadingPromises.clear();
  console.log('Model cache cleared');
}
