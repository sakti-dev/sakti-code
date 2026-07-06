import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  acquireFileLock,
  releaseFileLock,
  writeFileAtomically,
} from '../../src/core/file-state.js';

describe('file-state', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sakti-file-state-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function errorFor(
    kind: 'create-failed' | 'timeout',
    info: { lockPath: string; cause?: unknown }
  ): Error {
    return new Error(`${kind}:${info.lockPath}`);
  }

  // posix-only: these induce a lock-create failure via chmod(0o555), which
  // win32 ignores for directories, so the lock would succeed instead of
  // rejecting. The production error shapes are platform-agnostic.
  const itPosix = it.skipIf(process.platform === 'win32');

  describe('writeFileAtomically', () => {
    it('writes content and creates parent directories', async () => {
      const target = path.join(tempDir, 'nested', 'state.yaml');

      await writeFileAtomically(target, 'version: 1\n');

      expect(fs.readFileSync(target, 'utf-8')).toBe('version: 1\n');
    });

    it('leaves no temp file behind after a write', async () => {
      const target = path.join(tempDir, 'state.yaml');

      await writeFileAtomically(target, 'a\n');
      await writeFileAtomically(target, 'b\n');

      expect(fs.readFileSync(target, 'utf-8')).toBe('b\n');
      expect(fs.readdirSync(tempDir)).toEqual(['state.yaml']);
    });
  });

  describe('acquireFileLock', () => {
    it('acquires and releases the lock file', async () => {
      const lockPath = path.join(tempDir, 'state.yaml.lock');

      const lock = await acquireFileLock({ lockPath, errorFor });
      expect(fs.existsSync(lockPath)).toBe(true);

      await releaseFileLock(lock, lockPath);
      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it('steals a stale lock', async () => {
      const lockPath = path.join(tempDir, 'state.yaml.lock');
      fs.writeFileSync(lockPath, '');
      const staleTime = new Date(Date.now() - 60_000);
      fs.utimesSync(lockPath, staleTime, staleTime);

      const lock = await acquireFileLock({ lockPath, errorFor });

      expect(fs.existsSync(lockPath)).toBe(true);
      await releaseFileLock(lock, lockPath);
    });

    itPosix('reports lock-create failures through the injected factory', async () => {
      // A directory at the lock path makes open(wx) fail with a
      // non-EEXIST-style conflict on every platform... except that a
      // directory yields EEXIST too; use an unwritable parent instead.
      const parent = path.join(tempDir, 'no-write');
      fs.mkdirSync(parent);
      fs.chmodSync(parent, 0o555);
      const lockPath = path.join(parent, 'state.yaml.lock');

      try {
        await expect(
          acquireFileLock({ lockPath, errorFor })
        ).rejects.toThrowError(`create-failed:${lockPath}`);
      } finally {
        fs.chmodSync(parent, 0o755);
      }
    });
  });
});
