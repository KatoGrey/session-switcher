#!/bin/sh
# Starts Session Switcher on a Mac. Double-click it in the Finder, or run it from Terminal.
#   ./"Session Switcher.command"               runs it here, with its log in this window
#   ./"Session Switcher.command" --background   runs it with no window (Setup → App → Add to Applications uses this)
# If it's already running, this just brings its window up.
cd "$(dirname "$0")" || exit 1

# The Finder and the Dock start apps with a bare PATH; add the usual places for node, claude and codex.
for d in "$HOME/.local/bin" "$HOME/.claude/local" /opt/homebrew/bin /usr/local/bin "$HOME/.npm-global/bin" "$HOME/.volta/bin" "$HOME/.bun/bin"; do
  case ":$PATH:" in *":$d:"*) ;; *) [ -d "$d" ] && PATH="$PATH:$d" ;; esac
done
# nvm keeps node in a versioned folder; use the newest one if node isn't found yet.
if ! command -v node >/dev/null 2>&1 && [ -d "$HOME/.nvm/versions/node" ]; then
  latest=$(ls -1 "$HOME/.nvm/versions/node" | sort -V | tail -1)
  [ -n "$latest" ] && PATH="$PATH:$HOME/.nvm/versions/node/$latest/bin"
fi
export PATH

if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display alert "Session Switcher needs Node.js" message "Install the LTS version from https://nodejs.org (or: brew install node), then try again."' >/dev/null 2>&1
  echo "Session Switcher needs Node.js. Install the LTS version from https://nodejs.org (or: brew install node)."
  exit 1
fi

if [ "$1" = "--background" ]; then
  nohup node server.js >/dev/null 2>&1 &
  exit 0
fi
echo "Starting Session Switcher. This window shows its log; closing it stops the app."
echo "For everyday use, open it from Applications instead (Setup → App → Add to Applications)."
echo
exec node server.js
