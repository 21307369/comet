import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);

describe('superpowers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('SUPERPOWERS_ZH_TOOL_MAP', () => {
    it('maps claude to claude', async () => {
      const { SUPERPOWERS_ZH_TOOL_MAP } = await import('../../src/core/superpowers.js');
      expect(SUPERPOWERS_ZH_TOOL_MAP['claude']).toBe('claude');
    });

    it('maps cursor to cursor', async () => {
      const { SUPERPOWERS_ZH_TOOL_MAP } = await import('../../src/core/superpowers.js');
      expect(SUPERPOWERS_ZH_TOOL_MAP['cursor']).toBe('cursor');
    });

    it('maps codex to codex', async () => {
      const { SUPERPOWERS_ZH_TOOL_MAP } = await import('../../src/core/superpowers.js');
      expect(SUPERPOWERS_ZH_TOOL_MAP['codex']).toBe('codex');
    });

    it('maps gemini to gemini', async () => {
      const { SUPERPOWERS_ZH_TOOL_MAP } = await import('../../src/core/superpowers.js');
      expect(SUPERPOWERS_ZH_TOOL_MAP['gemini']).toBe('gemini');
    });

    it('maps qwen to qwen', async () => {
      const { SUPERPOWERS_ZH_TOOL_MAP } = await import('../../src/core/superpowers.js');
      expect(SUPERPOWERS_ZH_TOOL_MAP['qwen']).toBe('qwen');
    });

    it('maps kiro to kiro', async () => {
      const { SUPERPOWERS_ZH_TOOL_MAP } = await import('../../src/core/superpowers.js');
      expect(SUPERPOWERS_ZH_TOOL_MAP['kiro']).toBe('kiro');
    });

    it('maps github-copilot to vscode', async () => {
      const { SUPERPOWERS_ZH_TOOL_MAP } = await import('../../src/core/superpowers.js');
      expect(SUPERPOWERS_ZH_TOOL_MAP['github-copilot']).toBe('vscode');
    });

    it('maps trae to trae', async () => {
      const { SUPERPOWERS_ZH_TOOL_MAP } = await import('../../src/core/superpowers.js');
      expect(SUPERPOWERS_ZH_TOOL_MAP['trae']).toBe('trae');
    });

    it('maps pi to pi', async () => {
      const { SUPERPOWERS_ZH_TOOL_MAP } = await import('../../src/core/superpowers.js');
      expect(SUPERPOWERS_ZH_TOOL_MAP['pi']).toBe('pi');
    });

    it('sets null for unsupported platforms', async () => {
      const { SUPERPOWERS_ZH_TOOL_MAP } = await import('../../src/core/superpowers.js');
      expect(SUPERPOWERS_ZH_TOOL_MAP['cline']).toBeNull();
      expect(SUPERPOWERS_ZH_TOOL_MAP['roocode']).toBeNull();
      expect(SUPERPOWERS_ZH_TOOL_MAP['continue']).toBeNull();
      expect(SUPERPOWERS_ZH_TOOL_MAP['amazon-q']).toBeNull();
      expect(SUPERPOWERS_ZH_TOOL_MAP['kilocode']).toBeNull();
      expect(SUPERPOWERS_ZH_TOOL_MAP['auggie']).toBeNull();
      expect(SUPERPOWERS_ZH_TOOL_MAP['lingma']).toBeNull();
      expect(SUPERPOWERS_ZH_TOOL_MAP['junie']).toBeNull();
      expect(SUPERPOWERS_ZH_TOOL_MAP['codebuddy']).toBeNull();
      expect(SUPERPOWERS_ZH_TOOL_MAP['costrict']).toBeNull();
      expect(SUPERPOWERS_ZH_TOOL_MAP['crush']).toBeNull();
      expect(SUPERPOWERS_ZH_TOOL_MAP['factory']).toBeNull();
      expect(SUPERPOWERS_ZH_TOOL_MAP['iflow']).toBeNull();
      expect(SUPERPOWERS_ZH_TOOL_MAP['bob']).toBeNull();
      expect(SUPERPOWERS_ZH_TOOL_MAP['forgecode']).toBeNull();
    });

    it('has entries for all 28 platforms', async () => {
      const { SUPERPOWERS_ZH_TOOL_MAP } = await import('../../src/core/superpowers.js');
      const platformIds = [
        'claude',
        'cursor',
        'codex',
        'opencode',
        'windsurf',
        'cline',
        'roocode',
        'continue',
        'github-copilot',
        'gemini',
        'amazon-q',
        'qwen',
        'kilocode',
        'auggie',
        'kiro',
        'kimicode',
        'lingma',
        'junie',
        'codebuddy',
        'costrict',
        'crush',
        'factory',
        'iflow',
        'pi',
        'qoder',
        'antigravity',
        'bob',
        'forgecode',
        'trae',
      ];
      for (const id of platformIds) {
        expect(SUPERPOWERS_ZH_TOOL_MAP).toHaveProperty(id);
      }
      expect(Object.keys(SUPERPOWERS_ZH_TOOL_MAP)).toHaveLength(28);
    });
  });

  describe('installSuperpowersForPlatforms', () => {
    it('installs superpowers-zh for supported platform ids', async () => {
      mockedExecFileSync
        .mockReturnValueOnce(Buffer.from('installed'))
        .mockReturnValueOnce(Buffer.from('installed'));

      const { installSuperpowersForPlatforms } = await import('../../src/core/superpowers.js');
      const result = await installSuperpowersForPlatforms('/tmp/test', 'project', [
        'claude',
        'cursor',
      ]);

      expect(result).toBe('installed');

      // Should have called superpowers-zh twice (once per platform)
      expect(mockedExecFileSync).toHaveBeenCalledTimes(2);

      const call1Cmd = mockedExecFileSync.mock.calls[0][0] as string;
      const call1Args = mockedExecFileSync.mock.calls[0][1] as string[];
      expect(call1Cmd).toBe(process.platform === 'win32' ? 'npx.cmd' : 'npx');
      expect(call1Args).toEqual(['github:21307369/superpowers-zh', '--tool', 'claude']);

      const call2Args = mockedExecFileSync.mock.calls[1][1] as string[];
      expect(call2Args).toEqual(['github:21307369/superpowers-zh', '--tool', 'cursor']);

      // Both calls should have timeout
      expect(mockedExecFileSync.mock.calls[0][2]).toMatchObject({ timeout: 300_000 });
      expect(mockedExecFileSync.mock.calls[1][2]).toMatchObject({ timeout: 300_000 });
    });

    it('skips unsupported platforms and installs for supported ones', async () => {
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('installed'));

      const { installSuperpowersForPlatforms } = await import('../../src/core/superpowers.js');
      const result = await installSuperpowersForPlatforms('/tmp/test', 'project', [
        'claude',
        'cline',
        'cursor',
      ]);

      expect(result).toBe('installed');
      // Only claude and cursor should trigger invocations, cline is skipped
      expect(mockedExecFileSync).toHaveBeenCalledTimes(2);
    });

    it('returns skipped when all platforms are unsupported', async () => {
      const { installSuperpowersForPlatforms } = await import('../../src/core/superpowers.js');
      const result = await installSuperpowersForPlatforms('/tmp/test', 'project', [
        'cline',
        'roocode',
      ]);

      expect(result).toBe('skipped');
      expect(mockedExecFileSync).not.toHaveBeenCalled();
    });

    it('builds command + args for a single platform', async () => {
      const { buildSuperpowersInstallCommand } = await import('../../src/core/superpowers.js');

      expect(
        buildSuperpowersInstallCommand('/tmp/test', 'project', 'claude'),
      ).toEqual({
        command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
        args: ['github:21307369/superpowers-zh', '--tool', 'claude'],
      });
    });

    it('adds --force for global scope', async () => {
      const { buildSuperpowersInstallCommand } = await import('../../src/core/superpowers.js');

      expect(
        buildSuperpowersInstallCommand('/tmp/test', 'global', 'claude'),
      ).toEqual({
        command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
        args: ['github:21307369/superpowers-zh', '--tool', 'claude', '--force'],
      });
    });

    it('returns null for unsupported platforms', async () => {
      const { buildSuperpowersInstallCommand } = await import('../../src/core/superpowers.js');

      expect(
        buildSuperpowersInstallCommand('/tmp/test', 'project', 'cline'),
      ).toBeNull();

      expect(
        buildSuperpowersInstallCommand('/tmp/test', 'project', 'lingma'),
      ).toBeNull();
    });

    it('throws when unknown platform id is passed', async () => {
      const { installSuperpowersForPlatforms } = await import('../../src/core/superpowers.js');
      await expect(
        installSuperpowersForPlatforms('/tmp/test', 'project', ['unknown-platform']),
      ).rejects.toThrow('Unknown platform IDs: unknown-platform');
      expect(mockedExecFileSync).not.toHaveBeenCalled();
    });

    it('returns failed when execFileSync throws', async () => {
      mockedExecFileSync.mockImplementationOnce(() => {
        throw new Error('install failed');
      });

      const { installSuperpowersForPlatforms } = await import('../../src/core/superpowers.js');
      const result = await installSuperpowersForPlatforms('/tmp/test', 'project', ['claude']);

      expect(result).toBe('failed');
    });

    it('shows stderr details when execFileSync fails', async () => {
      const error = new Error('Command failed: npx superpowers-zh ...') as Error & {
        stderr?: Buffer;
      };
      error.stderr = Buffer.from('fatal: unable to access: Failed to connect to github.com');
      mockedExecFileSync.mockImplementationOnce(() => {
        throw error;
      });

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { installSuperpowersForPlatforms } = await import('../../src/core/superpowers.js');
      const result = await installSuperpowersForPlatforms('/tmp/test', 'project', ['claude']);

      expect(result).toBe('failed');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('fatal: unable to access: Failed to connect to github.com'),
      );
      errorSpy.mockRestore();
    });

    it('shows stdout details when execFileSync fails', async () => {
      const error = new Error('Command failed: npx superpowers-zh ...') as Error & {
        stdout?: Buffer;
      };
      error.stdout = Buffer.from('request to github.com timed out');
      mockedExecFileSync.mockImplementationOnce(() => {
        throw error;
      });

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { installSuperpowersForPlatforms } = await import('../../src/core/superpowers.js');
      const result = await installSuperpowersForPlatforms('/tmp/test', 'project', ['claude']);

      expect(result).toBe('failed');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('request to github.com timed out'),
      );
      errorSpy.mockRestore();
    });

    it('shows ENOENT fallback when command is not found', async () => {
      const error = new Error('spawnSync ENOENT') as Error & { code?: string };
      error.code = 'ENOENT';
      mockedExecFileSync.mockImplementationOnce(() => {
        throw error;
      });

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { installSuperpowersForPlatforms } = await import('../../src/core/superpowers.js');
      const result = await installSuperpowersForPlatforms('/tmp/test', 'project', ['claude']);

      expect(result).toBe('failed');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Command not found'));
      errorSpy.mockRestore();
    });

    it('shows generic fallback when output is empty without error code', async () => {
      mockedExecFileSync.mockImplementationOnce(() => {
        throw new Error('Command failed: npx superpowers-zh ...');
      });

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { installSuperpowersForPlatforms } = await import('../../src/core/superpowers.js');
      const result = await installSuperpowersForPlatforms('/tmp/test', 'project', ['claude']);

      expect(result).toBe('failed');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('No error output captured'),
      );
      errorSpy.mockRestore();
    });

    it('formats non-object command errors defensively', async () => {
      const { formatCommandErrorDetails } = await import('../../src/core/command-error.js');

      expect(formatCommandErrorDetails(null)).toEqual(['Unknown error occurred']);
      expect(formatCommandErrorDetails(undefined)).toEqual(['Unknown error occurred']);
    });

    it('throws when mixed with unknown platform ids', async () => {
      const { installSuperpowersForPlatforms } = await import('../../src/core/superpowers.js');
      await expect(
        installSuperpowersForPlatforms('/tmp/test', 'project', [
          'claude',
          'unknown-1',
          'cursor',
          'unknown-2',
        ]),
      ).rejects.toThrow('Unknown platform IDs: unknown-1, unknown-2');
    });
  });
});
