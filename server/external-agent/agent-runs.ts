import { readStore, setStoredEntry } from '../plugins/project-store.ts';
import { createGenerationJob, getGenerationJobSnapshot } from '../plugins/generation-jobs.ts';
import { loadExternalProjectDoc } from './projects.ts';
import { createExternalEditSession, captureExternalToolActions, externalDraftContext, reviewExternalEditSession } from '../../src/agent/external-edit-session.ts';
import { runAgent } from '../../src/agent/runtime.ts';
import { getLanguageModel } from '../../src/agent/client.ts';
import { hasProviderCredentials, resolveProviderConfig } from '../provider-config.ts';

const RUNS_KEY = 'jobs:agent-runs';

export interface ExternalAgentRun {
  runId: string;
  projectId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  assistantText: string;
  proposal: unknown | null;
  requiresApproval: boolean;
  error: string | null;
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

const SERVER_SAFE_TOOLS = new Set([
  'read_timeline', 'set_aspect_ratio', 'move_item', 'set_item_timing', 'duplicate_item',
  'remove_item', 'split_item', 'clear_timeline', 'update_item_props', 'edit_item',
  'edit_track', 'manage_timelines', 'manage_media_pool', 'edit_project', 'edit_captions',
]);

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
    const config = resolveProviderConfig({ category: 'agent-brain' });
    if (!hasProviderCredentials(config)) throw new Error('LLM_NOT_CONFIGURED');
    const session = createExternalEditSession(doc, 'External Agent', 'manual');
    const live = {
      commands: session.draft!.commands, getState: session.draft!.getState, getDoc: session.draft!.getDoc,
      getCreativeMode: () => null, templates: [], audio: [], getProjectId: () => projectId,
    };
    const draftContext = externalDraftContext(session, live);
    let currentSession = session;
    const content = references.length ? `${message}\n\n${JSON.stringify({ type: 'chat_context_entry', entries: references })}` : message;
    await runAgent([{ role: 'user', content }], draftContext, (event) => {
      if (event.type === 'text-delta') run.assistantText += event.delta;
      if (event.type === 'tool') currentSession = captureExternalToolActions(currentSession, event.name, event.args as Record<string, unknown>);
      if (event.type === 'error') run.error = event.message;
    }, {
      model: getLanguageModel(config.provider, config.model, config.openAiApiMode),
      provider: config.provider,
      openAiApiMode: config.openAiApiMode,
      allowTool: (name: string) => SERVER_SAFE_TOOLS.has(name),
    });
    if (run.error) throw new Error(run.error);
    if (currentSession.operationCount) {
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
