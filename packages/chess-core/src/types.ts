export type Color = 'w' | 'b';
export interface EngineConfig {
  version: string;
  nodes: number;
  hashMb: number;
  multiPv: number;
}
export const ENGINE_CONFIG: EngineConfig = {
  version: 'stockfish-18.0.8-lite-single', nodes: 10000, hashMb: 16, multiPv: 2,
};
export const FEATURE_VERSION = '1';
export interface ParsedMove {
  ply: number; color: Color; san: string; uci: string;
  before: string; after: string; legalMoves: number; material: number;
  clockSeconds: number | null; elapsedSeconds: number | null;
}
export interface ParsedGame {
  initialFen: string;
  timeControl: { base: number; increment: number; category: string };
  moves: ParsedMove[];
}
export interface SearchLine {
  cp: number | null; mate: number | null; depth: number; pv: string[];
}
export interface SearchResult { bestMove: string; lines: SearchLine[] }
export interface Engine {
  config: EngineConfig;
  search(position: string, moves?: string[]): Promise<SearchResult>;
  dispose(): void;
}
export interface MoveAnalysis extends ParsedMove {
  bestMove: string;
  bestCp: number;
  playedCp: number;
  cpLoss: number;
  opportunityGap: number;
  forced: boolean;
  phase: 'opening' | 'middlegame' | 'endgame';
  searchDisagreement: boolean;
}
export interface PlayerAnalysis {
  features: Record<string, number>;
  analyzedMoves: number;
  informativeMoves: number;
}
export interface Analysis {
  schemaVersion: '1'; featureVersion: string; engine: EngineConfig;
  timeControl: ParsedGame['timeControl']; initialFen: string;
  moves: MoveAnalysis[];
  white: PlayerAnalysis; black: PlayerAnalysis;
}
