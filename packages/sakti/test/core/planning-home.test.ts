import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { findRepoPlanningRootSync } from '../../src/core/planning-home.js';

describe('planning home root finding', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('finds the repo root by walking up from a nested path', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sakti-planning-home-'));
    tempDirs.push(tempDir);
    const repoRoot = path.join(tempDir, 'project');
    const changesDir = path.join(repoRoot, '.sakti', 'changes');

    fs.mkdirSync(changesDir, { recursive: true });

    const found = findRepoPlanningRootSync(changesDir);
    expect(found).toBe(fs.realpathSync.native(repoRoot));
  });

  it('returns null when no .sakti/ directory exists', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sakti-no-root-'));
    tempDirs.push(tempDir);

    const found = findRepoPlanningRootSync(tempDir);
    expect(found).toBeNull();
  });
});
