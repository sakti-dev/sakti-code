import * as fs from 'node:fs';
import * as path from 'node:path';

/** Minimal healthy Sakti root layout shared by slice test suites. */
export function createSaktiRoot(rootDir: string): void {
  fs.mkdirSync(path.join(rootDir, '.sakti', 'specs'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, '.sakti', 'changes', 'archive'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, '.sakti', 'config.yaml'), 'schema: spec-driven\n');
}

/** Writes a spec file under the root's .sakti/specs/<id>/spec.md. */
export function writeSpec(rootDir: string, specId: string, body: string): void {
  const specDir = path.join(rootDir, '.sakti', 'specs', specId);
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(specDir, 'spec.md'), body);
}
