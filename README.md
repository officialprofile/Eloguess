# Eloguess

Eloguess is a small chess app that estimates playing strength from the moves of a game.
Paste a PGN, explore the board and compare both players' decisions. Analysis runs
entirely in your browser, so the app can be hosted on GitHub Pages.

## Features

- Optimistic strength ranges for both players: from the midpoint of the model's
  median and upper bound (rounded to 100 points) to the upper bound (rounded up
  to 50 points).
- Move-quality statistics for both players.
- Player names from PGN headers, with White/Black labels when names are missing.
- **Moves only:** time controls, clock comments, elapsed time and time pressure
  do not affect the estimate. PGNs without timing information work normally.
- Interactive board with move navigation.
- Local analysis cache.
- English interface, including validation messages and mobile layouts.

Your PGN stays on your device. The app downloads its engine and model as static
assets; it does not upload games or call a remote inference service.

## Run locally

Use Node.js 22, or a compatible version listed in `package.json` (20.19+).

```bash
npm ci
npm run dev
```

Open the URL printed by Vite, normally `http://127.0.0.1:5173`.

Paste one standard-chess PGN or select **Load example**. The app accepts up to
150 full moves. A strength estimate requires 15–150 full moves and at least
eight meaningful decisions by each player. A standalone FEN contains too little
information for an estimate; use the moves of the game.

## Model

The bundled model is a small GRU with 83,999 parameters. Its starting checkpoint
was trained on 373,687 games. A further pass over the same prepared data removed
all seven time-related inputs; their input weights are exactly zero. No new
Stockfish analysis was needed for that pass.

On the existing 1,160-game evaluation set, the moves-only model's median has a mean absolute
error of about **198 points**. This is a repeated check on the existing corpus;
the score does not establish equal accuracy across every rating pool. Single-game
estimates are approximate, especially near the ends of the rating scale.
The training data came from Lichess database exports.

The static model is `web/public/models/elo-gru-v1.json`. Its manifest records the
SHA-256 hash, checked by the browser before loading the weights.

## Build

```bash
npm run build
npm run preview
```

The build checks TypeScript and writes the static website to `dist/`. The
**Checks** workflow runs the same build on pushes and pull requests.

## Publish on GitHub Pages

1. Push the project to a GitHub repository. The `.gitignore` includes the website,
   ready-to-use model and build configuration.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Push to `main` to build and publish the website automatically. For the first
   deployment after enabling Pages, you can also run **Publish GitHub Pages**
   manually from the **Actions** tab.

The workflow builds and publishes `dist/` with the correct repository base path.
Training archives, Python, API keys and a model server are not needed to build
or run the website. The engine is copied from the pinned npm package during the
build, including its license and source link.

To build locally for a repository named `Eloguess`:

```bash
PAGES_BASE=/Eloguess/ npm run build
npm run preview
```

## Repository contents

The repository contains the browser application, chess analysis and inference
code, the trained model, a demo PGN, the engine preparation script, build and
deployment configuration, and these documents. The `.gitignore` uses an explicit
list of included paths; add new website assets to that list when necessary.

Research scripts, training datasets, checkpoints, reports, tests, local tools
and generated files are excluded. They remain available in the original local
workspace. Stockfish assets are generated from the pinned npm package during
the build.

Stockfish is distributed under GPLv3. The website includes its license and links
to the corresponding source code. See [third-party components and licenses](THIRD_PARTY.md).
