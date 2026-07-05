import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  DEFAULT_SAKTI_SCHEMA,
  ensureSaktiRoot,
  inspectSaktiRoot,
  rollbackCreatedPaths,
} from '../../src/core/index.js';

describe('Sakti root helper', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sakti-root-helper-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createHealthyRoot(root: string, configName = 'config.yaml'): void {
    fs.mkdirSync(path.join(root, '.sakti', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(root, '.sakti', 'changes', 'archive'), { recursive: true });
    fs.writeFileSync(path.join(root, '.sakti', configName), `schema: ${DEFAULT_SAKTI_SCHEMA}\n`);
  }

  it('inspects a healthy root with config.yaml', async () => {
    const root = path.join(tempDir, 'store');
    createHealthyRoot(root);

    await expect(inspectSaktiRoot(root)).resolves.toEqual(expect.objectContaining({
      healthy: true,
      present: true,
      config: {
        present: true,
        path: '.sakti/config.yaml',
      },
      diagnostics: [],
    }));
  });

  it('inspects a healthy root with config.yml', async () => {
    const root = path.join(tempDir, 'store');
    createHealthyRoot(root, 'config.yml');

    await expect(inspectSaktiRoot(root)).resolves.toEqual(expect.objectContaining({
      healthy: true,
      config: {
        present: true,
        path: 'sakti/config.yml',
      },
    }));
  });

  it('reports missing root pieces without mutating files', async () => {
    const root = path.join(tempDir, 'store');
    fs.mkdirSync(path.join(root, '.sakti', 'changes'), { recursive: true });

    const inspection = await inspectSaktiRoot(root);

    expect(inspection.healthy).toBe(false);
    expect(inspection.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'sakti_config_missing',
      'sakti_specs_missing',
      'sakti_archive_missing',
    ]);
    expect(fs.existsSync(path.join(root, '.sakti', 'changes', 'archive'))).toBe(false);
  });

  it('ensures the default root shape and records created paths', async () => {
    const root = path.join(tempDir, 'store');

    const result = await ensureSaktiRoot(root);

    expect(result.createdArtifacts).toEqual([
      'sakti/',
      'sakti/specs/',
      'sakti/changes/',
      'sakti/changes/archive/',
      '.sakti/config.yaml',
    ]);
    expect(result.inspection.healthy).toBe(true);
    expect(fs.readFileSync(path.join(root, '.sakti', 'config.yaml'), 'utf-8')).toContain(
      `schema: ${DEFAULT_SAKTI_SCHEMA}`
    );
  });

  it('preserves existing config and user files', async () => {
    const root = path.join(tempDir, 'store');
    createHealthyRoot(root, 'config.yml');
    fs.writeFileSync(path.join(root, '.sakti', 'specs', 'note.md'), 'keep me\n');

    const result = await ensureSaktiRoot(root);

    expect(result.createdArtifacts).toEqual([]);
    expect(fs.existsSync(path.join(root, '.sakti', 'config.yaml'))).toBe(false);
    expect(fs.readFileSync(path.join(root, '.sakti', 'config.yml'), 'utf-8')).toBe(
      `schema: ${DEFAULT_SAKTI_SCHEMA}\n`
    );
    expect(fs.readFileSync(path.join(root, '.sakti', 'specs', 'note.md'), 'utf-8')).toBe(
      'keep me\n'
    );
  });

  it('rolls back only ledger-created files and empty directories', async () => {
    const root = path.join(tempDir, 'store');
    const result = await ensureSaktiRoot(root);
    fs.writeFileSync(path.join(root, 'user.md'), 'mine\n');

    await rollbackCreatedPaths(result.createdPaths);

    expect(fs.existsSync(path.join(root, '.sakti'))).toBe(false);
    expect(fs.readFileSync(path.join(root, 'user.md'), 'utf-8')).toBe('mine\n');
  });
});
