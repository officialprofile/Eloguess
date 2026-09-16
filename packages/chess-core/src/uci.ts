import { ENGINE_CONFIG, type Engine, type EngineConfig, type SearchLine, type SearchResult } from './types.ts';

export interface Transport {
  send(command: string): void;
  onLine(callback: (line: string) => void): () => void;
  onError(callback: (error: Error) => void): () => void;
  dispose(): void;
}

export class UciEngine implements Engine {
  readonly config: EngineConfig;
  private disposed = false;
  constructor(private transport: Transport, config: Partial<EngineConfig> = {}) {
    this.config = { ...ENGINE_CONFIG, ...config };
    if (!Number.isInteger(this.config.nodes) || this.config.nodes < 100 || this.config.nodes > 1000000) throw new Error('The node limit must be between 100 and 1,000,000.');
  }
  private commandUntil<T>(commands: string[], consume: (line: string) => T | undefined): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Analysis cancelled.'));
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); offLine(); offError(); };
      const offLine = this.transport.onLine(line => {
        const result = consume(line);
        if (result !== undefined) { cleanup(); resolve(result); }
      });
      const offError = this.transport.onError(error => { cleanup(); reject(error); });
      const timer = setTimeout(() => { cleanup(); this.dispose(); reject(new Error('The engine did not respond within 120 seconds.')); }, 120000);
      try { commands.forEach(command => this.transport.send(command)); }
      catch (error) { cleanup(); reject(error); }
    });
  }
  async initialize() {
    await this.commandUntil(['uci'], line => line === 'uciok' ? true : undefined);
    await this.commandUntil([
      'setoption name Threads value 1',
      `setoption name Hash value ${this.config.hashMb}`,
      'setoption name UCI_AnalyseMode value true', 'isready',
    ], line => line === 'readyok' ? true : undefined);
    return this;
  }
  async search(position: string, moves?: string[]): Promise<SearchResult> {
    // Reset hash and engine search history for every search in both runtimes.
    await this.commandUntil(['ucinewgame', 'isready'], line => line === 'readyok' ? true : undefined);
    const lines = new Map<number, SearchLine>();
    return this.commandUntil([
      `setoption name MultiPV value ${moves ? 1 : this.config.multiPv}`,
      `position ${position}`,
      `go nodes ${this.config.nodes}${moves ? ` searchmoves ${moves.join(' ')}` : ''}`,
    ], line => {
      if (line.startsWith('info ') && !/\b(?:upperbound|lowerbound)\b/.test(line)) {
        const score = /\bscore (cp|mate) (-?\d+)/.exec(line);
        const pv = /\bpv (.+)$/.exec(line);
        if (score && pv) lines.set(Number(/\bmultipv (\d+)/.exec(line)?.[1] || 1), {
          cp: score[1] === 'cp' ? Number(score[2]) : null,
          mate: score[1] === 'mate' ? Number(score[2]) : null,
          depth: Number(/\bdepth (\d+)/.exec(line)?.[1] || 0), pv: pv[1].trim().split(/\s+/),
        });
      }
      if (line.startsWith('bestmove ')) return { bestMove: line.split(' ')[1], lines: [...lines].sort((a,b) => a[0]-b[0]).map(x => x[1]) };
    });
  }
  dispose() { if (!this.disposed) { this.disposed = true; this.transport.dispose(); } }
}
