import { Chess } from 'chess.js';
import type { ParsedGame, ParsedMove } from './types.ts';

export function parseTimeControl(value: string) {
  const match = /^(\d+)(?:\+(\d+))?$/.exec(value.trim());
  if (!match) throw new Error('Use seconds+increment for the time control, for example 600+0.');
  const base = Number(match[1]), increment = Number(match[2] || 0);
  if ((base === 0 && increment === 0) || base > 86400 || increment > 3600) throw new Error('Unsupported time control.');
  const estimated = base + 40 * increment;
  const category = estimated < 30 ? 'ultrabullet' : estimated < 180 ? 'bullet' : estimated < 480 ? 'blitz' : estimated < 1500 ? 'rapid' : 'classical';
  return { base, increment, category };
}

export function parseGame(pgn: string, timeControlOverride?: string, options: { ignoreTime?: boolean } = {}): ParsedGame {
  if (pgn.length > 200000) throw new Error('The PGN is too large. Paste a single game up to 200 kB.');
  if (/^(?:[prnbqkPRNBQK1-8]+\/){7}/.test(pgn.trim())) throw new Error('FEN contains a position, not the moves. Paste a PGN game instead.');
  if ((pgn.match(/^\[Event\s/gm) || []).length > 1) throw new Error('Paste one PGN game at a time.');
  const chess = new Chess();
  try { chess.loadPgn(pgn); } catch { throw new Error('Invalid PGN or illegal move. Check the game notation.'); }
  const headers = chess.getHeaders();
  if (headers.Variant && !['standard', 'from position'].includes(headers.Variant.toLowerCase())) throw new Error('Only standard chess is supported.');
  const tempo = timeControlOverride?.trim() || headers.TimeControl;
  if (!options.ignoreTime && (!tempo || tempo === '-')) throw new Error('A time control is required for clock-aware analysis.');
  const timeControl = options.ignoreTime ? { base: 0, increment: 0, category: 'unspecified' } : parseTimeControl(tempo!);
  const history = chess.history({ verbose: true });
  if (history.length < 2) throw new Error('At least one move by each player is required.');
  if (history.length > 300) throw new Error('Games up to 150 full moves are supported.');
  const comments = new Map(chess.getComments().map(x => [x.fen, x.comment]));
  const previousClocks = { w: timeControl.base, b: timeControl.base };
  const clockKnown = { w: true, b: true };
  const moves: ParsedMove[] = history.map((move, index) => {
    const before = new Chess(move.before);
    const material = before.board().flat().reduce((sum, piece) => sum + (piece ? ({ p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }[piece.type]) : 0), 0);
    const match = options.ignoreTime ? null : /\[%clk\s+(\d+):(\d{2}):(\d{2}(?:\.\d+)?)\]/.exec(comments.get(move.after) || '');
    const rawClock = match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
    const clock = match && rawClock !== null && Number.isFinite(rawClock) && Number(match[2]) < 60 && Number(match[3]) < 60 ? rawClock : null;
    const spent = clock !== null && clockKnown[move.color] ? previousClocks[move.color] + timeControl.increment - clock : null;
    const elapsed = spent !== null && spent >= 0 && spent <= previousClocks[move.color] + timeControl.increment ? spent : null;
    clockKnown[move.color] = clock !== null;
    if (clock !== null) previousClocks[move.color] = clock;
    return { ply: index + 1, color: move.color, san: move.san, uci: move.from + move.to + (move.promotion || ''), before: move.before, after: move.after, legalMoves: before.moves().length, material, clockSeconds: clock, elapsedSeconds: elapsed };
  });
  return { initialFen: history[0].before, timeControl, moves };
}
