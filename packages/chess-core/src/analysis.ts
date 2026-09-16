import { parseGame } from './pgn.ts';
import { FEATURE_VERSION, type Analysis, type Engine, type MoveAnalysis, type PlayerAnalysis, type SearchLine } from './types.ts';

const mean = (xs: number[]) => xs.length ? xs.reduce((a,b) => a+b, 0) / xs.length : 0;
const quantile = (xs: number[], q: number) => { const s = [...xs].sort((a,b) => a-b); if (!s.length) return 0; const i=(s.length-1)*q; return s[Math.floor(i)] + (s[Math.ceil(i)]-s[Math.floor(i)])*(i%1); };
const score = (line: SearchLine) => line.cp ?? (line.mate! > 0 ? 10000 : -10000);

export function summarize(moves: MoveAnalysis[], base: number, increment: number): PlayerAnalysis {
  const clockScale = base || increment || 1;
  const informative = moves.filter(m => !m.forced && m.phase !== 'opening');
  const losses = informative.map(m => m.cpLoss);
  const clocks = moves.filter(m => m.clockSeconds !== null);
  const elapsed = moves.filter(m => m.elapsedSeconds !== null);
  return {
    analyzedMoves: moves.length, informativeMoves: informative.length,
    features: {
      base_seconds: base, increment_seconds: increment,
      move_count: moves.length, informative_count: informative.length,
      forced_fraction: mean(moves.map(m => Number(m.forced))),
      mean_loss: mean(losses), median_loss: quantile(losses, 0.5), p90_loss: quantile(losses, 0.9),
      blunder_fraction: mean(losses.map(x => Number(x >= 200))),
      mistake_fraction: mean(losses.map(x => Number(x >= 100))),
      best_fraction: mean(informative.map(m => Number(m.uci === m.bestMove))),
      mean_opportunity_gap: mean(informative.map(m => m.opportunityGap)),
      mean_legal_moves: mean(informative.map(m => m.legalMoves)),
      middlegame_loss: mean(informative.filter(m => m.phase === 'middlegame').map(m => m.cpLoss)),
      endgame_loss: mean(informative.filter(m => m.phase === 'endgame').map(m => m.cpLoss)),
      endgame_count: informative.filter(m => m.phase === 'endgame').length,
      clock_coverage: moves.length ? clocks.length / moves.length : 0,
      mean_clock_fraction: mean(clocks.map(m => Math.min(2, m.clockSeconds! / clockScale))),
      mean_spent_fraction: mean(elapsed.map(m => m.elapsedSeconds! / clockScale)),
      time_pressure_fraction: mean(clocks.map(m => Number(m.clockSeconds! < 30))),
      time_pressure_loss: mean(informative.filter(m => m.clockSeconds !== null && m.clockSeconds < 30).map(m => m.cpLoss)),
      search_disagreement_fraction: mean(informative.map(m => Number(m.searchDisagreement))),
    },
  };
}

export async function analyzeGame(pgn: string, engine: Engine, options: {
  timeControl?: string; ignoreTime?: boolean; onProgress?: (done: number, total: number) => void;
} = {}): Promise<Analysis> {
  const game = parseGame(pgn, options.timeControl, { ignoreTime: options.ignoreTime });
  const result: MoveAnalysis[] = [];
  const played: string[] = [];
  for (const move of game.moves) {
    const position = `fen ${game.initialFen}${played.length ? ` moves ${played.join(' ')}` : ''}`;
    let bestMove = move.uci, bestCp = 0, playedCp = 0, opportunityGap = 0;
    if (move.legalMoves > 1) {
      const search = await engine.search(position);
      if (!search.lines.length) throw new Error(`The engine returned no evaluation for move ${move.ply}.`);
      bestMove = search.bestMove;
      bestCp = score(search.lines[0]);
      const playedLine = search.lines.find(line => line.pv[0] === move.uci);
      if (playedLine) playedCp = score(playedLine);
      else {
        const restricted = await engine.search(position, [move.uci]);
        if (!restricted.lines[0]) throw new Error(`The engine returned no evaluation for the played move ${move.ply}.`);
        playedCp = score(restricted.lines[0]);
      }
      if (search.lines[1]) opportunityGap = Math.min(1000, Math.max(0, bestCp-score(search.lines[1])));
    }
    result.push({ ...move, bestMove, bestCp, playedCp, cpLoss: Math.min(1000, Math.max(0, bestCp-playedCp)), opportunityGap, forced: move.legalMoves === 1,
      phase: move.material <= 26 ? 'endgame' : Number(move.before.split(' ')[5]) <= 8 ? 'opening' : 'middlegame', searchDisagreement: playedCp > bestCp + 25 });
    played.push(move.uci);
    options.onProgress?.(result.length, game.moves.length);
  }
  return { schemaVersion: '1', featureVersion: FEATURE_VERSION, engine: engine.config, timeControl: game.timeControl, initialFen: game.initialFen, moves: result,
    white: summarize(result.filter(m => m.color === 'w'), game.timeControl.base, game.timeControl.increment),
    black: summarize(result.filter(m => m.color === 'b'), game.timeControl.base, game.timeControl.increment),
  };
}
