/**
 * Train model mapping configuration
 * Maps Rodalies lines to 3D train models based on rolling stock composition
 *
 * Source: Rodalies de Catalunya fleet information
 * Models: 447.glb, 470.glb, Civia (Rodalies).glb, Metro.glb, Bus.glb, TRAM.glb
 */

export type TrainModelType = '447' | '470' | 'civia' | 'metro' | 'bus' | 'tram';

export interface TrainModelConfig {
  modelPath: string;
  description: string;
}

/**
 * Available 3D train models
 */
export const TRAIN_MODELS: Record<TrainModelType, TrainModelConfig> = {
  '447': {
    modelPath: '/models/447.glb',
    description: 'Series 447 (Cercanías)',
  },
  '470': {
    modelPath: '/models/470.glb',
    description: 'Series 470 (Media Distancia/Regional)',
  },
  'civia': {
    modelPath: '/models/Civia_Rodalies.glb',
    description: 'Civia Series (463/464/465, 450/451)',
  },
  'metro': {
    modelPath: '/models/Metro.glb',
    description: 'Barcelona Metro (TMB)',
  },
  'bus': {
    modelPath: '/models/Bus.glb',
    description: 'Barcelona Bus (TMB)',
  },
  'tram': {
    modelPath: '/models/TRAM.glb',
    description: 'Barcelona Tram (Trambaix/Trambesòs)',
  },
};

/**
 * Extract line identifier from route ID
 * Route IDs follow pattern: "51T0093R11" where R11 is the line
 *
 * @param routeId - Full route ID from GTFS data (can be null for trains without assigned routes)
 * @returns Line identifier (e.g., "R11", "R2N", "RT1") or null if not found
 */
export function extractLineFromRouteId(routeId: string | null): string | null {
  if (!routeId) return null;
  // Match patterns like R1, R2N, R11, RT1, RG1, etc.
  const match = routeId.match(/R[GTLN]?\d+[NS]?/);
  return match ? match[0] : null;
}

/**
 * Get the appropriate 3D model for a train based on its route
 *
 * @param routeId - Route ID from train data (e.g., "51T0093R11"), can be null
 * @returns Model type identifier
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getModelTypeForRoute(_routeId: string | null): TrainModelType {
  // Use Civia for all Rodalies trains for visual consistency
  return 'civia';
}

/**
 * Get the full model path for a train
 *
 * @param routeId - Route ID from train data, can be null
 * @returns Full path to the GLB model file
 */
export function getModelPathForRoute(routeId: string | null): string {
  const modelType = getModelTypeForRoute(routeId);
  return TRAIN_MODELS[modelType].modelPath;
}
