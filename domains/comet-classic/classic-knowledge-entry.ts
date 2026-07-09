import { classicKnowledgeCommand } from './classic-knowledge-command.js';
import { runClassicScript } from './classic-script-entry.js';

process.exitCode = await runClassicScript(classicKnowledgeCommand);
