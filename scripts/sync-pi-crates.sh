#!/usr/bin/env bash
# Regenerate the `crates-only` branch on the oh-my-pi fork.
#
# The fork's `main` is a pristine mirror of upstream (can1357/oh-my-pi).
# This script produces a separate `crates-only` branch that contains ONLY the
# Rust crates workspace (crates/ + root Cargo.toml + Cargo.lock +
# rust-toolchain.toml), with the full per-file history for those paths.
#
# sakti-code then subtrees from `crates-only` (squashed) into vendor/pi-crates/,
# so we track upstream pi-ast without dragging in the 87MB of packages/assets/
# scripts/python/docs we don't build.
#
# Re-run this whenever you want to pull upstream crate changes:
#   nix-shell -p git-filter-repo --run "bash scripts/sync-pi-crates.sh"
#
# Workflow for syncing upstream into sakti-code:
#   1. On the fork: merge can1357/oh-my-pi main into sakti-dev/oh-my-pi main
#   2. Run this script  (regenerates crates-only from the new main)
#   3. In sakti-code: pnpm run pi:pull  (subtree pull from crates-only)

set -euo pipefail

REMOTE="${PI_REMOTE:-https://github.com/sakti-dev/oh-my-pi.git}"
BRANCH="${PI_BRANCH:-crates-only}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> Cloning $REMOTE (full history) into $TMP"
git clone --quiet "$REMOTE" "$TMP"
cd "$TMP"

echo "==> Filtering to keep crates/ + Cargo.toml + Cargo.lock + rust-toolchain.toml"
git filter-repo \
  --path crates \
  --path Cargo.toml \
  --path Cargo.lock \
  --path rust-toolchain.toml

echo "==> Re-adding origin (filter-repo strips remotes as a safety measure)"
git remote add origin "$REMOTE"

echo "==> Force-pushing filtered history to '$BRANCH'"
git push --force --quiet origin "HEAD:$BRANCH"

echo ""
echo "==> Done. '$BRANCH' on $REMOTE now holds only the Rust crates workspace."
echo "    In sakti-code: pnpm run pi:pull"
