/**
 * Comet knowledge command - manages CODEBASE-KNOWLEDGE.md.
 */
import type { ClassicCommandHandler, ClassicCommandResult } from './classic-cli.js';
import {
  loadCodebaseKnowledge,
  appendCodebaseKnowledge,
  searchKnowledge,
  type KnowledgeEntry,
} from './classic-knowledge.js';

const GREEN = '\u001b[32m';
const YELLOW = '\u001b[33m';
const RESET = '\u001b[0m';

function today(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function printUsage(): string {
  return `Usage: comet knowledge <command> [args]

Commands:
  get              Print knowledge entries
  search <term>    Search entries by keyword
  append <text>    Append a new entry (auto-timestamped)
  clear            Clear all entries (keeps header)

Store format: - [YYYY-MM-DD] <entry text>

Examples:
  comet knowledge get
  comet search "deprecated"
  comet append "src/utils.ts:legacyParse() — deprecated, use parseV2 instead"`;
}

export const classicKnowledgeCommand: ClassicCommandHandler = async (args, options) => {
  const [subcommand, ...subargs] = args;

  if (!subcommand) {
    return {
      exitCode: 1,
      stdout: printUsage(),
    };
  }

  const projectPath = process.env.COMET_PROJECT_PATH ?? process.cwd();

  switch (subcommand) {
    case 'get': {
      const result = await loadCodebaseKnowledge(projectPath);
      if (!result) {
        return {
          exitCode: 0,
          stdout: options.json
            ? JSON.stringify({ entries: [], message: 'No CODEBASE-KNOWLEDGE.md found' })
            : `${YELLOW}No CODEBASE-KNOWLEDGE.md found${RESET}\n`,
        };
      }

      if (options.json) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ entries: result.entries, count: result.entries.length }),
        };
      }

      const lines = result.entries.map((e) => `${GREEN}[${e.date}]${RESET} ${e.text}`);
      return {
        exitCode: 0,
        stdout: lines.length > 0 ? lines.join('\n') + '\n' : 'No entries found\n',
      };
    }

    case 'search': {
      const term = subargs[0];
      if (!term) {
        return {
          exitCode: 1,
          stderr: 'Usage: comet knowledge search <term>',
        };
      }

      const result = await loadCodebaseKnowledge(projectPath);
      if (!result) {
        return {
          exitCode: 0,
          stdout: options.json
            ? JSON.stringify({ entries: [], message: 'No CODEBASE-KNOWLEDGE.md found' })
            : `${YELLOW}No CODEBASE-KNOWLEDGE.md found${RESET}\n`,
        };
      }

      const matches = searchKnowledge(result.entries, term);
      if (options.json) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ entries: matches, count: matches.length }),
        };
      }

      const lines = matches.map((e) => `${GREEN}[${e.date}]${RESET} ${e.text}`);
      return {
        exitCode: 0,
        stdout: lines.length > 0 ? lines.join('\n') + '\n' : 'No matches found\n',
      };
    }

    case 'append': {
      const text = subargs.join(' ');
      if (!text) {
        return {
          exitCode: 1,
          stderr: 'Usage: comet knowledge append "<entry text>"',
        };
      }

      const entry: KnowledgeEntry = {
        date: today(),
        text,
      };

      const appended = await appendCodebaseKnowledge(projectPath, entry);
      if (options.json) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ appended, entry }),
        };
      }

      return {
        exitCode: 0,
        stdout: appended
          ? `${GREEN}Entry appended:${RESET} [${entry.date}] ${entry.text}\n`
          : `${YELLOW}Duplicate entry skipped${RESET}\n`,
      };
    }

    case 'clear': {
      const knowledgePath = `${projectPath}/CODEBASE-KNOWLEDGE.md`;
      try {
        const { promises: fs } = await import('fs');
        await fs.writeFile(
          knowledgePath,
          '# Codebase Knowledge\n\n' +
            'Historical findings: deprecated functions, dead code, known bugs.\n\n' +
            'Format: `- [YYYY-MM-DD] <entry>`\n\n',
          'utf-8',
        );
        return { exitCode: 0, stdout: `${GREEN}Knowledge base cleared${RESET}\n` };
      } catch {
        return { exitCode: 0, stdout: `${YELLOW}No CODEBASE-KNOWLEDGE.md to clear${RESET}\n` };
      }
    }

    default:
      return {
        exitCode: 1,
        stderr: `Unknown knowledge command: ${subcommand}\n${printUsage()}`,
      };
  }
};
