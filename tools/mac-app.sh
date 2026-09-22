#!/usr/bin/env bash
#
# Launch the Mac app, in one command and one terminal.
#
#   npm run mac          the deployed site, https://tether.halfstop.app
#   npm run mac:local    your working copy, served here
#
# The local mode is the part worth automating. The app and the dev server need
# a process each, and running them by hand in one terminal does not work: the
# first one to start owns stdin, so the second set of commands queues behind it
# and the Ctrl-C that frees the prompt is what finally runs them - after
# killing the server they were about to need. Here the server is a background
# child with a trap on it, so closing the window takes it down too.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8099}"
LOCAL=0
[ "${1:-}" = "--local" ] && LOCAL=1

if [ "$LOCAL" = "0" ]; then
  echo "Loading the deployed site. For your working copy instead: npm run mac:local"
  cd "$REPO/apple"
  exec swift run TetherApp
fi

if curl -sf -o /dev/null --max-time 2 "http://localhost:$PORT/"; then
  echo "Something is already serving port $PORT; using it."
else
  echo "Starting the dev server on port $PORT..."
  node "$REPO/tools/serve.mjs" >"$REPO/.server.log" 2>&1 &
  SERVER=$!
  # Take the server down however this script ends: window closed, Ctrl-C, error.
  trap 'kill "$SERVER" 2>/dev/null || true' EXIT

  for _ in $(seq 1 40); do
    curl -sf -o /dev/null --max-time 1 "http://localhost:$PORT/" && break
    kill -0 "$SERVER" 2>/dev/null || { echo "The server exited. Its output:"; cat "$REPO/.server.log"; exit 1; }
    sleep 0.25
  done

  if ! curl -sf -o /dev/null --max-time 1 "http://localhost:$PORT/"; then
    echo "The server did not come up within ten seconds. Its output:"
    cat "$REPO/.server.log"
    exit 1
  fi
fi

echo "Serving your working copy. Close the window to stop both."
cd "$REPO/apple"
# Without this the app loads the deployed site and nothing above mattered.
TETHER_URL="http://localhost:$PORT" swift run TetherApp
