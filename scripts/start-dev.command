#!/bin/bash
# Double-click launcher for macOS: installs dependencies, starts the MNLens dev server and opens it.
cd "$(dirname "$0")/.." || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
echo "== MNLens dev launcher ($(pwd))"
if ! command -v node >/dev/null; then echo "Node.js 20+ is required (brew install node)."; read -r -p "Press Enter to close."; exit 1; fi
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "== npm install"; npm install || { read -r -p "npm install failed. Press Enter to close."; exit 1; }
fi
echo "== starting dev server on http://localhost:4321 (Ctrl+C to stop)"
( sleep 6; open "http://localhost:4321" ) &
npm run dev
