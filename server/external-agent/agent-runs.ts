import { readStore, setStoredEntry } from '../plugins/project-store.ts';
import { createGenerationJob, getGenerationJobSnapshot } from '../plugins/generation-jobs.ts';
import { loadExternalProjectDoc } from './projects.ts';
import { createExternalEditSession, captureExternalToolActions, externalDraftContext, reviewExternalEditSession } from '../../src/agent/external-edit-session.ts';
import { runAgent } from '../../src/agent/runtime.ts';
import { getLanguageModel } from '../../src/agent/client.ts';
import { hasProviderCredentials, resolveAgentBrainProviders } from '../provider-config.ts';
import type { MediaAsset } from '../../src/editor/types.ts';
import { isExternalAgentToolAllowed, prepareExternalAgentInput } from './asset-input.ts';

const RUNS_KEY = 'jobs:agent-runs';

export interface ExternalAgentRun {
  runId: string;
  projectId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  assistantText: string;
  proposal: unknown | null;
  requiresApproval: boolean;
  error: string | null;
  providerUsed?: string;
  modelUsed?: string;
  fallbackAttempts?: Array<{ provider: string; model: string }>;
  createdAt: number;
  updatedAt: number;
}

function isRun(value: unknown): value is ExternalAgentRun {
  if (!value || typeof value !== 'object') return false;
  const run = value as Partial<ExternalAgentRun>;
  return typeof run.runId === 'string' && typeof run.projectId === 'string'
    && (run.status === 'queued' || run.status === 'running' || run.status === 'succeeded' || run.status === 'failed')
    && typeof run.assistantText === 'string' && typeof run.requiresApproval === 'boolean'
    && (run.error === null || typeof run.error === 'string')
    && typeof run.createdAt === 'number' && typeof run.updatedAt === 'number';
}

async function saveRun(run: ExternalAgentRun): Promise<void> {
  const store = await readStore();
  const runs = Array.isArray(store.entries[RUNS_KEY]) ? store.entries[RUNS_KEY].filter(isRun) : [];
  await setStoredEntry(RUNS_KEY, [run, ...runs.filter((item) => item.runId !== run.runId)]);
}

export async function getExternalAgentRun(runId: string): Promise<ExternalAgentRun | undefined> {
  const store = await readStore();
  const run = Array.isArray(store.entries[RUNS_KEY])
    ? store.entries[RUNS_KEY].filter(isRun).find((item) => item.runId === runId)
    : undefined;
  if (!run) return undefined;
  const job = getGenerationJobSnapshot(runId);
  if (!job) return run;
  const status = job.status;
  return status === run.status ? run : { ...run, status, error: job.error ?? run.error, updatedAt: job.updatedAt };
}

export async function createExternalAgentRun(
  projectId: string,
  message: string,
  references: unknown[],
): Promise<ExternalAgentRun> {
  const doc = await loadExternalProjectDoc(projectId);
  if (!doc) throw new Error('PROJECT_NOT_FOUND');
  const initial = createGenerationJob({ kind: 'external-agent', projectId }, async (runId, update) => {
    let run: ExternalAgentRun = {
      runId, projectId, status: 'running', assistantText: '', proposal: null,
      requiresApproval: false, error: null, createdAt: Date.now(), updatedAt: Date.now(),
    };
    await saveRun(run);
    update({ progress: 10, phase: 'running' });
    let currentSession: ReturnType<typeof createExternalEditSession> | null = null;
    const prepared = prepareExternalAgentInput(message, doc.assets as MediaAsset[], references);
    if (prepared.clarification) {
      run = { ...run, status: 'succeeded', assistantText: prepared.clarification, updatedAt: Date.now() };
      await saveRun(run);
      update({ progress: 100, phase: 'completed' });
      return { assetId: runId, kind: 'image', name: 'external-agent-run', path: '', durationSeconds: 0 };
    }
    const content = prepared.content!;
    const selected = resolveAgentBrainProviders();
    if (!selected.selected) throw new Error('AGENT_PROVIDER_NOT_SELECTED');
    const configs = selected.configs.filter(hasProviderCredentials);
    if (!configs.length) throw new Error('LLM_NOT_CONFIGURED');
    for (const [index, config] of configs.entries()) {
      run.error = null;
      run.assistantText = '';
      const session = createExternalEditSession(doc, 'External Agent', 'manual');
      const live = {
        commands: session.draft!.commands, getState: session.draft!.getState, getDoc: session.draft!.getDoc,
        getCreativeMode: () => null, templates: [], audio: [], getProjectId: () => projectId,
      };
      const draftContext = externalDraftContext(session, live);
      let attemptSession = session;
      await runAgent([{ role: 'user', content }], draftContext, (event) => {
      if (event.type === 'text-delta') run.assistantText += event.delta;
      if (event.type === 'tool') attemptSession = captureExternalToolActions(attemptSession, event.name, event.args as Record<string, unknown>);
      if (event.type === 'error') run.error = event.message;
      }, {
      model: getLanguageModel(config.provider, config.model, config.openAiApiMode),
      provider: config.provider,
      openAiApiMode: config.openAiApiMode,
      allowTool: isExternalAgentToolAllowed,
      });
      if (!run.error) { currentSession = attemptSession; run.providerUsed = config.provider; run.modelUsed = config.model; break; }
      if (index < configs.length - 1) {
        run.fallbackAttempts = [...(run.fallbackAttempts ?? []), { provider: config.provider, model: config.model }];
      }
    }
    if (run.error) throw new Error(run.error);
    if (currentSession?.operationCount) {
      const reviewed = reviewExternalEditSession(currentSession, run.assistantText);
      run = { ...run, proposal: reviewed.proposal, requiresApproval: true };
      await setStoredEntry(`proposal:${projectId}`, reviewed.proposal);
    }
    run = { ...run, status: 'succeeded', updatedAt: Date.now() };
    await saveRun(run);
    update({ progress: 100, phase: 'completed' });
    return { assetId: runId, kind: 'image', name: 'external-agent-run', path: '', durationSeconds: 0 };
  });
  const run: ExternalAgentRun = {
    runId: initial.jobId, projectId, status: 'queued', assistantText: '', proposal: null,
    requiresApproval: false, error: null, createdAt: Date.now(), updatedAt: Date.now(),
  };
  await saveRun(run);
  return run;
}
