import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { analyzeGame } from '../../packages/chess-core/src/analysis.ts';
import { parseGame } from '../../packages/chess-core/src/pgn.ts';
import type { Analysis } from '../../packages/chess-core/src/types.ts';
import { predictRatings, validateModelBundle, type ModelBundle } from '../../packages/chess-core/src/model.ts';
import { browserEngine } from './browser-engine.ts';
import { analysisKey, cachedAnalysis, saveAnalysis } from './cache.ts';
import example from '../../fixtures/demo.pgn?raw';

const symbols: Record<string, string> = { wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙', bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟' };

function playerName(value: string | undefined, fallback: string) {
  const name = value?.trim();
  return name && !/^[?-]+$/.test(name) ? name : fallback;
}

function Board({ fen }: { fen: string }) {
  const board = new Chess(fen).board();
  return <div className="board" aria-label="Chessboard position">{board.flatMap((row, r) => row.map((piece, c) => <div key={`${r}-${c}`} className={`square ${(r+c)%2 ? 'dark' : 'light'}`}>
    {c === 0 && <small className="rank">{8-r}</small>}{r === 7 && <small className="file">{'abcdefgh'[c]}</small>}
    {piece && <span className={`piece ${piece.color === 'w' ? 'white-piece' : ''}`} aria-label={`${piece.color}${piece.type} ${piece.square}`}>{symbols[piece.color + piece.type]}</span>}
  </div>))}</div>;
}

export function App() {
  const [pgn, setPgn] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState([0, 0]);
  const [error, setError] = useState('');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [playerNames, setPlayerNames] = useState({ white: 'White', black: 'Black' });
  const [gameResult, setGameResult] = useState<'white' | 'black' | 'draw' | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [ply, setPly] = useState(0);
  const [model, setModel] = useState<ModelBundle | null>(null);
  const [modelMessage, setModelMessage] = useState('Loading the rating model…');
  const predictionResult = useMemo(() => {
    if (!analysis || !model) return { ratings: null, message: modelMessage };
    try { return { ratings: predictRatings(analysis, model), message: '' }; }
    catch (e) { return { ratings: null, message: (e as Error).message }; }
  }, [analysis, model, modelMessage]);
  const engineRef = useRef<ReturnType<typeof browserEngine> | null>(null);
  const runId = useRef(0);
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}models/manifest.json`, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(async manifest => {
      if (manifest.status === 'trained' && manifest.file) {
        const response = await fetch(`${import.meta.env.BASE_URL}models/${manifest.file}?v=${manifest.sha256}`);
        if (!response.ok) throw new Error();
        const bytes = await response.arrayBuffer();
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
        if (hash !== manifest.sha256) throw new Error();
        const loaded = JSON.parse(new TextDecoder().decode(bytes));
        validateModelBundle(loaded);
        setModel(loaded);
      } else throw new Error();
    }).catch(() => setModelMessage('The rating model is currently unavailable. Move analysis still works.'));
    return () => { runId.current++; engineRef.current?.dispose(); };
  }, []);

  async function start() {
    setError('');
    let parsed;
    const game = new Chess();
    try {
      parsed = parseGame(pgn, undefined, { ignoreTime: true });
      game.loadPgn(pgn);
    } catch (e) { setError((e as Error).message); return; }
    const headers = game.getHeaders();
    const id = ++runId.current;
    // Names and result belong to this submission, even when move analysis comes from the cache.
    setPlayerNames({ white: playerName(headers.White, 'White'), black: playerName(headers.Black, 'Black') });
    const result = headers.Result?.trim();
    setGameResult(result === '1-0' ? 'white' : result === '0-1' ? 'black' : result === '1/2-1/2' ? 'draw' : null);
    setBusy(true); setAnalysis(null); setFromCache(false); setProgress([0, 0]); setPly(0);
    let engine: ReturnType<typeof browserEngine> | null = null;
    try {
      const key = await analysisKey(parsed);
      const cached = await cachedAnalysis(key);
      if (id !== runId.current) return;
      if (cached) { setAnalysis(cached); setFromCache(true); return; }
      engine = browserEngine(); engineRef.current = engine;
      await engine.initialize();
      const result = await analyzeGame(pgn, engine, { ignoreTime: true, onProgress: (done, total) => { if (id === runId.current) setProgress([done,total]); } });
      if (id === runId.current) { setAnalysis(result); await saveAnalysis(key, result); }
    } catch (e) { if (id === runId.current) setError((e as Error).message); }
    finally { engine?.dispose(); if (id === runId.current) { engineRef.current = null; setBusy(false); } }
  }
  function cancel() { runId.current++; engineRef.current?.dispose(); engineRef.current = null; setBusy(false); setError('Analysis cancelled.'); }
  const fen = analysis ? (ply ? analysis.moves[ply-1].after : analysis.initialFen) : new Chess().fen();
  const selected = analysis && ply ? analysis.moves[ply-1] : null;
  const resultScore = gameResult === 'draw' ? '½ : ½' : gameResult === 'white' ? '1 : 0' : gameResult === 'black' ? '0 : 1' : null;
  const resultMessage = resultScore ? `${playerNames.white} ${resultScore} ${playerNames.black}` : null;
  return <>
    <header className="topbar">
      <a className="brand" href="https://officialprofile.github.io/Eloguess"><span className="brand-icon" aria-hidden="true">♞</span>eloguess</a>
      <a className="github-link" href="https://github.com/officialprofile/Eloguess" target="_blank" rel="noopener noreferrer" aria-label="View Eloguess on GitHub" title="View Eloguess on GitHub">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true" focusable="false">
          <path d="M12 .75a11.25 11.25 0 0 0-3.558 21.924c.563.104.768-.244.768-.542 0-.267-.01-.975-.015-1.914-3.13.68-3.791-1.508-3.791-1.508-.512-1.3-1.25-1.646-1.25-1.646-1.023-.7.078-.686.078-.686 1.13.08 1.725 1.16 1.725 1.16 1.006 1.724 2.64 1.226 3.283.937.102-.728.393-1.226.715-1.508-2.499-.284-5.126-1.25-5.126-5.566 0-1.23.44-2.232 1.16-3.02-.116-.285-.503-1.428.11-2.978 0 0 .945-.302 3.095 1.153A10.8 10.8 0 0 1 12 6.178c.956.005 1.918.129 2.817.379 2.149-1.455 3.092-1.153 3.092-1.153.615 1.55.228 2.693.112 2.977.722.79 1.158 1.79 1.158 3.021 0 4.327-2.631 5.279-5.138 5.558.404.349.764 1.04.764 2.097 0 1.514-.014 2.736-.014 3.107 0 .301.202.652.774.541A11.252 11.252 0 0 0 12 .75Z" />
        </svg>
      </a>
    </header>
    <main>
      <div className="workspace">
        <section className="input-panel card">
          <label htmlFor="pgn">Game notation</label><textarea id="pgn" spellCheck={false} placeholder={'[Event "My game"]\n\n1. e4 e5 2. Nf3 Nc6 …'} value={pgn} disabled={busy} onChange={e => setPgn(e.target.value)} />
          <div className="input-meta"><span>One game · up to 150 moves</span><button className="text-button" disabled={busy} onClick={() => { setPgn(example); setError(''); }}>Load example ↗</button></div>
          <button className="primary" disabled={busy || !pgn.trim()} onClick={start}>{busy ? 'Analyzing your game…' : 'Analyze game'}<span>↗</span></button>
          {busy && <div className="progress-wrap" role="status"><progress max={progress[1] || 1} value={progress[0]} /><div>{progress[1] ? `Move ${progress[0]} of ${progress[1]}` : 'Preparing the engine…'}<button className="text-button" onClick={cancel}>Cancel</button></div></div>}
          {error && <p className="error" role="alert">{error}</p>}
        </section>
        <section className="board-panel"><Board fen={fen} />
          <div className="board-controls"><button aria-label="Starting position" disabled={!analysis || ply === 0} onClick={() => setPly(0)}>⇤</button><button aria-label="Previous move" disabled={!analysis || ply === 0} onClick={() => setPly(ply-1)}>←</button><span>{selected ? `${Math.ceil(selected.ply/2)}${selected.color === 'w' ? '.' : '…'} ${selected.san}` : 'Start of game'}</span><button aria-label="Next move" disabled={!analysis || ply === analysis.moves.length} onClick={() => setPly(ply+1)}>→</button><button aria-label="Last move" disabled={!analysis || ply === analysis.moves.length} onClick={() => setPly(analysis!.moves.length)}>⇥</button></div>
        </section>
      </div>
      <section className="results" aria-live="polite">
        {!analysis ? <div className="empty-results"><span>♙</span><p>Results for both players will appear here.<small>Paste a PGN or try the example game to get started.</small></p></div> : <>
          {resultMessage && <p className="game-result">{resultMessage}</p>}
          <div className="player-grid">{(['white', 'black'] as const).map(color => {
            const player = analysis[color]; const prediction = predictionResult.ratings?.[color];
            const outcome = gameResult === 'draw' ? 'draw' : gameResult ? (gameResult === color ? 'win' : 'loss') : undefined;
            // The displayed range runs from the median to the midpoint toward the upper bound.
            const midpointRating = prediction ? (prediction.median + prediction.upper) / 2 : null;
            return <article className="player-card card" data-outcome={outcome} key={color}><div className="player-title"><span>{color === 'white' ? '♔' : '♚'}</span><h3>{playerNames[color]}</h3></div>
              {prediction && midpointRating !== null ? <div className="rating"><strong>{Math.round(prediction.median/100)*100}–{Math.round(midpointRating/100)*100}</strong><span>Estimated playing strength</span>
              </div> : <p className="model-status">{predictionResult.message}</p>}
              <dl><div><dt>Average loss</dt><dd>{Math.round(player.features.mean_loss)} <small>cp</small></dd></div><div><dt>Key decisions</dt><dd>{player.informativeMoves}</dd></div><div><dt>Best moves</dt><dd>{Math.round(player.features.best_fraction*100)}<small>%</small></dd></div></dl>
            </article>;
          })}</div>
          {fromCache && <p className="hint">Loaded a previous analysis saved on this device.</p>}
        </>}
      </section>
    </main>
  </>;
}
