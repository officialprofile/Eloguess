import type { Analysis } from './types.ts';

export const TRAJECTORY_FEATURES = [
  'ply', 'white_to_move', 'material', 'legal_moves', 'forced', 'opening', 'endgame',
  'best_cp', 'played_cp', 'loss', 'opportunity', 'search_disagreement', 'best_move',
  'clock_remaining', 'clock_spent', 'clock_present', 'spent_present', 'time_pressure',
  'base_seconds', 'increment_seconds', 'castle_K', 'castle_Q', 'castle_k', 'castle_q', 'ep_present',
];
type Tensor = { shape: number[]; values: number[] };
export interface GruModelBundle {
  format: 'eloguess-gru-v1'; status: 'trained' | 'ready-for-integration';
  inputMode?: 'with-time' | 'moves-only';
  featureNames: string[]; featureVersion: string; engine: Analysis['engine'];
  ratingPool: 'lichess-rapid' | 'estimated-strength'; minInformativeMoves: number; minPlies: number; maxPlies: number;
  aggregation: 'arithmetic_mean';
  networks: { architecture: 'RatingGRU'; weights: Record<string, Tensor> }[];
  calibration: { method: 'july_groups'; parameters: { july_groups: Record<string, { padding: number | null }> } };
  validation: { mae: number; coverage: number; sampleCount: number };
}
export type Trajectory = { features: number[][]; actions: number[][] };
export type Quantiles = [number, number, number];
export type PairQuantiles = [Quantiles, Quantiles];
export type GruPrediction = { natural: PairQuantiles; missing: PairQuantiles };
const clip = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export function encodeTrajectory(analysis: Analysis, inputMode: 'with-time' | 'moves-only' = 'with-time'): Trajectory {
  const { base, increment } = analysis.timeControl;
  const scale = base || increment || 1;
  const square = (s: string) => s.charCodeAt(0) - 97 + 8 * (Number(s[1]) - 1);
  return {
    actions: analysis.moves.map(m => [square(m.uci.slice(0, 2)), square(m.uci.slice(2, 4)),
      m.uci.length > 4 ? ' pnbrqk'.indexOf(m.uci[4]) : 0]),
    features: analysis.moves.map(m => {
      const fen = m.before.split(' '), clock = m.clockSeconds, spent = m.elapsedSeconds;
      // Input quantization matches numpy.float32 in the training encoder.
      const features = [m.ply / 300, Number(m.color === 'w'), m.material / 78, m.legalMoves / 64,
        Number(m.forced), Number(m.phase === 'opening'), Number(m.phase === 'endgame'),
        clip(m.bestCp / 500, -4, 4), clip(m.playedCp / 500, -4, 4), m.cpLoss / 300,
        clip(m.opportunityGap / 300, 0, 4), Number(m.searchDisagreement), Number(m.uci === m.bestMove),
        clock === null ? 0 : Math.min(2, clock / scale), spent === null ? 0 : Math.min(2, spent / scale),
        Number(clock !== null), Number(spent !== null), Number(clock !== null && clock < 30),
        base / 1800, increment / 30, ...[...'KQkq'].map(r => Number(fen[2].includes(r))), Number(fen[3] !== '-'),
      ];
      if (inputMode === 'moves-only') features.fill(0, 13, 20);
      return features.map(Math.fround);
    }),
  };
}

type Weights = Record<string, Float64Array>;
const compiled = new WeakMap<GruModelBundle, Weights[]>();
function compile(model: GruModelBundle): Weights[] {
  const cached = compiled.get(model);
  if (cached) return cached;
  if (model.format !== 'eloguess-gru-v1' || model.aggregation !== 'arithmetic_mean' ||
      !Array.isArray(model.networks) || model.networks.length !== 1 ||
      JSON.stringify(model.featureNames) !== JSON.stringify(TRAJECTORY_FEATURES) ||
      model.calibration?.method !== 'july_groups' || model.minPlies !== 30 || model.maxPlies !== 300) {
    throw new Error('Unsupported GRU model format.');
  }
  const shapes: Record<string, number[]> = {
    'square_embedding.weight': [64, 8], 'promotion_embedding.weight': [7, 4],
    'input_projection.0.weight': [96, 45], 'input_projection.0.bias': [96],
    'input_projection.1.weight': [96], 'input_projection.1.bias': [96],
    'head.0.weight': [64, 256], 'head.0.bias': [64], 'head.3.weight': [3, 64], 'head.3.bias': [3],
  };
  for (const suffix of ['', '_reverse']) {
    shapes[`gru.weight_ih_l0${suffix}`] = [192, 96];
    shapes[`gru.weight_hh_l0${suffix}`] = [192, 64];
    shapes[`gru.bias_ih_l0${suffix}`] = shapes[`gru.bias_hh_l0${suffix}`] = [192];
  }
  for (let group = 0; group < 6; group++) {
    const cell = model.calibration.parameters?.july_groups?.[String(group)];
    if (!cell || (cell.padding !== null && !Number.isFinite(cell.padding))) throw new Error('Invalid model calibration.');
  }
  const values = model.networks.map(network => {
    if (network.architecture !== 'RatingGRU') throw new Error('Unsupported GRU architecture.');
    const weights: Weights = {};
    for (const [key, shape] of Object.entries(shapes)) {
      const tensor = network.weights[key];
      if (!tensor || JSON.stringify(tensor.shape) !== JSON.stringify(shape) ||
          tensor.values.length !== shape.reduce((a, b) => a * b, 1) || !tensor.values.every(Number.isFinite)) {
        throw new Error(`Invalid model weights: ${key}.`);
      }
      weights[key] = Float64Array.from(tensor.values);
    }
    if (model.inputMode === 'moves-only') {
      for (let row = 0; row < 96; row++) for (let column = 13; column < 20; column++) {
        if (weights['input_projection.0.weight'][row * 45 + column] !== 0) throw new Error('The moves-only model still contains time weights.');
      }
    }
    return weights;
  });
  compiled.set(model, values);
  return values;
}
export function validateGruModel(model: GruModelBundle): void { compile(model); }

function linear(input: ArrayLike<number>, weight: Float64Array, bias: Float64Array): Float64Array {
  const out = new Float64Array(bias.length);
  for (let row = 0; row < out.length; row++) {
    let sum = bias[row];
    const start = row * input.length;
    for (let col = 0; col < input.length; col++) sum += weight[start + col] * input[col];
    out[row] = sum;
  }
  return out;
}
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const softplus = (x: number) => Math.max(0, x) + Math.log1p(Math.exp(-Math.abs(x)));

function forward(trajectory: Trajectory, weights: Weights, missing: boolean): PairQuantiles {
  const { features, actions } = trajectory;
  const projected = features.map((row, index) => {
    const input = new Float64Array(45);
    input.set(row);
    if (missing) input.fill(0, 13, 18);
    const [from, to, promotion] = actions[index];
    input.set(weights['square_embedding.weight'].subarray(from * 8, from * 8 + 8), 25);
    input.set(weights['square_embedding.weight'].subarray(to * 8, to * 8 + 8), 33);
    input.set(weights['promotion_embedding.weight'].subarray(promotion * 4, promotion * 4 + 4), 41);
    const x = linear(input, weights['input_projection.0.weight'], weights['input_projection.0.bias']);
    const mean = x.reduce((a, b) => a + b, 0) / 96;
    const variance = x.reduce((a, b) => a + (b - mean) ** 2, 0) / 96;
    const denominator = Math.sqrt(variance + 1e-5);
    for (let j = 0; j < 96; j++) x[j] = Math.max(0, (x[j] - mean) / denominator *
      weights['input_projection.1.weight'][j] + weights['input_projection.1.bias'][j]);
    return x;
  });
  const outputs = features.map(() => new Float64Array(128));
  for (const reverse of [false, true]) {
    const suffix = reverse ? '_reverse' : '';
    let hidden = new Float64Array(64);
    for (let step = 0; step < features.length; step++) {
      const index = reverse ? features.length - step - 1 : step;
      const x = linear(projected[index], weights[`gru.weight_ih_l0${suffix}`], weights[`gru.bias_ih_l0${suffix}`]);
      const h = linear(hidden, weights[`gru.weight_hh_l0${suffix}`], weights[`gru.bias_hh_l0${suffix}`]);
      const next = new Float64Array(64);
      for (let j = 0; j < 64; j++) {
        // PyTorch GRU gates are reset, update, new; reset multiplies the hidden new gate including its bias.
        const reset = sigmoid(x[j] + h[j]);
        const update = sigmoid(x[64 + j] + h[64 + j]);
        const candidate = Math.tanh(x[128 + j] + reset * h[128 + j]);
        next[j] = (1 - update) * candidate + update * hidden[j];
      }
      outputs[index].set(next, reverse ? 64 : 0);
      hidden = next;
    }
  }
  const global = new Float64Array(128);
  for (const row of outputs) for (let j = 0; j < 128; j++) global[j] += row[j] / outputs.length;
  return [true, false].map(white => {
    const pooled = new Float64Array(256);
    let count = 0;
    for (let i = 0; i < features.length; i++) if ((features[i][1] > .5) === white) {
      count++;
      for (let j = 0; j < 128; j++) pooled[j] += outputs[i][j];
    }
    for (let j = 0; j < 128; j++) pooled[j] /= Math.max(1, count);
    pooled.set(global, 128);
    const head = linear(pooled, weights['head.0.weight'], weights['head.0.bias']).map(x => Math.max(0, x));
    const raw = linear(head, weights['head.3.weight'], weights['head.3.bias']);
    return [(raw[0] - softplus(raw[1])) * 500 + 1500, raw[0] * 500 + 1500,
      (raw[0] + softplus(raw[2])) * 500 + 1500] as Quantiles;
  }) as PairQuantiles;
}

export function predictGruTrajectory(model: GruModelBundle, trajectory: Trajectory): GruPrediction {
  const weights = compile(model)[0];
  const { features, actions } = trajectory;
  if (!features.length || features.length > model.maxPlies || actions.length !== features.length ||
      features.some(row => row.length !== 25 || !row.every(Number.isFinite)) ||
      actions.some(row => row.length !== 3 || row.some((v, i) => !Number.isInteger(v) || v < 0 || v >= (i === 2 ? 7 : 64)))) {
    throw new Error('Invalid game trajectory for the GRU model.');
  }
  const input = model.inputMode === 'moves-only' ? { actions, features: features.map(row => row.map((v, i) => i >= 13 && i < 20 ? 0 : v)) } : trajectory;
  return { natural: forward(input, weights, false), missing: forward(input, weights, true) };
}

export function calibrateGru(model: GruModelBundle, raw: GruPrediction): GruPrediction {
  const median = raw.missing.map(p => p[1]);
  const mean = (median[0] + median[1]) / 2;
  const group = 2 * (mean < 1300 ? 0 : mean < 1700 ? 1 : 2) + Number(Math.abs(median[0] - median[1]) > 150);
  const padding = model.calibration.parameters.july_groups[String(group)].padding;
  const adjust = (pair: PairQuantiles) => pair.map(p => [padding === null ? 400 : clip(p[0] - padding, 400, 3500),
    p[1], padding === null ? 3500 : clip(p[2] + padding, 400, 3500)] as Quantiles) as PairQuantiles;
  return { natural: adjust(raw.natural), missing: adjust(raw.missing) };
}
