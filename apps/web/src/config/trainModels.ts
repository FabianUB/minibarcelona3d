/**
 * Train model mapping configuration
 * Maps Rodalies lines to 3D train models based on rolling stock composition
 *
 * Source: Rodalies de Catalunya fleet information
 * Models: 447.glb, 470.glb, Civia (Rodalies).glb
 */

export type TrainModelType = '447' | '470' | 'civia';

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
};

/**
 * Line-to-model mapping based on rolling stock composition
 *
 * Lines with 100% 447: R3, R4, R7
 * Lines with mixed stock (447 + Civia): R1, R2, R8, R11 → use Civia
 * Regional lines with 470: R13, R14, R15, R16, R17, RG1, RT1, RT2
 */
const LINE_TO_MODEL_MAP: Record<string, TrainModelType> = {
  // 100% Series 447
  'R3': '447',
  'R4': '447',
  'R7': '447',

  // Mixed 447 + Civia (use Civia for these lines)
  'R1': 'civia',
  'R2': 'civia',
  'R2N': 'civia',  // R2 Nord
  'R2S': 'civia',  // R2 Sud
  'R8': 'civia',
  'R11': 'civia',

  // Regional lines (448/470 series - use 470 model)
  'R13': '470',
  'R14': '470',
  'R15': '470',
  'R16': '470',
  'R17': '470',
  'RG1': '470',
  'RT1': '470',
  'RT2': '470',
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
export function getModelTypeForRoute(routeId: string | null): TrainModelType {
  const line = extractLineFromRouteId(routeId);

  if (!line) {
    // Default to Civia if we can't determine the line
    return 'civia';
  }

  // Look up the model for this line
  const modelType = LINE_TO_MODEL_MAP[line];

  // Default to Civia if line not in mapping
  return modelType || 'civia';
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
