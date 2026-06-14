import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { PLATFORMS, type Platform } from '../../src/core/platforms.js';
import {
  buildNpmUpdateArgs,
  detectCometPackageScope,
  detectInstalledCometLanguage,
  detectInstalledCometTargets,
  detectRepoUrl,
  formatNpmUpdateCommand,
  formatSkillUpdateCommand,
  updateCommand,
} from '../../src/commands/update.js';

// Mock the interactive select prompt so tests don't hang on CI (no TTY).
vi.mock('@inquirer/prompts', () => ({
  select: vi.fn().mockResolvedValue(false),
}));

const claudePlatform: Platform = {
  id: 'claude',
  name: 'Claude Code',
  skillsDir: '.claude',
  openspecToolId: 'claude',
};

describe('update command helpers', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `comet-update-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('detects Chinese installed comet skills from existing skill content', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'),
      '# Comet\n\n当用户提出需求时，先澄清目标再执行。',
      'utf-8',
    );

    await expect(detectInstalledCometLanguage(tmpDir, claudePlatform)).resolves.toBe('zh');
  });

  it('detects English installed comet skills from existing skill content', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'),
      '# Comet\n\nUse this skill when starting a new change.',
      'utf-8',
    );

    await expect(detectInstalledCometLanguage(tmpDir, claudePlatform)).resolves.toBe('en');
  });

  it('defaults installed comet language to English when the skills directory is missing', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });

    await expect(detectInstalledCometLanguage(tmpDir, claudePlatform)).resolves.toBe('en');
  });

  it('finds only scopes and platforms that already have comet skills installed', async () => {
    const projectDir = path.join(tmpDir, 'project');
    const globalDir = path.join(tmpDir, 'home');

    await fs.mkdir(path.join(projectDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, '.claude', 'skills', 'comet', 'SKILL.md'),
      '# Comet\n\nUse this skill.',
      'utf-8',
    );

    await fs.mkdir(path.join(projectDir, '.cursor'), { recursive: true });

    await fs.mkdir(path.join(globalDir, '.codex', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(globalDir, '.codex', 'skills', 'comet', 'SKILL.md'),
      '# Comet\n\n当用户提出需求时使用这个技能。',
      'utf-8',
    );

    const targets = await detectInstalledCometTargets(projectDir, {
      globalBaseDir: globalDir,
    });

    expect(targets.map((t) => `${t.scope}:${t.platform.id}:${t.language}`)).toEqual([
      'project:claude:en',
      'global:codex:zh',
    ]);
  });

  it('ignores platform directories that do not contain a skills directory', async () => {
    const projectDir = path.join(tmpDir, 'project');
    await fs.mkdir(path.join(projectDir, '.claude'), { recursive: true });

    await expect(detectInstalledCometTargets(projectDir, { scopes: ['project'] })).resolves.toEqual(
      [],
    );
  });

  it('respects explicit scope filtering when detecting installed targets', async () => {
    const projectDir = path.join(tmpDir, 'project');
    const globalDir = path.join(tmpDir, 'home');

    await fs.mkdir(path.join(projectDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(path.join(projectDir, '.claude', 'skills', 'comet', 'SKILL.md'), '# Comet');
    await fs.mkdir(path.join(globalDir, '.codex', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(path.join(globalDir, '.codex', 'skills', 'comet', 'SKILL.md'), '# Comet');

    const targets = await detectInstalledCometTargets(projectDir, {
      globalBaseDir: globalDir,
      scopes: ['global'],
    });

    expect(targets.map((t) => `${t.scope}:${t.platform.id}`)).toEqual(['global:codex']);
  });

  it('detects legacy global Pi skills so update can migrate them', async () => {
    const projectDir = path.join(tmpDir, 'project');
    const globalDir = path.join(tmpDir, 'home');

    await fs.mkdir(path.join(globalDir, '.pi', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(globalDir, '.pi', 'skills', 'comet', 'SKILL.md'),
      '# Comet\n\nUse this skill.',
      'utf-8',
    );

    const targets = await detectInstalledCometTargets(projectDir, {
      globalBaseDir: globalDir,
      scopes: ['global'],
    });

    expect(targets.map((t) => `${t.scope}:${t.platform.id}:${t.language}`)).toEqual([
      'global:pi:en',
    ]);
    expect(PLATFORMS.find((platform) => platform.id === 'pi')?.globalSkillsDir).toBe('.pi/agent');
  });

  it('detects project package scope from local node_modules install path', async () => {
    const projectDir = path.join(tmpDir, 'project');
    const packageRoot = path.join(projectDir, 'node_modules', '@rpamis', 'comet');

    await expect(detectCometPackageScope(projectDir, packageRoot)).resolves.toBe('project');
  });

  it('detects project package scope from package.json dependencies', async () => {
    const projectDir = path.join(tmpDir, 'project');
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, 'package.json'),
      JSON.stringify({ devDependencies: { '@rpamis/comet': '^0.2.4' } }),
      'utf-8',
    );

    await expect(detectCometPackageScope(projectDir, tmpDir)).resolves.toBe('project');
  });

  it('falls back to global package scope when no project install is found', async () => {
    const projectDir = path.join(tmpDir, 'project');
    await fs.mkdir(projectDir, { recursive: true });

    await expect(detectCometPackageScope(projectDir, tmpDir)).resolves.toBe('global');
  });

  it('builds npm update args preserving package install scope with official registry', () => {
    expect(buildNpmUpdateArgs('global')).toEqual([
      'install',
      '-g',
      '@rpamis/comet@latest',
      '--registry',
      'https://registry.npmjs.org',
    ]);
    expect(buildNpmUpdateArgs('project')).toEqual([
      'install',
      '@rpamis/comet@latest',
      '--registry',
      'https://registry.npmjs.org',
    ]);
  });

  it('formats the npm update command for friendly console output', () => {
    expect(formatNpmUpdateCommand('global')).toBe(
      'npm install -g @rpamis/comet@latest --registry https://registry.npmjs.org',
    );
    expect(formatNpmUpdateCommand('project')).toBe(
      'npm install @rpamis/comet@latest --registry https://registry.npmjs.org',
    );
  });

  it('formats the skill update command with scope, platform, and language source', () => {
    expect(formatSkillUpdateCommand('project', claudePlatform, 'skills-zh')).toBe(
      'copy assets/skills-zh -> .claude/skills/ (project)',
    );
    expect(formatSkillUpdateCommand('global', claudePlatform, 'skills')).toBe(
      'copy assets/skills -> ~/.claude/skills/ (global)',
    );
  });

  it('prints the skill update command when updating installed skills', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'),
      '# Comet\n\n当用户提出需求时使用这个技能。',
      'utf-8',
    );

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let output = '';
    try {
      await updateCommand(tmpDir, { skipNpm: true });
      output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    expect(output).toContain('$ copy assets/skills-zh -> .claude/skills/ (project)');
  });

  describe('detectRepoUrl', () => {
    it('reads a string repository URL from package.json', async () => {
      const cometDir = path.join(tmpDir, 'comet');
      await fs.mkdir(cometDir, { recursive: true });
      await fs.writeFile(
        path.join(cometDir, 'package.json'),
        JSON.stringify({ repository: 'git+https://github.com/user/comet.git' }),
        'utf-8',
      );

      await expect(detectRepoUrl(cometDir)).resolves.toBe(
        'https://github.com/user/comet.git',
      );
    });

    it('reads an object repository URL from package.json', async () => {
      const cometDir = path.join(tmpDir, 'comet');
      await fs.mkdir(cometDir, { recursive: true });
      await fs.writeFile(
        path.join(cometDir, 'package.json'),
        JSON.stringify({
          repository: {
            type: 'git',
            url: 'git+https://github.com/user/comet-fork.git',
          },
        }),
        'utf-8',
      );

      await expect(detectRepoUrl(cometDir)).resolves.toBe(
        'https://github.com/user/comet-fork.git',
      );
    });

    it('returns undefined when no repository field in package.json', async () => {
      const cometDir = path.join(tmpDir, 'comet');
      await fs.mkdir(cometDir, { recursive: true });
      await fs.writeFile(
        path.join(cometDir, 'package.json'),
        JSON.stringify({ name: 'my-comet' }),
        'utf-8',
      );

      await expect(detectRepoUrl(cometDir)).resolves.toBeUndefined();
    });

    it('returns undefined when package.json does not exist', async () => {
      await expect(detectRepoUrl(tmpDir)).resolves.toBeUndefined();
    });
  });

  describe('--source local', () => {
    it('copies skills from a local comet fork', async () => {
      // Create a mock comet source with assets
      const cometSource = path.join(tmpDir, 'comet-source');
      const assetsDir = path.join(cometSource, 'assets');
      await fs.mkdir(path.join(assetsDir, 'skills', 'comet-guard'), { recursive: true });
      await fs.writeFile(
        path.join(assetsDir, 'skills', 'comet-guard', 'SKILL.md'),
        '# Comet Guard\n\nTest skill.',
        'utf-8',
      );
      await fs.writeFile(
        path.join(assetsDir, 'manifest.json'),
        JSON.stringify({ skills: ['comet-guard/SKILL.md'] }),
        'utf-8',
      );

      // Create a project with installed comet skills (target)
      const projectDir = path.join(tmpDir, 'project');
      await fs.mkdir(path.join(projectDir, '.claude', 'skills', 'comet'), { recursive: true });
      await fs.writeFile(
        path.join(projectDir, '.claude', 'skills', 'comet', 'SKILL.md'),
        '# Comet\n\nExisting skill',
        'utf-8',
      );

      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        await updateCommand(projectDir, {
          skipNpm: true,
          scope: 'project',
          source: 'local',
          cometPath: cometSource,
          language: 'en',
        });
      } finally {
        log.mockRestore();
      }

      // Verify the skill was copied
      const copiedSkill = await fs.readFile(
        path.join(projectDir, '.claude', 'skills', 'comet-guard', 'SKILL.md'),
        'utf-8',
      );
      expect(copiedSkill).toContain('Test skill.');
    });

    it('passes the assets dir to the JSON output', async () => {
      const cometSource = path.join(tmpDir, 'comet-source');
      const assetsDir = path.join(cometSource, 'assets');
      await fs.mkdir(path.join(assetsDir, 'skills', 'comet-guard'), { recursive: true });
      await fs.writeFile(
        path.join(assetsDir, 'skills', 'comet-guard', 'SKILL.md'),
        '# Comet Guard\n\nTest skill.',
        'utf-8',
      );
      await fs.writeFile(
        path.join(assetsDir, 'manifest.json'),
        JSON.stringify({ skills: ['comet-guard/SKILL.md'] }),
        'utf-8',
      );

      const projectDir = path.join(tmpDir, 'project');
      await fs.mkdir(path.join(projectDir, '.claude', 'skills', 'comet'), { recursive: true });
      await fs.writeFile(
        path.join(projectDir, '.claude', 'skills', 'comet', 'SKILL.md'),
        '# Comet\n\nExisting skill',
        'utf-8',
      );

      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      let json = '';
      try {
        await updateCommand(projectDir, {
          json: true,
          skipNpm: true,
          scope: 'project',
          source: 'local',
          cometPath: cometSource,
          language: 'en',
        });
        json = log.mock.calls.map((call) => call.join(' ')).join('\n');
      } finally {
        log.mockRestore();
      }

      const result = JSON.parse(json);
      expect(result.source).toBe('local');
      expect(result.assetsDir).toBe(assetsDir);
      expect(result.skills.totalCopied).toBe(1);
    });

    it('throws an error when --comet-path is missing', async () => {
      const projectDir = path.join(tmpDir, 'project');
      await fs.mkdir(path.join(projectDir, '.claude', 'skills', 'comet'), { recursive: true });
      await fs.writeFile(
        path.join(projectDir, '.claude', 'skills', 'comet', 'SKILL.md'),
        '# Comet\n\nExisting skill',
        'utf-8',
      );

      await expect(updateCommand(projectDir, { source: 'local', skipNpm: true })).rejects.toThrow(
        '--source local requires --comet-path',
      );
    });

    it('throws an error when the comet path has no assets directory', async () => {
      const emptyDir = path.join(tmpDir, 'empty');
      await fs.mkdir(emptyDir, { recursive: true });

      const projectDir = path.join(tmpDir, 'project');
      await fs.mkdir(path.join(projectDir, '.claude', 'skills', 'comet'), { recursive: true });
      await fs.writeFile(
        path.join(projectDir, '.claude', 'skills', 'comet', 'SKILL.md'),
        '# Comet\n\nExisting skill',
        'utf-8',
      );

      await expect(
        updateCommand(projectDir, {
          source: 'local',
          cometPath: emptyDir,
          skipNpm: true,
        }),
      ).rejects.toThrow('Assets directory not found');
    });
  });

  it('prints structured JSON when requested', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'),
      '# Comet\n\nUse this skill.',
      'utf-8',
    );

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json = '';
    try {
      await updateCommand(tmpDir, { json: true, skipNpm: true });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    const result = JSON.parse(json);
    expect(result.npm.scope).toBe('skipped');
    expect(result.skills.totalCopied).toBeGreaterThan(0);
    expect(result.skills.targets[0]).toMatchObject({
      scope: 'project',
      platform: 'claude',
      language: 'en',
      source: 'skills',
    });
  });
});
