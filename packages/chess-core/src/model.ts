import type { Analysis } from './types.ts';
import { DEFAULT_POSITION } from 'chess.js';
import { calibrateGru, encodeTrajectory, predictGruTrajectory, validateGruModel, type GruModelBundle } from './gru-model.ts';

export interface TreeModel {
  features_info: { float_features: { feature_index: number; flat_feature_index: number }[] };
  oblivious_trees: { splits: { split_type: string; float_feature_index: number; border: number }[] | null; leaf_values: number[] }[];
  scale_and_bias: [number, number[]];
}
export interface TreeModelBundle {
  status: 'trained'; featureNames: string[]; featureVersion: string;
  engine: Analysis['engine']; ratingPool: 'lichess-rapid';
  minInformativeMoves: number;
  quantiles: { lower: TreeModel; median: TreeModel; upper: TreeModel };
  calibrationPadding: number;
  validation: { mae: number; coverage: number; sampleCount: number };
}
export type ModelBundle = TreeModelBundle | GruModelBundle;
export type Rating = { median: number; lower: number; upper: number };
export function isGruModel(model: ModelBundle): model is GruModelBundle {
  return 'format' in model && model.format === 'eloguess-gru-v1';
}
export function validateModelBundle(model: ModelBundle): void {
  if (model.status !== 'trained' || !Number.isFinite(model.validation?.mae)) {
    throw new Error('Invalid rating model.');
  }
  if (isGruModel(model)) {
    if (model.inputMode !== 'moves-only' || model.ratingPool !== 'estimated-strength') throw new Error('The application requires a moves-only model.');
    validateGruModel(model);
  } else if (!model.quantiles?.median) throw new Error('Unsupported rating model.');
}
export function predictTree(model: TreeModel, values: number[]): number {
  let sum = 0;
  for (const tree of model.oblivious_trees) {
    let leaf = 0;
    (tree.splits || []).forEach((split, index) => {
      if (split.split_type !== 'FloatFeature') throw new Error('The model contains an unsupported feature type.');
      const feature = model.features_info.float_features.find(f => f.feature_index === split.float_feature_index);
      if (!feature || !Number.isFinite(values[feature.flat_feature_index])) throw new Error('A required model feature is missing.');
      // CatBoost quantizes numerical inputs as float32 before testing borders.
      if (Math.fround(values[feature.flat_feature_index]) > split.border) leaf += 2 ** index;
    });
    if (tree.leaf_values[leaf] === undefined) throw new Error('Invalid tree model.');
    sum += tree.leaf_values[leaf];
  }
  return sum * model.scale_and_bias[0] + model.scale_and_bias[1][0];
}
function checkAnalysis(analysis: Analysis, model: ModelBundle) {
  if (!isGruModel(model) && analysis.timeControl.category !== 'rapid') throw new Error('This legacy model requires its original rating pool.');
  if (analysis.initialFen !== DEFAULT_POSITION) throw new Error('Rating estimates require a game from the starting position. Move analysis is still available.');
  if (analysis.featureVersion !== model.featureVersion || (['version', 'nodes', 'hashMb', 'multiPv'] as const).some(key => analysis.engine[key] !== model.engine[key])) throw new Error('The model requires a different analysis configuration.');
}
export function predictRatings(analysis: Analysis, model: ModelBundle): Record<'white' | 'black', Rating> {
  checkAnalysis(analysis, model);
  if (!isGruModel(model)) return { white: predictRating(analysis, 'white', model), black: predictRating(analysis, 'black', model) };
  if (Math.min(analysis.white.informativeMoves, analysis.black.informativeMoves) < model.minInformativeMoves) {
    throw new Error('Not enough meaningful decisions to estimate a rating.');
  }
  if (analysis.moves.length < model.minPlies || analysis.moves.length > model.maxPlies) {
    throw new Error('Rating estimates support games from 15 to 150 full moves.');
  }
  const p = calibrateGru(model, predictGruTrajectory(model, encodeTrajectory(analysis, model.inputMode))).natural;
  return { white: { lower: p[0][0], median: p[0][1], upper: p[0][2] },
    black: { lower: p[1][0], median: p[1][1], upper: p[1][2] } };
}
export function predictRating(analysis: Analysis, color: 'white' | 'black', model: ModelBundle): Rating {
  if (isGruModel(model)) return predictRatings(analysis, model)[color];
  checkAnalysis(analysis, model);
  if (analysis[color].informativeMoves < model.minInformativeMoves) throw new Error('Not enough meaningful decisions to estimate a rating.');
  const values = model.featureNames.map(name => analysis[color].features[name]);
  const median = predictTree(model.quantiles.median, values);
  const lower = Math.min(median, predictTree(model.quantiles.lower, values)) - model.calibrationPadding;
  const upper = Math.max(median, predictTree(model.quantiles.upper, values)) + model.calibrationPadding;
  return { median, lower, upper };
}
