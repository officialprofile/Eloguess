# Third-party components

## Stockfish.js

- Package: `stockfish@18.0.8`, lite single-threaded WASM build.
- Copyright: Stockfish contributors and Chess.com, LLC; see upstream files.
- License: GNU GPL v3. The unmodified license is copied into the published
  website at `engine/COPYING.txt`.
- Corresponding upstream source at the package's `gitHead`:
  https://github.com/nmrugg/stockfish.js/tree/93c994592dcf3b4b21052ab925e9b534df9c0918
- Source archive:
  https://github.com/nmrugg/stockfish.js/archive/93c994592dcf3b4b21052ab925e9b534df9c0918.tar.gz
- Build instructions and scripts are in that source tree, linked above.
  The engine files are copied without
  modification. Their SHA256 hashes are recorded in `engine/manifest.json`.

## chess.js, React, Vite and other packages

Exact package versions and integrity hashes are recorded in `package-lock.json`.
`chess.js` is BSD-2-Clause; React is MIT. The corresponding packages contain their
license texts. The build includes their license comments where emitted by the bundler.

## Lichess database

Database exports at https://database.lichess.org/ are released under CC0.
Downloaded monthly archives and per-game research artifacts are not included in Git.

## Example game

The UI example in `fixtures/demo.pgn` is the user-provided Kicer–Dziango game
from June 12, 2026: https://lichess.org/q76PObcd.
The supplied player names, ratings and time-control headers are preserved.
Ratings and time controls are ignored when estimating playing strength.
It demonstrates the interface and is not evidence of held-out model accuracy.
