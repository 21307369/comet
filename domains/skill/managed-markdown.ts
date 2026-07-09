import path from 'path';
import { promises as fs } from 'fs';
import { ensureDir, fileExists } from '../../platform/fs/file-system.js';

export interface ManagedMarkdownBlockOptions {
  tagName: string;
  content: string;
}

export interface ManagedMarkdownBlockResult {
  action: 'created' | 'appended' | 'updated' | 'unchanged' | 'removed' | 'missing';
  changed: boolean;
}

function tagPattern(tagName: string): RegExp {
  return new RegExp(`<\\/?${tagName}>`, 'g');
}

function blockPattern(tagName: string): RegExp {
  return new RegExp(`<${tagName}>\\n[\\s\\S]*?\\n</${tagName}>\\n?`, 'g');
}

function validateTagName(tagName: string): void {
  if (!/^[a-z][a-z0-9-]*$/u.test(tagName)) {
    throw new Error(`Invalid managed block tag name: ${tagName}`);
  }
}

export function renderManagedMarkdownBlock(tagName: string, content: string): string {
  validateTagName(tagName);
  return `<${tagName}>\n${content.trimEnd()}\n</${tagName}>\n`;
}

function assertSingleCompleteBlock(existing: string, tagName: string): RegExpMatchArray[] {
  const tags = [...existing.matchAll(tagPattern(tagName))];
  if (tags.length === 0) return [];
  if (tags.length !== 2) {
    throw new Error(`Cannot update ${tagName}: incomplete managed block`);
  }
  if (tags[0][0] !== `<${tagName}>` || tags[1][0] !== `</${tagName}>`) {
    throw new Error(`Cannot update ${tagName}: malformed managed block`);
  }
  const blocks = [...existing.matchAll(blockPattern(tagName))];
  if (blocks.length !== 1) {
    throw new Error(`Cannot update ${tagName}: duplicate or incomplete managed block`);
  }
  return blocks;
}

export async function mergeManagedMarkdownBlock(
  filePath: string,
  options: ManagedMarkdownBlockOptions,
): Promise<ManagedMarkdownBlockResult> {
  validateTagName(options.tagName);
  const block = renderManagedMarkdownBlock(options.tagName, options.content);

  if (!(await fileExists(filePath))) {
    await ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, block, 'utf8');
    return { action: 'created', changed: true };
  }

  const existing = await fs.readFile(filePath, 'utf8');
  const blocks = assertSingleCompleteBlock(existing, options.tagName);
  if (blocks.length === 0) {
    const separator = existing.endsWith('\n') ? '\n' : '\n\n';
    await fs.writeFile(filePath, `${existing}${separator}${block}`, 'utf8');
    return { action: 'appended', changed: true };
  }

  if (blocks[0][0] === block) {
    return { action: 'unchanged', changed: false };
  }

  await fs.writeFile(filePath, existing.replace(blockPattern(options.tagName), block), 'utf8');
  return { action: 'updated', changed: true };
}

export async function removeManagedMarkdownBlock(
  filePath: string,
  tagName: string,
): Promise<ManagedMarkdownBlockResult> {
  validateTagName(tagName);
  if (!(await fileExists(filePath))) return { action: 'missing', changed: false };
  const existing = await fs.readFile(filePath, 'utf8');
  const blocks = assertSingleCompleteBlock(existing, tagName);
  if (blocks.length === 0) return { action: 'missing', changed: false };
  const next = existing.replace(blockPattern(tagName), '').replace(/\n{3,}/gu, '\n\n');
  await fs.writeFile(filePath, next, 'utf8');
  return { action: 'removed', changed: true };
}
