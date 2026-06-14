import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';
import { select } from '@inquirer/prompts';
import { fileExists, readDir, readJson } from '../utils/file-system.js';
import { getBaseDir } from '../core/detect.js';
import {
  copyCometSkillsForPlatform,
  copyCometRulesForPlatform,
  installCometHooksForPlatform,
  getManifestSkills,
} from '../core/skills.js';
import { PLATFORMS, getPlatformSkillsDir, type Platform } from '../core/platforms.js';
import { installCodegraph } from '../core/codegraph.js';
import type { InstallScope } from '../core/types.js';
import { printVersionInfo } from '../core/version.js';

const PACKAGE_NAME = '@rpamis/comet';
const OFFICIAL_REGISTRY = 'https://registry.npmjs.org';

type UpdateSource = 'npm' | 'github' | 'local';

interface UpdateOptions {
  json?: boolean;
  language?: string;
  scope?: InstallScope;
  skipNpm?: boolean;
  source?: UpdateSource;
  cometPath?: string;
  repo?: string;
}

type SkillLanguage = 'en' | 'zh';

interface InstalledCometTarget {
  scope: InstallScope;
  platform: Platform;
  language: SkillLanguage;
}

interface DetectTargetsOptions {
  scopes?: InstallScope[];
  globalBaseDir?: string;
}

function languageToSkillsDir(language: string | undefined, fallback: SkillLanguage): string {
  return (language ?? fallback) === 'zh' ? 'skills-zh' : 'skills';
}

function getScopedBaseDir(
  scope: InstallScope,
  projectPath: string,
  globalBaseDir = os.homedir(),
): string {
  return scope === 'global' ? globalBaseDir : projectPath;
}

function getInstalledCometSkillsDirs(
  baseDir: string,
  platform: Platform,
  scope: InstallScope = 'project',
): string[] {
  const dirs = [path.join(baseDir, getPlatformSkillsDir(platform, scope), 'skills')];
  if (scope === 'global' && platform.id === 'pi') {
    dirs.push(path.join(baseDir, platform.skillsDir, 'skills'));
  }
  return [...new Set(dirs)];
}

async function hasLocalCometSkills(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
): Promise<boolean> {
  for (const skillsDir of getInstalledCometSkillsDirs(baseDir, platform, scope)) {
    if (!(await fileExists(skillsDir))) continue;
    const entries = await readDir(skillsDir);
    if (entries.some((entry) => entry.startsWith('comet'))) return true;
  }
  return false;
}

async function detectInstalledCometLanguage(
  baseDir: string,
  platform: Platform,
  scope: InstallScope = 'project',
): Promise<SkillLanguage> {
  for (const skillsDir of getInstalledCometSkillsDirs(baseDir, platform, scope)) {
    if (!(await fileExists(skillsDir))) continue;
    const entries = (await readDir(skillsDir)).filter((entry) => entry.startsWith('comet'));

    for (const entry of entries) {
      const skillPath = path.join(skillsDir, entry, 'SKILL.md');
      if (!(await fileExists(skillPath))) continue;

      try {
        const content = await fs.readFile(skillPath, 'utf-8');
        if (/[\u3400-\u9fff]/u.test(content)) return 'zh';
      } catch {
        // Fall through to the default English asset set if the file cannot be read.
      }
    }
  }

  return 'en';
}

async function detectInstalledCometTargets(
  projectPath: string,
  options: DetectTargetsOptions = {},
): Promise<InstalledCometTarget[]> {
  const scopes = options.scopes ?? (['project', 'global'] as InstallScope[]);
  const targets: InstalledCometTarget[] = [];

  for (const scope of scopes) {
    const baseDir = getScopedBaseDir(scope, projectPath, options.globalBaseDir);

    for (const platform of PLATFORMS) {
      if (!(await hasLocalCometSkills(baseDir, platform, scope))) continue;

      targets.push({
        scope,
        platform,
        language: await detectInstalledCometLanguage(baseDir, platform, scope),
      });
    }
  }

  return targets;
}

function isSameOrInside(childPath: string, parentPath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function detectCometPackageScope(
  projectPath: string,
  packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'),
): Promise<InstallScope> {
  const localPackageRoot = path.join(projectPath, 'node_modules', '@rpamis', 'comet');
  if (isSameOrInside(packageRoot, localPackageRoot)) return 'project';

  const packageJsonPath = path.join(projectPath, 'package.json');
  if (await fileExists(packageJsonPath)) {
    const pkg = await readJson<{
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    }>(packageJsonPath);

    if (
      pkg.dependencies?.[PACKAGE_NAME] ||
      pkg.devDependencies?.[PACKAGE_NAME] ||
      pkg.optionalDependencies?.[PACKAGE_NAME]
    ) {
      return 'project';
    }
  }

  return 'global';
}

function buildNpmUpdateArgs(scope: InstallScope): string[] {
  return scope === 'global'
    ? ['install', '-g', `${PACKAGE_NAME}@latest`, '--registry', OFFICIAL_REGISTRY]
    : ['install', `${PACKAGE_NAME}@latest`, '--registry', OFFICIAL_REGISTRY];
}

function formatNpmUpdateCommand(scope: InstallScope): string {
  return ['npm', ...buildNpmUpdateArgs(scope)].join(' ');
}

function formatSkillUpdateCommand(
  scope: InstallScope,
  platform: Platform,
  languageSkillsDir: string,
): string {
  const destPrefix = scope === 'global' ? '~/' : '';
  return `copy assets/${languageSkillsDir} -> ${destPrefix}${getPlatformSkillsDir(platform, scope)}/skills/ (${scope})`;
}

function getNpmExecutable(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

async function updateCometNpmPackage(
  scope: InstallScope,
  projectPath: string,
  log: (message: string) => void,
  jsonMode = false,
): Promise<boolean> {
  const args = buildNpmUpdateArgs(scope);
  const cwd = scope === 'global' ? process.cwd() : projectPath;

  return new Promise((resolve) => {
    // In JSON mode, discard npm's stdout/stderr so it cannot corrupt the JSON
    // document emitted on stdout. 'ignore' avoids the pipe backpressure a
    // verbose npm install could otherwise cause.
    const child = spawn(getNpmExecutable(), args, {
      cwd,
      stdio: jsonMode ? 'ignore' : 'inherit',
      shell: true,
    });
    child.on('error', (err) => {
      log(`  npm package: failed to launch npm — ${err.message}`);
      resolve(false);
    });
    child.on('exit', (code) => {
      if (code !== 0) {
        log(
          `  npm package: update failed (exit code ${code}). Unable to reach the official npm registry at ${OFFICIAL_REGISTRY}.`,
        );
        log(`  Check your network connection or firewall settings and try again.`);
      }
      resolve(code === 0);
    });
  });
}

export async function updateCommand(
  targetPath: string,
  options: UpdateOptions = {},
): Promise<void> {
  const projectPath = path.resolve(targetPath);
  const log = options.json ? () => undefined : console.log;

  log(`\n  Comet Update`);
  if (!options.json) {
    await printVersionInfo(log);
  }
  log('');

  const source = options.source ?? 'npm';
  const packageScope: InstallScope =
    source === 'npm' ? (options.scope ?? (await detectCometPackageScope(projectPath))) : 'global';

  // --- Resolve assets directory based on source ---
  let assetsDir: string | undefined;
  let npmStatus: 'updated' | 'failed' | 'skipped' = 'skipped';
  let gitStatus: 'pulled' | 'cloned' | 'failed' | 'skipped' = 'skipped';

  if (source === 'npm') {
    if (!options.skipNpm) {
      log(`  Updating npm package (${packageScope} scope)...`);
      log(`    $ ${formatNpmUpdateCommand(packageScope)}`);
      const npmUpdated = await updateCometNpmPackage(packageScope, projectPath);
      if (npmUpdated) {
        npmStatus = 'updated';
        log(`  npm package: updated to latest ${PACKAGE_NAME}`);
      } else {
        npmStatus = 'failed';
        log(`  npm package: update failed, continuing with bundled skills`);
      }
    } else {
      npmStatus = 'skipped';
    }
    // assetsDir stays undefined → uses default (bundled package assets)
  } else if (source === 'local') {
    npmStatus = 'skipped';
    if (!options.cometPath) {
      throw new Error('--source local requires --comet-path <path> pointing to your comet fork');
    }
    const resolvedCometPath = path.resolve(options.cometPath);
    assetsDir = path.join(resolvedCometPath, 'assets');
    if (!(await fileExists(assetsDir))) {
      throw new Error(`Assets directory not found at ${assetsDir}. Verify --comet-path points to a valid comet fork.`);
    }
    log(`  Using local source: ${resolvedCometPath}/`);
  } else if (source === 'github') {
    npmStatus = 'skipped';
    const repoUrl = options.repo ?? (await detectRepoUrl(options.cometPath));
    if (!repoUrl) {
      throw new Error(
        '--source github requires a repo URL. Provide --repo <url> or add a "repository" field to comet package.json.',
      );
    }
    const repoName = repoUrl.replace(/^.*[\/]/, '').replace(/\.git$/, '');
    const cacheDir = path.join(os.homedir(), '.comet', 'repo', repoName);
    assetsDir = path.join(cacheDir, 'assets');

    gitStatus = await syncGitRepo(repoUrl, cacheDir);
    if (gitStatus === 'failed') {
      throw new Error(`Failed to clone/pull from ${repoUrl}`);
    }
    log(`  GitHub source: ${repoUrl} → ${cacheDir}`);
    log(`    Status: ${gitStatus}`);
  }

  const targets = await detectInstalledCometTargets(projectPath, {
    scopes: options.scope ? [options.scope] : undefined,
  });

  if (targets.length === 0) {
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            source,
            npm: {
              scope: options.skipNpm ? 'skipped' : (options.scope ?? 'unknown'),
              status: npmStatus,
              command: options.skipNpm ? null : formatNpmUpdateCommand(options.scope ?? 'global'),
            },
            git: { status: gitStatus },
            assetsDir: assetsDir ?? '(default)',
            skills: { totalCopied: 0, targets: [] },
            rules: { totalCopied: 0 },
            hooks: { totalInstalled: 0 },
            codegraph: 'skipped',
          },
          null,
          2,
        ),
      );
      return;
    }
    log('\n  No platforms with comet skills installed. Run `comet init` first.\n');
    return;
  }

  log(`\n  Updating comet skills on ${targets.length} installed target(s):`);
  for (const target of targets) {
    const language = options.language ?? target.language;
    const scopeLabel = target.scope === 'global' ? 'global' : `project (${projectPath})`;
    const languageSkillsDir = languageToSkillsDir(options.language, target.language);
    log(`    - ${target.platform.name} (${scopeLabel}, ${language})`);
    log(`      $ ${formatSkillUpdateCommand(target.scope, target.platform, languageSkillsDir)}`);
  }

  // Copy skills for each platform (overwrite)
  log(`\n  Copying ${(await getManifestSkills(assetsDir)).length} skill files...\n`);

  let totalCopied = 0;
  let totalRulesCopied = 0;
  let totalHooksInstalled = 0;
  const targetResults = [];
  for (const target of targets) {
    const baseDir = getBaseDir(target.scope, projectPath);
    const languageSkillsDir = languageToSkillsDir(options.language, target.language);
    const { copied, skipped } = await copyCometSkillsForPlatform(
      baseDir,
      target.platform,
      true,
      languageSkillsDir,
      target.scope,
      assetsDir,
    );
    totalCopied += copied;
    targetResults.push({
      scope: target.scope,
      platform: target.platform.id,
      platformName: target.platform.name,
      language: options.language ?? target.language,
      source: languageSkillsDir,
      copied,
      skipped,
      command: formatSkillUpdateCommand(target.scope, target.platform, languageSkillsDir),
    });
    log(
      `  ${target.platform.name} (${target.scope}, ${languageSkillsDir}): ${copied} copied, ${skipped} skipped`,
    );

    // Distribute anti-drift rules to platforms that support them
    try {
      const { copied: ruleCopied } = await copyCometRulesForPlatform(
        baseDir,
        target.platform,
        true,
        target.scope,
        assetsDir,
      );
      totalRulesCopied += ruleCopied;
      if (ruleCopied > 0) {
        log(`  Comet rules -> ${target.platform.name}: ${ruleCopied} rule(s) updated`);
      }
    } catch (err) {
      log(`  Comet rules -> ${target.platform.name}: failed (${(err as Error).message})`);
    }

    // Install hooks for platforms that support them
    if (target.platform.supportsHooks) {
      try {
        const { installed, reason } = await installCometHooksForPlatform(
          baseDir,
          target.platform,
          target.scope,
          assetsDir,
        );
        if (installed) {
          totalHooksInstalled++;
          log(`  Comet hooks -> ${target.platform.name}: phase guard hook updated`);
        } else if (reason) {
          log(`  Comet hooks -> ${target.platform.name}: skipped (${reason})`);
        }
      } catch (err) {
        log(`  Comet hooks -> ${target.platform.name}: failed (${(err as Error).message})`);
      }
    }
  }

  // CodeGraph optional step
  let codegraphStatus: 'installed' | 'failed' | 'skipped' = 'skipped';
  const primaryScope = targets[0]?.scope ?? 'project';

  if (!options.json) {
    const shouldInstallCodegraph = await select({
      message: 'Install/update CodeGraph for semantic code intelligence?',
      choices: [
        { name: 'Yes (recommended — saves ~16% cost · cuts ~58% tool calls)', value: true },
        { name: 'No', value: false },
      ],
    });

    if (shouldInstallCodegraph) {
      log('\n  Installing CodeGraph...');
      codegraphStatus = await installCodegraph(projectPath, primaryScope);
      log(`  CodeGraph: ${codegraphStatus}`);
    } else {
      log('\n  CodeGraph: skipped');
    }
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          source,
          npm: {
            scope: options.skipNpm ? 'skipped' : (packageScope ?? 'unknown'),
            status: npmStatus,
            command: options.skipNpm ? null : formatNpmUpdateCommand(packageScope ?? 'global'),
          },
          git: { status: gitStatus },
          assetsDir: assetsDir ?? '(default)',
          skills: {
            totalCopied,
            targets: targetResults,
          },
          rules: { totalCopied: totalRulesCopied },
          hooks: { totalInstalled: totalHooksInstalled },
          codegraph: codegraphStatus,
        },
        null,
        2,
      ),
    );
    return;
  }

  const languages = [...new Set(targetResults.map((target) => target.language))].join(', ');
  const scopes = [...new Set(targetResults.map((target) => target.scope))].join(', ');
  log(`\n  Summary:`);
  log(`    source: ${source}${source !== 'npm' ? ` (assets: ${assetsDir})` : ''}`);
  log(`    npm: ${npmStatus}`);
  log(`    git: ${gitStatus}`);
  log(`    skills: ${targets.length} target(s), ${totalCopied} files updated`);
  log(`    codegraph: ${codegraphStatus}`);
  log(`    scope: ${scopes}`);
  log(`    language: ${languages}`);
  log(`\n  Update complete.\n`);
}

/**
 * Detect the GitHub repo URL from comet's package.json `repository` field.
 * If cometPath is provided, reads from that path; otherwise reads from the
 * installed npm package's package.json.
 */
async function detectRepoUrl(cometPath?: string): Promise<string | undefined> {
  const pkgPath = cometPath
    ? path.join(path.resolve(cometPath), 'package.json')
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');

  if (!(await fileExists(pkgPath))) return undefined;

  try {
    const pkg = await readJson<{ repository?: string | { url?: string; type?: string } }>(
      pkgPath,
    );
    if (!pkg.repository) return undefined;
    if (typeof pkg.repository === 'string') return pkg.repository.replace(/^git\+/,'');
    return pkg.repository.url?.replace(/^git\+/,'');
  } catch {
    return undefined;
  }
}

/**
 * Clone a git repo (if not already cloned) or pull latest.
 * Returns the status: 'cloned', 'pulled', or 'failed'.
 */
async function syncGitRepo(repoUrl: string, destDir: string): Promise<'cloned' | 'pulled' | 'failed'> {
  try {
    if (await fileExists(path.join(destDir, '.git'))) {
      execSync('git pull --ff-only', { cwd: destDir, stdio: 'pipe' });
      return 'pulled';
    }
    execSync(`git clone --depth 1 ${repoUrl} ${destDir}`, { stdio: 'pipe' });
    return 'cloned';
  } catch {
    return 'failed';
  }
}

export {
  buildNpmUpdateArgs,
  detectCometPackageScope,
  detectInstalledCometLanguage,
  detectInstalledCometTargets,
  formatNpmUpdateCommand,
  formatSkillUpdateCommand,
  detectRepoUrl,
  syncGitRepo,
};
export type { InstalledCometTarget, SkillLanguage, UpdateSource };
