#!/bin/bash
# ui.sh '<json steps>' — one bounded, non-replayed Windows desktop transaction.
# Caller deadline includes CDP preflight; Windows independently owns cleanup.
# Never discard output. Contracts and budget overrides: ../../reference/ops.md.
source "$(dirname "$0")/common.sh"
exec python3 "$(dirname "$0")/ui-transaction.py" "$1"
