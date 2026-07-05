import { describe, it, expect } from 'vitest';
import { transformToHyphenCommands } from '../../src/utils/command-references.js';

describe('transformToHyphenCommands', () => {
  describe('basic transformations', () => {
    it('should transform single command reference', () => {
      expect(transformToHyphenCommands('/sakti:new')).toBe('/sakti-new');
    });

    it('should transform multiple command references', () => {
      const input = '/sakti:new and /sakti:apply';
      const expected = '/sakti-new and /sakti-apply';
      expect(transformToHyphenCommands(input)).toBe(expected);
    });

    it('should transform command reference in context', () => {
      const input = 'Use /sakti:apply to implement tasks';
      const expected = 'Use /sakti-apply to implement tasks';
      expect(transformToHyphenCommands(input)).toBe(expected);
    });

    it('should handle backtick-quoted commands', () => {
      const input = 'Run `/sakti:continue` to proceed';
      const expected = 'Run `/sakti-continue` to proceed';
      expect(transformToHyphenCommands(input)).toBe(expected);
    });
  });

  describe('edge cases', () => {
    it('should return unchanged text with no command references', () => {
      const input = 'This is plain text without commands';
      expect(transformToHyphenCommands(input)).toBe(input);
    });

    it('should return empty string unchanged', () => {
      expect(transformToHyphenCommands('')).toBe('');
    });

    it('should not transform similar but non-matching patterns', () => {
      const input = '/ops:new sakti: /other:command';
      expect(transformToHyphenCommands(input)).toBe(input);
    });

    it('should handle multiple occurrences on same line', () => {
      const input = '/sakti:new /sakti:continue /sakti:apply';
      const expected = '/sakti-new /sakti-continue /sakti-apply';
      expect(transformToHyphenCommands(input)).toBe(expected);
    });
  });

  describe('multiline content', () => {
    it('should transform references across multiple lines', () => {
      const input = `Use /sakti:new to start
Then /sakti:continue to proceed
Finally /sakti:apply to implement`;
      const expected = `Use /sakti-new to start
Then /sakti-continue to proceed
Finally /sakti-apply to implement`;
      expect(transformToHyphenCommands(input)).toBe(expected);
    });
  });

  describe('all known commands', () => {
    const commands = [
      'new',
      'continue',
      'apply',
      'ff',
      'sync',
      'archive',
      'bulk-archive',
      'verify',
      'explore',
      'onboard',
    ];

    for (const cmd of commands) {
      it(`should transform /sakti:${cmd}`, () => {
        expect(transformToHyphenCommands(`/sakti:${cmd}`)).toBe(`/sakti-${cmd}`);
      });
    }
  });
});
