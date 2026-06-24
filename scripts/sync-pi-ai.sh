#!/usr/bin/env bash
# Sync packages/ai from the upstream pi repository (earendil-works/pi).
#
# packages/ai is a git subtree of pi's `packages/ai` subdirectory. Because pi
# keeps pi-ai at `packages/ai` (not at repo root), syncing requires a split
# step that extracts that subdirectory to root, then a subtree pull from the
# split branch. The split runs inside this repo against the fetched `pi/main`
# ref — no separate clone of pi is needed.
#
# Usage:
#   scripts/sync-pi-ai.sh [REF]     # default REF = main
#
# Prerequisites (one-time):
#   git remote add pi https://github.com/earendil-works/pi.git
#
# Notes:
#   - requires a clean working tree (subtree pull creates a merge commit)
#   - pass --push in place of the pull to push local packages/ai changes back
#     upstream (rare; only if you maintain pi-ai itself)

set -euo pipefail

REF="${1:-main}"
PREFIX="packages/ai"
REMOTE="pi"
SPLIT_BRANCH="pi-ai-sync-split"

if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
	echo "error: git remote '$REMOTE' not found." >&2
	echo "       add it once with: git remote add $REMOTE https://github.com/earendil-works/pi.git" >&2
	exit 1
fi

# Require a clean working tree — subtree pull creates a merge commit.
if ! git diff --quiet --ignore-submodules || ! git diff --cached --quiet --ignore-submodules; then
	echo "error: working tree has uncommitted changes; commit or stash first." >&2
	exit 1
fi

cleanup() {
	git branch -D "$SPLIT_BRANCH" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Start from a clean slate in case a prior run left the branch behind.
cleanup

echo ">> fetching $REMOTE/$REF..."
git fetch "$REMOTE" "$REF"

echo ">> splitting $REMOTE/$REF:$PREFIX -> $SPLIT_BRANCH..."
git subtree split --prefix="$PREFIX" "$REMOTE/$REF" -b "$SPLIT_BRANCH"

echo ">> pulling $SPLIT_BRANCH into $PREFIX (squashed)..."
git subtree pull \
	--prefix="$PREFIX" \
	. "$SPLIT_BRANCH" \
	--squash \
	-m "chore(ai): sync packages/ai from $REMOTE/$REF"

echo ">> done."
