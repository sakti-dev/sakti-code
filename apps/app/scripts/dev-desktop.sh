#!/usr/bin/env bash
set -e

# Source nix dev env if not already inside it
if [ -z "$IN_NIX_SHELL" ]; then
  exec nix develop -c bash "$0" "$@"
fi

cd "$(dirname "$0")/.."

export SAKTI_DEV=1
export SAKTI_MIGRATIONS_FOLDER="$(realpath ../../packages/db/migrations)"

exec electrobun dev
