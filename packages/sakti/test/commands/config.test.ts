import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

async function runConfigCommand(args: string[]): Promise<void> {
  const { registerConfigCommand } = await import('../../src/commands/config.js');
  const program = new Command();
  registerConfigCommand(program);
  await program.parseAsync(['node', '.sakti', 'config', ...args]);
}

describe('config command integration', () => {
  // These tests use real file system operations with XDG_CONFIG_HOME override
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Create unique temp directory for each test
    tempDir = path.join(os.tmpdir(), `sakti-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tempDir, { recursive: true });

    // Save original env and set XDG_CONFIG_HOME
    originalEnv = { ...process.env };
    process.env.XDG_CONFIG_HOME = tempDir;

    // Spy on console.error
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;

    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });

    // Restore spies
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();

    // Reset module cache to pick up new XDG_CONFIG_HOME
    vi.resetModules();
  });

  it('should use XDG_CONFIG_HOME for config path', async () => {
    const { getGlobalConfigPath } = await import('../../src/core/global-config.js');
    const configPath = getGlobalConfigPath();
    expect(configPath).toBe(path.join(tempDir, 'sakti', 'config.json'));
  });

  it('should save and load config correctly', async () => {
    const { getGlobalConfig, saveGlobalConfig } = await import('../../src/core/global-config.js');

    saveGlobalConfig({ featureFlags: { test: true } });
    const config = getGlobalConfig();
    expect(config.featureFlags).toEqual({ test: true });
  });

  it('should return defaults when config file does not exist', async () => {
    const { getGlobalConfig, getGlobalConfigPath } = await import('../../src/core/global-config.js');

    const configPath = getGlobalConfigPath();
    // Make sure config doesn't exist
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }

    const config = getGlobalConfig();
    expect(config.featureFlags).toEqual({});
  });

  it('should preserve unknown fields', async () => {
    const { getGlobalConfig, getGlobalConfigDir } = await import('../../src/core/global-config.js');

    const configDir = getGlobalConfigDir();
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({
      featureFlags: {},
      customField: 'preserved',
    }));

    const config = getGlobalConfig();
    expect((config as Record<string, unknown>).customField).toBe('preserved');
  });

  it('should handle invalid JSON gracefully', async () => {
    const { getGlobalConfig, getGlobalConfigDir } = await import('../../src/core/global-config.js');

    const configDir = getGlobalConfigDir();
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), '{ invalid json }');

    const config = getGlobalConfig();
    // Should return defaults
    expect(config.featureFlags).toEqual({});
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid JSON'));
  });

  it('should set workflows from JSON array syntax', async () => {
    await runConfigCommand([
      'set',
      'workflows',
      '["new","ff","apply","archive"]',
    ]);

    const { getGlobalConfig } = await import('../../src/core/global-config.js');
    const config = getGlobalConfig();

    expect(config.workflows).toEqual(['new', 'ff', 'apply', 'archive']);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Set workflows = new,ff,apply,archive'
    );
  });
});


describe('config key validation', () => {
  it('rejects unknown top-level keys', async () => {
    const { validateConfigKeyPath } = await import('../../src/core/config-schema.js');
    expect(validateConfigKeyPath('unknownKey').valid).toBe(false);
  });

  it('allows feature flag keys', async () => {
    const { validateConfigKeyPath } = await import('../../src/core/config-schema.js');
    expect(validateConfigKeyPath('featureFlags.someFlag').valid).toBe(true);
  });

  it('rejects deeply nested feature flag keys', async () => {
    const { validateConfigKeyPath } = await import('../../src/core/config-schema.js');
    expect(validateConfigKeyPath('featureFlags.someFlag.extra').valid).toBe(false);
  });

  it('allows profile key', async () => {
    const { validateConfigKeyPath } = await import('../../src/core/config-schema.js');
    expect(validateConfigKeyPath('profile').valid).toBe(true);
  });

  it('allows delivery key', async () => {
    const { validateConfigKeyPath } = await import('../../src/core/config-schema.js');
    expect(validateConfigKeyPath('delivery').valid).toBe(true);
  });

  it('allows workflows key', async () => {
    const { validateConfigKeyPath } = await import('../../src/core/config-schema.js');
    expect(validateConfigKeyPath('workflows').valid).toBe(true);
  });
});
