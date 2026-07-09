import path from 'path';
import { promises as fs } from 'fs';
import { fileExists, readDir } from '../../platform/fs/file-system.js';
import { inspectClassicChange, type ClassicDiagnostic } from './classic-diagnostics.js';
import { readClassicState } from './classic-store.js';

export const COMET_RESUME_PROBE_SCHEMA_VERSION = 'comet.resume_probe.v1' as const;

export type CometResumeProbeAction = 'none' | 'auto_resume' | 'ask_user' | 'out_of_scope';
export type CometResumeProbeConfidence = 'none' | 'low' | 'high';
export type CometResumeProbeEvidenceSource = 'user' | 'state' | 'repo';

export interface CometResumeProbeInput {
  schema_version: typeof COMET_RESUME_PROBE_SCHEMA_VERSION;
  utterance: string;
  locale: string;
  agent_context: {
    non_trivial_work: boolean;
    already_in_comet_flow: boolean;
  };
}

export interface CometResumeProbeEvidence {
  source: CometResumeProbeEvidenceSource;
  quote: string;
}

export interface CometResumeProbeResult {
  schema_version: typeof COMET_RESUME_PROBE_SCHEMA_VERSION;
  action: CometResumeProbeAction;
  changeName: string | null;
  phase: string | null;
  nextCommand: string | null;
  confidence: CometResumeProbeConfidence;
  reason: string;
  evidence: CometResumeProbeEvidence[];
}

interface ActiveProbeChange {
  name: string;
  workflow: string;
  phase: string;
  nextCommand: string | null;
  diagnostic: ClassicDiagnostic;
  buildPause: string | null;
  hasClassicProjection: boolean;
  verifyResult: 'pending' | 'pass' | 'fail' | null;
  text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeInput(input: unknown): CometResumeProbeInput {
  if (!isRecord(input)) {
    throw new Error('Invalid CometResumeProbeInput: input must be an object');
  }
  if (input.schema_version !== COMET_RESUME_PROBE_SCHEMA_VERSION) {
    throw new Error(
      `Invalid CometResumeProbeInput: schema_version must be ${COMET_RESUME_PROBE_SCHEMA_VERSION}`,
    );
  }
  if (typeof input.utterance !== 'string') {
    throw new Error('Invalid CometResumeProbeInput: utterance must be a string');
  }
  const context = isRecord(input.agent_context) ? input.agent_context : {};
  return {
    schema_version: COMET_RESUME_PROBE_SCHEMA_VERSION,
    utterance: input.utterance,
    locale: typeof input.locale === 'string' ? input.locale : 'unknown',
    agent_context: {
      non_trivial_work: context.non_trivial_work === true,
      already_in_comet_flow: context.already_in_comet_flow === true,
    },
  };
}

function result(
  action: CometResumeProbeAction,
  change: ActiveProbeChange | null,
  confidence: CometResumeProbeConfidence,
  reason: string,
  evidence: CometResumeProbeEvidence[] = [],
): CometResumeProbeResult {
  return {
    schema_version: COMET_RESUME_PROBE_SCHEMA_VERSION,
    action,
    changeName: change?.name ?? null,
    phase: change?.phase ?? null,
    nextCommand:
      action === 'auto_resume' || action === 'ask_user' ? (change?.nextCommand ?? null) : null,
    confidence,
    reason,
    evidence,
  };
}

async function readIfExists(filePath: string): Promise<string> {
  if (!(await fileExists(filePath))) return '';
  return fs.readFile(filePath, 'utf8');
}

async function changeSearchText(changeDir: string, classic: ActiveProbeChange): Promise<string> {
  const files = ['proposal.md', 'design.md', 'tasks.md'];
  const parts = [classic.name, classic.workflow, classic.phase];
  for (const file of files) {
    parts.push(await readIfExists(path.join(changeDir, file)));
  }
  return parts.join('\n').toLowerCase();
}

async function discoverActiveChanges(projectRoot: string): Promise<ActiveProbeChange[]> {
  const changesDir = path.join(projectRoot, 'openspec', 'changes');
  if (!(await fileExists(changesDir))) return [];

  const entries = await readDir(changesDir);
  const changes: ActiveProbeChange[] = [];
  for (const entry of entries) {
    if (entry === 'archive') continue;
    const changeDir = path.join(changesDir, entry);
    const stat = await fs.stat(changeDir).catch(() => null);
    if (!stat?.isDirectory()) continue;
    if (!(await fileExists(path.join(changeDir, '.comet.yaml')))) continue;

    const projection = await readClassicState(changeDir);
    const classic = projection.classic;
    const diagnostic = await inspectClassicChange(changeDir, entry);
    const hasClassicProjection = Boolean(classic);
    const phase = classic?.phase ?? diagnostic.phase;
    const workflow = classic?.workflow ?? diagnostic.workflow;
    if (phase === 'archive' || classic?.archived) continue;

    const change: ActiveProbeChange = {
      name: entry,
      workflow,
      phase,
      nextCommand: diagnostic.nextCommand,
      diagnostic,
      buildPause: classic?.buildPause ?? null,
      hasClassicProjection,
      verifyResult: classic?.verifyResult ?? null,
      text: '',
    };
    change.text = await changeSearchText(changeDir, change);
    changes.push(change);
  }
  return changes;
}

const RESUME_WORDS = [
  'continue',
  'resume',
  'carry on',
  'finish',
  'run it',
  'commit',
  'verify',
  'archive',
  '继续',
  '接着',
  '恢复',
  '跑完',
  '提交',
  '验证',
  '归档',
  '修刚才',
];

const QUESTION_WORDS = [
  'what',
  'why',
  'how',
  'explain',
  'summarize',
  'reliable',
  '靠谱吗',
  '是什么',
  '为什么',
  '解释',
  '总结',
  '取名',
  '命名',
];

const OPT_OUT_WORDS = [
  'do not resume',
  "don't resume",
  'without comet',
  'skip comet',
  '不要恢复',
  '不走 comet',
  '不要走 comet',
  '直接解释',
  '只回答',
];

function includesAny(text: string, words: readonly string[]): boolean {
  return words.some((word) => text.includes(word));
}

function hasDecisionPoint(change: ActiveProbeChange): boolean {
  if (!change.hasClassicProjection) return true;
  if (!change.diagnostic.valid) return true;
  if (change.phase === 'archive') return true;
  if (change.verifyResult === 'fail') return true;
  if (change.diagnostic.runtimeEval && !change.diagnostic.runtimeEval.passed) return true;
  if (change.phase !== 'build') return false;
  if (change.buildPause === 'plan-ready') return true;
  return false;
}

function relatedEvidence(utterance: string, change: ActiveProbeChange): CometResumeProbeEvidence[] {
  const text = utterance.toLowerCase();
  const evidence: CometResumeProbeEvidence[] = [];
  if (text.includes(change.name.toLowerCase())) {
    evidence.push({ source: 'user', quote: change.name });
  }
  const tokens = change.text
    .split(/[^a-zA-Z0-9_\-\u4e00-\u9fff/]+/u)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 4);
  const matched = [...new Set(tokens.filter((token) => text.includes(token)))].slice(0, 3);
  for (const token of matched) {
    evidence.push({ source: 'repo', quote: token });
  }
  return evidence;
}

export async function resolveCometResumeProbe(
  projectRoot: string,
  rawInput: unknown,
): Promise<CometResumeProbeResult> {
  const input = normalizeInput(rawInput);
  const utterance = input.utterance.trim();
  const lower = utterance.toLowerCase();

  if (input.agent_context.already_in_comet_flow) {
    return result('out_of_scope', null, 'low', 'already in Comet flow');
  }
  if (includesAny(lower, OPT_OUT_WORDS)) {
    return result('out_of_scope', null, 'low', 'user opted out of Comet resume', [
      { source: 'user', quote: utterance },
    ]);
  }

  const changes = await discoverActiveChanges(projectRoot);
  if (changes.length === 0) {
    return result('none', null, 'none', 'no active Comet changes');
  }
  if (changes.length > 1) {
    const named = changes.find((change) => lower.includes(change.name.toLowerCase()));
    if (!named) {
      return result('ask_user', null, 'low', 'multiple active changes require a change name');
    }
    return hasDecisionPoint(named)
      ? result('ask_user', named, 'low', 'active change is at a decision point')
      : result('auto_resume', named, 'high', 'request names an active change', [
          { source: 'user', quote: named.name },
        ]);
  }

  const [change] = changes;
  if (hasDecisionPoint(change)) {
    return result('ask_user', change, 'low', 'active change is at a decision point', [
      { source: 'state', quote: `phase: ${change.phase}` },
    ]);
  }

  const resumeLike = includesAny(lower, RESUME_WORDS);
  const questionLike = !input.agent_context.non_trivial_work && includesAny(lower, QUESTION_WORDS);
  if (questionLike && !resumeLike) {
    return result('out_of_scope', change, 'low', 'user asked a question without workflow work');
  }

  const evidence = relatedEvidence(utterance, change);
  if (resumeLike || evidence.length > 0) {
    return result('auto_resume', change, 'high', 'single active change and request is related', [
      { source: 'state', quote: `phase: ${change.phase}` },
      ...evidence,
    ]);
  }

  if (input.agent_context.non_trivial_work) {
    return result(
      'ask_user',
      change,
      'low',
      'single active change exists but request looks unrelated',
    );
  }

  return result('out_of_scope', change, 'low', 'request is not workflow work');
}
