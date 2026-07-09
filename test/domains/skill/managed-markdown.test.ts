import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  mergeManagedMarkdownBlock,
  removeManagedMarkdownBlock,
} from '../../../domains/skill/managed-markdown.js';

let tmpDir: string;
let filePath: string;

describe('managed markdown blocks', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-managed-md-'));
    filePath = path.join(tmpDir, 'AGENTS.md');
  });

  it('creates a missing file with one managed block', async () => {
    const result = await mergeManagedMarkdownBlock(filePath, {
      tagName: 'comet-ambient-resume',
      content: 'body\n',
    });

    expect(result.action).toBe('created');
    expect(await fs.readFile(filePath, 'utf8')).toBe(
      '<comet-ambient-resume>\nbody\n</comet-ambient-resume>\n',
    );
  });

  it('appends a managed block without changing user content', async () => {
    await fs.writeFile(filePath, '# User Rules\n\nKeep this.\n', 'utf8');

    await mergeManagedMarkdownBlock(filePath, {
      tagName: 'comet-ambient-resume',
      content: 'body\n',
    });

    expect(await fs.readFile(filePath, 'utf8')).toBe(
      '# User Rules\n\nKeep this.\n\n<comet-ambient-resume>\nbody\n</comet-ambient-resume>\n',
    );
  });

  it('replaces only the managed block', async () => {
    await fs.writeFile(
      filePath,
      'before\n\n<comet-ambient-resume>\nold\n</comet-ambient-resume>\n\nafter\n',
      'utf8',
    );

    await mergeManagedMarkdownBlock(filePath, {
      tagName: 'comet-ambient-resume',
      content: 'new\n',
    });

    expect(await fs.readFile(filePath, 'utf8')).toBe(
      'before\n\n<comet-ambient-resume>\nnew\n</comet-ambient-resume>\n\nafter\n',
    );
  });

  it('rejects incomplete blocks', async () => {
    await fs.writeFile(filePath, '<comet-ambient-resume>\nbody\n', 'utf8');

    await expect(
      mergeManagedMarkdownBlock(filePath, {
        tagName: 'comet-ambient-resume',
        content: 'new\n',
      }),
    ).rejects.toThrow(/incomplete managed block/);
  });

  it('removes only the managed block', async () => {
    await fs.writeFile(
      filePath,
      'before\n\n<comet-ambient-resume>\nbody\n</comet-ambient-resume>\n\nafter\n',
      'utf8',
    );

    const result = await removeManagedMarkdownBlock(filePath, 'comet-ambient-resume');

    expect(result.action).toBe('removed');
    expect(await fs.readFile(filePath, 'utf8')).toBe('before\n\nafter\n');
  });
});
