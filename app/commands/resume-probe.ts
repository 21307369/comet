import { promises as fs } from 'fs';
import path from 'path';
import {
  COMET_RESUME_PROBE_SCHEMA_VERSION,
  resolveCometResumeProbe,
  type CometResumeProbeInput,
  type CometResumeProbeResult,
} from '../../domains/comet-classic/classic-resume-probe.js';

interface ResumeProbeOptions {
  utterance?: string;
  stdin?: boolean;
  json?: boolean;
  nonTrivialWork?: boolean;
  alreadyInCometFlow?: boolean;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function formatText(result: CometResumeProbeResult): string {
  const lines = [
    `action: ${result.action}`,
    `confidence: ${result.confidence}`,
    `reason: ${result.reason}`,
  ];
  if (result.changeName) lines.push(`change: ${result.changeName}`);
  if (result.phase) lines.push(`phase: ${result.phase}`);
  if (result.nextCommand) lines.push(`next: ${result.nextCommand}`);
  return `${lines.join('\n')}\n`;
}

async function resolveUtterance(options: ResumeProbeOptions): Promise<string> {
  if (options.stdin) return readStdin();
  return options.utterance ?? '';
}

async function resolveProjectLanguage(projectPath: string): Promise<string> {
  const config = path.join(projectPath, '.comet', 'config.yaml');
  try {
    const content = await fs.readFile(config, 'utf8');
    const match = content.match(/^language:\s*(.+)$/mu);
    return match?.[1]?.trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function resumeProbeCommand(
  targetPath: string,
  options: ResumeProbeOptions = {},
): Promise<void> {
  const projectPath = path.resolve(targetPath);
  const utterance = await resolveUtterance(options);
  const input: CometResumeProbeInput = {
    schema_version: COMET_RESUME_PROBE_SCHEMA_VERSION,
    utterance,
    locale: await resolveProjectLanguage(projectPath),
    agent_context: {
      non_trivial_work: options.nonTrivialWork !== false,
      already_in_comet_flow: options.alreadyInCometFlow === true,
    },
  };
  const result = await resolveCometResumeProbe(projectPath, input);
  console.log(options.json ? JSON.stringify(result, null, 2) : formatText(result));
}
