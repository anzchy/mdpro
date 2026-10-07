#!/bin/zsh
# usage: theme.sh Light|Dark
osascript -e "tell application \"System Events\" to tell (first process whose name is \"tauri-app\")
  set frontmost to true
  click menu item \"$1\" of menu 1 of menu bar item \"Theme\" of menu bar 1
end tell"
