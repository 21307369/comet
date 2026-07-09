import type { ClassicCommandHandler, ClassicCommandResult } from './classic-cli.js';
import { resolveCometResumeProbe } from './classic-resume-probe.js';

function result(exitCode: number, stdout?: string, stderr?: string): ClassicCommandResult {
  return {
    exitCode,
    ...(stdout === undefined ? {} : { stdout }),
    ...(stderr === undefined ? {} : { stderr }),
  };
}

function usage(): ClassicCommandResult {
  return result(
    64,
    undefined,
    'Usage: comet-resume-probe.mjs probe <input-json>\nUsage: comet-resume-probe.mjs probe --stdin',
  );
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export const classicResumeProbeCommand: ClassicCommandHandler = async (args) => {
  const [subcommand, input] = args;
  if (subcommand !== 'probe') return usage();

  const source = input === '--stdin' ? await readStdin() : input;
  if (!source) return usage();

  try {
    const resolution = await resolveCometResumeProbe(process.cwd(), JSON.parse(source));
    return result(0, `${JSON.stringify(resolution, null, 2)}\n`);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return result(1, undefined, `Invalid JSON: ${error.message}`);
    }
    return result(1, undefined, error instanceof Error ? error.message : String(error));
  }
};
