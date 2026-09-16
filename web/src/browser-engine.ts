import { UciEngine, type Transport } from '../../packages/chess-core/src/uci.ts';
import type { EngineConfig } from '../../packages/chess-core/src/types.ts';

export function browserEngine(config: Partial<EngineConfig> = {}) {
  const worker = new Worker(`${import.meta.env.BASE_URL}engine/stockfish-18-lite-single.js`);
  const lines = new Set<(line: string) => void>();
  const errors = new Set<(error: Error) => void>();
  worker.onmessage = event => String(event.data).split('\n').forEach(line => lines.forEach(fn => fn(line.trim())));
  worker.onerror = event => errors.forEach(fn => fn(new Error(event.message || 'Could not start the engine.')));
  const transport: Transport = {
    send: command => worker.postMessage(command),
    onLine: fn => { lines.add(fn); return () => lines.delete(fn); },
    onError: fn => { errors.add(fn); return () => errors.delete(fn); },
    dispose: () => { errors.forEach(fn => fn(new Error('Analysis cancelled.'))); worker.terminate(); },
  };
  return new UciEngine(transport, config);
}
