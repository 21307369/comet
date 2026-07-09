import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resumeProbeCommand } from '../../app/commands/resume-probe.js';

let tmpDir: string;
let output: string[];
let error: string[];

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

describe('resumeProbeCommand', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-resume-cli-'));
    output = [];
    error = [];
    vi.spyOn(console, 'log').mockImplementation((value = '') => output.push(String(value)));
    vi.spyOn(console, 'error').mockImplementation((value = '') => error.push(String(value)));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('prints JSON probe output', async () => {
    await writeFile(path.join(tmpDir, '.comet', 'config.yaml'), 'language: en\n');
    await resumeProbeCommand(tmpDir, {
      utterance: '继续',
      json: true,
      nonTrivialWork: true,
      alreadyInCometFlow: false,
    });

    expect(JSON.parse(output.join('\n'))).toMatchObject({
      schema_version: 'comet.resume_probe.v1',
      action: 'none',
    });
  });

  it('prints a compact text summary outside JSON mode', async () => {
    await writeFile(path.join(tmpDir, '.comet', 'config.yaml'), 'language: en\n');
    await resumeProbeCommand(tmpDir, {
      utterance: '继续',
      json: false,
      nonTrivialWork: true,
      alreadyInCometFlow: false,
    });

    expect(output.join('\n')).toContain('action: none');
  });
});
