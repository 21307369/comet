import { describe, expect, it } from 'vitest';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { classicResumeProbeCommand } from '../../../domains/comet-classic/classic-resume-probe-command.js';

describe('classicResumeProbeCommand', () => {
  it('prints usage for missing probe subcommand input', async () => {
    const result = await classicResumeProbeCommand([], { json: false });

    expect(result.exitCode).toBe(64);
    expect(result.stderr).toContain('Usage: comet-resume-probe.mjs probe <input-json>');
  });

  it('reports invalid JSON with exit code 1', async () => {
    const result = await classicResumeProbeCommand(['probe', '{'], { json: false });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Invalid JSON');
  });

  it('is registered in the shared Classic CLI dispatcher', async () => {
    const result = await runClassicCli(['resume-probe'], {
      'resume-probe': async () => ({ exitCode: 0, stdout: 'ok\n' }),
    });

    expect(result).toMatchObject({ exitCode: 0, stdout: 'ok\n' });
  });
});
