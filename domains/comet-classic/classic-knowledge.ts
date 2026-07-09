/**
 * CODEBASE-KNOWLEDGE.md management module.
 *
 * Provides utilities to read and write the codebase knowledge file,
 * which records historical findings like deprecated functions, dead code,
 * and known bugs to avoid repeated mistakes.
 */
import { promises as fs } from 'fs';
import path from 'path';

export const KNOWLEDGE_FILE = 'CODEBASE-KNOWLEDGE.md';

export interface KnowledgeEntry {
  date: string; // YYYY-MM-DD
  text: string; // Free-form entry text
}

/**
 * Format today's date as YYYY-MM-DD.
 */
function today(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Parse a single knowledge entry line.
 * Format: - [YYYY-MM-DD] <text>
 */
export function parseKnowledgeLine(line: string): KnowledgeEntry | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const match = trimmed.match(/^-\s*\[(\d{4}-\d{2}-\d{2})\]\s*(.+)$/u);
  if (!match) return null;

  return {
    date: match[1],
    text: match[2],
  };
}

/**
 * Parse CODEBASE-KNOWLEDGE.md content into entries.
 */
export function parseKnowledgeContent(content: string): KnowledgeEntry[] {
  const lines = content.split('\n');
  const entries: KnowledgeEntry[] = [];

  for (const line of lines) {
    const entry = parseKnowledgeLine(line);
    if (entry) entries.push(entry);
  }

  return entries;
}

/**
 * Format a knowledge entry as a markdown list line.
 */
export function formatKnowledgeEntry(entry: KnowledgeEntry): string {
  return `- [${entry.date}] ${entry.text}`;
}

/**
 * Check if two entries are duplicates (same text, ignoring date).
 */
export function isDuplicateEntry(a: KnowledgeEntry, b: KnowledgeEntry): boolean {
  return a.text.trim() === b.text.trim();
}

/**
 * Load and parse CODEBASE-KNOWLEDGE.md from the project root.
 */
export async function loadCodebaseKnowledge(projectPath: string): Promise<{
  content: string;
  entries: KnowledgeEntry[];
} | null> {
  const knowledgePath = path.join(projectPath, KNOWLEDGE_FILE);

  try {
    const content = await fs.readFile(knowledgePath, 'utf-8');
    const entries = parseKnowledgeContent(content);
    return { content, entries };
  } catch {
    return null;
  }
}

/**
 * Append a new entry to CODEBASE-KNOWLEDGE.md.
 * Deduplicates by text content (ignoring date).
 * Returns true if appended, false if duplicate was skipped.
 */
export async function appendCodebaseKnowledge(
  projectPath: string,
  entry: KnowledgeEntry,
): Promise<boolean> {
  const knowledgePath = path.join(projectPath, KNOWLEDGE_FILE);

  // Load existing entries
  const existing = await loadCodebaseKnowledge(projectPath);
  const existingEntries = existing?.entries ?? [];

  // Check for duplicate
  const isDuplicate = existingEntries.some((e) => isDuplicateEntry(e, entry));
  if (isDuplicate) {
    return false;
  }

  // Format new entry
  const newLine = formatKnowledgeEntry(entry);

  // Read existing content or create new
  let content = '';
  try {
    content = await fs.readFile(knowledgePath, 'utf-8');
  } catch {
    // File doesn't exist, create new header
    content =
      '# Codebase Knowledge\n\n' +
      'Historical findings: deprecated functions, dead code, known bugs.\n\n' +
      'Format: `- [YYYY-MM-DD] <entry>`\n\n';
  }

  // Append new entry
  const updated = content.trimEnd() + '\n' + newLine + '\n';
  await fs.writeFile(knowledgePath, updated, 'utf-8');

  return true;
}

/**
 * Search knowledge entries by keyword.
 */
export function searchKnowledge(entries: KnowledgeEntry[], keyword: string): KnowledgeEntry[] {
  const lower = keyword.toLowerCase();
  return entries.filter((e) => e.text.toLowerCase().includes(lower));
}
