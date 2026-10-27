#!/bin/zsh
# Sourced by reset-codex.sh and prompt.sh: one name-to-role policy for Codex panes.
mdpro_role_for_agent() {
  case $1 in
    gpt-auditor) print -r -- auditor ;;
    gpt-imple-?*|opus-imple-?*) print -r -- implementor ;;
    *) return 2 ;;
  esac
}
