import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  readProjectConfig,
  resolveConfigFilePath,
  classifySaktiDir,
} from '../../src/core/project-config.js';

describe('project-config', () => {
  let tempDir: string;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sakti-test-config-'));
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    consoleWarnSpy.mockRestore();
  });

  describe('readProjectConfig', () => {
    it('parses valid config with schema', () => {
      const configDir = path.join(tempDir, '.sakti');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'config.yaml'),
        'schema: spec-driven\n',
      );

      const config = readProjectConfig(tempDir);
      expect(config).toEqual({ schema: 'spec-driven' });
    });

    it('returns null when schema field is missing', () => {
      const configDir = path.join(tempDir, '.sakti');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, 'config.yaml'), 'context: hello\n');

      const config = readProjectConfig(tempDir);
      expect(config).toBeNull();
    });

    it('returns null when schema is empty string', () => {
      const configDir = path.join(tempDir, '.sakti');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, 'config.yaml'), 'schema: ""\n');

      const config = readProjectConfig(tempDir);
      expect(config).toBeNull();
    });

    it('returns null when config file does not exist', () => {
      const config = readProjectConfig(tempDir);
      expect(config).toBeNull();
    });

    it('returns null when .sakti directory does not exist', () => {
      const config = readProjectConfig(tempDir);
      expect(config).toBeNull();
    });

    it('returns null and warns when config is not a YAML object', () => {
      const configDir = path.join(tempDir, '.sakti');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, 'config.yaml'), '- just\n- a\n- list\n');

      const config = readProjectConfig(tempDir);
      expect(config).toBeNull();
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('returns null and warns when YAML is completely invalid', () => {
      const configDir = path.join(tempDir, '.sakti');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, 'config.yaml'), 'schema: [unterminated\n');

      const config = readProjectConfig(tempDir);
      expect(config).toBeNull();
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('returns null and warns for empty config file', () => {
      const configDir = path.join(tempDir, '.sakti');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, 'config.yaml'), '\n');

      const config = readProjectConfig(tempDir);
      expect(config).toBeNull();
    });
  });

  describe('.yml/.yaml precedence', () => {
    it('prefers .yaml when both exist', () => {
      const configDir = path.join(tempDir, '.sakti');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, 'config.yaml'), 'schema: yaml\n');
      fs.writeFileSync(path.join(configDir, 'config.yml'), 'schema: yml\n');

      const config = readProjectConfig(tempDir);
      expect(config).toEqual({ schema: 'yaml' });
    });

    it('uses .yml when .yaml does not exist', () => {
      const configDir = path.join(tempDir, '.sakti');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, 'config.yml'), 'schema: yml\n');

      const config = readProjectConfig(tempDir);
      expect(config).toEqual({ schema: 'yml' });
    });

    it('resolveConfigFilePath returns null when neither exists', () => {
      expect(resolveConfigFilePath(tempDir)).toBeNull();
    });
  });

  describe('classifySaktiDir', () => {
    it('returns false/false when .sakti does not exist', () => {
      const result = classifySaktiDir(tempDir);
      expect(result).toEqual({ hasPlanningShape: false, hasConfigFile: false });
    });

    it('detects hasConfigFile when config.yaml exists', () => {
      const configDir = path.join(tempDir, '.sakti');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, 'config.yaml'), 'schema: spec-driven\n');

      const result = classifySaktiDir(tempDir);
      expect(result).toEqual({ hasPlanningShape: false, hasConfigFile: true });
    });

    it('detects hasPlanningShape when specs/ exists', () => {
      fs.mkdirSync(path.join(tempDir, '.sakti', 'specs'), { recursive: true });

      const result = classifySaktiDir(tempDir);
      expect(result).toEqual({ hasPlanningShape: true, hasConfigFile: false });
    });

    it('detects hasPlanningShape when changes/ exists', () => {
      fs.mkdirSync(path.join(tempDir, '.sakti', 'changes'), { recursive: true });

      const result = classifySaktiDir(tempDir);
      expect(result).toEqual({ hasPlanningShape: true, hasConfigFile: false });
    });
  });
});
