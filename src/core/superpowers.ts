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
  cline: null,
  roocode: null,
  continue: null,
  'github-copilot': 'vscode',
  gemini: 'gemini',
  'amazon-q': null,
  qwen: 'qwen',
  kilocode: null,
  auggie: null,
  kiro: 'kiro',
  lingma: null,
  junie: null,
  codebuddy: null,
  costrict: null,
  crush: null,
  factory: null,
  iflow: null,
  pi: 'pi',
  qoder: 'qoder',
  antigravity: 'antigravity',
  bob: null,
  forgecode: null,
  trae: 'trae',
};

const VALID_PLATFORM_IDS = new Set(Object.keys(SUPERPOWERS_ZH_TOOL_MAP));
const SUPERPOWERS_INSTALL_TIMEOUT_MS = 300_000;

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

  // Filter to platforms that superpowers-zh supports
  const supportedPlatformIds = platformIds.filter((id) => SUPERPOWERS_ZH_TOOL_MAP[id] !== null);

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
