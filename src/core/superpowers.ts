import { execFileSync } from 'child_process';
import { homedir } from 'os';

import { printCommandErrorDetails } from './command-error.js';
import type { InstallScope } from './types.js';

/**
 * Map Comet platform IDs to superpowers-zh --tool CLI aliases.
 * null = platform not supported by superpowers-zh (will be skipped).
 * Values must match TOOL_ALIASES keys in superpowers-zh (lowercase).
 */
const SUPERPOWERS_ZH_TOOL_MAP: Record<string, string | null> = {
  claude: 'claude',
  cursor: 'cursor',
  codex: 'codex',
  opencode: 'opencode',
  windsurf: 'windsurf',
  cline: 'cline',
  roocode: 'roo',
  continue: 'continue',
  'github-copilot': 'github-copilot',
  gemini: 'gemini-cli',
  'amazon-q': 'universal',
  qwen: 'qwen-code',
  kilocode: 'kilo',
  auggie: 'augment',
  kiro: 'kiro-cli',
  kimicode: 'kimi-code-cli',
  lingma: 'lingma',
  junie: 'junie',
  codebuddy: 'codebuddy',
  costrict: 'universal',
  crush: 'crush',
  factory: 'droid',
  iflow: 'iflow-cli',
  pi: 'pi',
  qoder: 'qoder',
  antigravity: 'antigravity',
  bob: null,
  forgecode: null,
  trae: 'trae',
};

const VALID_PLATFORM_IDS = new Set(Object.keys(SUPERPOWERS_ZH_TOOL_MAP));
const SUPERPOWERS_INSTALL_TIMEOUT_MS = 300_000;
const SUPERPOWERS_SOURCE = '21307369/superpowers-zh';
const LINGMA_PLATFORM_ID = 'lingma';
const LINGMA_STAGE_AGENT = 'claude-code';

function buildSuperpowersInstallCommand(
  _projectPath: string,
  scope: InstallScope,
  platformIds: string[],
): { command: string; args: string[] } {
  const unknownIds = platformIds.filter((id) => !VALID_PLATFORM_IDS.has(id));
  if (unknownIds.length > 0) {
    throw new Error(`Unknown platform IDs: ${unknownIds.join(', ')}`);
  }

  const agentNames = [
    ...new Set(
      platformIds.map((id) => SKILLS_AGENT_MAP[id]).filter((name): name is string => Boolean(name)),
    ),
  ];

  if (agentNames.length === 0) {
    throw new Error(`No skills CLI agent names resolved for platforms: ${platformIds.join(', ')}`);
  }

  const args = ['skills', 'add', SUPERPOWERS_SOURCE, '-y'];
  if (scope === 'global') {
    args.push('-g');
  }
  for (const name of agentNames) {
    args.push('--agent', name);
  }
  return { command: getNpxExecutable(), args };
}

function buildLingmaSuperpowersStageCommand(): { command: string; args: string[] } {
  return {
    command: getNpxExecutable(),
    args: ['skills', 'add', SUPERPOWERS_SOURCE, '-y', '--agent', LINGMA_STAGE_AGENT],
  };
}

function getNpxExecutable(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'npx.cmd' : 'npx';
}

/**
 * Build a superpowers-zh install command for a single platform.
 * Returns null if the platform is not supported by superpowers-zh.
 */
function buildSuperpowersInstallCommand(
  _projectPath: string,
  _scope: InstallScope,
  platformId: string,
): { command: string; args: string[] } | null {
  if (!VALID_PLATFORM_IDS.has(platformId)) {
    throw new Error(`Unknown platform ID: ${platformId}`);
  }

  const toolName = SUPERPOWERS_ZH_TOOL_MAP[platformId];
  if (!toolName) {
    return null; // superpowers-zh doesn't support this platform
  }

  // Use the 21307369/superpowers-zh fork which has native Pi support
  const args = ['github:21307369/superpowers-zh', '--tool', toolName];
  // Add --force for global installs (superpowers-zh refuses home dir by default)
  if (_scope === 'global') {
    args.push('--force');
  }
  return { command: getNpxExecutable(), args };
}

/**
 * Install superpowers-zh for multiple platforms.
 * Runs one invocation per supported platform.
 * Returns 'skipped' if none of the selected platforms are supported.
 */
async function installSuperpowersForPlatforms(
  projectPath: string,
  scope: InstallScope,
  platformIds: string[],
): Promise<'installed' | 'failed' | 'skipped'> {
  const unknownIds = platformIds.filter((id) => !VALID_PLATFORM_IDS.has(id));
  if (unknownIds.length > 0) {
    throw new Error(`Unknown platform IDs: ${unknownIds.join(', ')}`);
  }

  const skillsCliPlatformIds = platformIds.filter(
    (id) => id !== LINGMA_PLATFORM_ID && SKILLS_AGENT_MAP[id],
  );
  const shouldInstallLingma = platformIds.includes(LINGMA_PLATFORM_ID);
  let failed = false;

  if (supportedPlatformIds.length === 0) {
    return 'skipped';
  }

  let anyInstalled = false;
  let anyFailed = false;

  for (const platformId of supportedPlatformIds) {
    const command = buildSuperpowersInstallCommand(projectPath, scope, platformId);
    if (!command) {
      continue;
    }

    try {
      execFileSync(command.command, command.args, {
        cwd: scope === 'global' ? homedir() : projectPath,
        stdio: 'inherit',
        timeout: SUPERPOWERS_INSTALL_TIMEOUT_MS,
        shell: process.platform === 'win32',
      });
      
      anyInstalled = true;
    } catch (error) {
      console.error(
        `    Superpowers install failed for ${platformId}: ${(error as Error).message}`,
      );
      printCommandErrorDetails(error);
      anyFailed = true;
    }
  }

  if (anyFailed) return 'failed';
  return anyInstalled ? 'installed' : 'skipped';
}

export {
  installSuperpowersForPlatforms,
  buildSuperpowersInstallCommand,
  SUPERPOWERS_ZH_TOOL_MAP,
};
