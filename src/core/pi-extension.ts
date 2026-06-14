import path from 'path';
import os from 'os';
import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { fileExists, ensureDir } from '../utils/file-system.js';
import type { InstallScope } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getAssetsDir(): string {
  return path.resolve(__dirname, '..', '..', 'assets');
}

/**
 * Get the destination path for pi extension based on install scope.
 * - global: ~/.pi/agent/extensions/
 * - project: <projectPath>/.pi/extensions/
 */
function getExtensionDestPath(scope: InstallScope, projectPath: string): string {
  if (scope === 'global') {
    return path.join(os.homedir(), '.pi', 'agent', 'extensions', 'comet.ts');
  }
  return path.join(projectPath, '.pi', 'extensions', 'comet.ts');
}

async function installPiExtension(
  projectPath: string,
  scope: InstallScope = 'project',
  overwrite: boolean = false,
): Promise<{ installed: boolean; skipped: boolean; error?: string }> {
  const assetsDir = getAssetsDir();
  const sourcePath = path.join(assetsDir, 'pi-extension', 'comet.ts');
  const destPath = getExtensionDestPath(scope, projectPath);

  try {
    // Check if source exists
    if (!(await fileExists(sourcePath))) {
      return { installed: false, skipped: false, error: 'Source extension file not found' };
    }

    // Check if destination already exists
    if (!overwrite && (await fileExists(destPath))) {
      return { installed: false, skipped: true };
    }

    // Ensure destination directory exists
    await ensureDir(path.dirname(destPath));

    // Copy extension file
    const content = await readFile(sourcePath, 'utf-8');
    await writeFile(destPath, content, 'utf-8');

    return { installed: true, skipped: false };
  } catch (error) {
    return {
      installed: false,
      skipped: false,
      error: (error as Error).message,
    };
  }
}

export { installPiExtension };
