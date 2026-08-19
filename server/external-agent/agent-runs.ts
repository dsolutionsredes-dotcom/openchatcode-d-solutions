import { createGenerationJob, getGenerationJobSnapshot } from '../plugins/generation-jobs.ts';
import { loadExternalProjectDoc } from './projects.ts';
import { createExternalEditSession, captureExternalToolActions, externalDraftContext, reviewExternalEditSession } from '../../src/agent/external-edit-session.ts';
import { runAgent } from '../../src/agent/runtime.ts';
import { getLanguageModel } from '../../src/agent/client.ts';
import { hasProviderCredentials, resolveAgentBrainProviders } from '../provider-config.ts';
import type { MediaAsset } from '../../src/editor/types.ts';
import { isExternalAgentToolAllowed, prepareExternalAgentInput } from './asset-input.ts';
import { loadExternalAgentRun, saveExternalAgentRun, type ExternalAgentRun } from './run-store.ts';
import { loadExternalConversation, saveExternalConversation, type ExternalConversation } from './conversation-store.ts';
import type { LLMMessage } from '../../src/agent/runtime.ts';
import { isExplicitPreviewRequest, previewPrompt, refreshExternalPreview } from './preview.ts';
import { installExternalAgentServerFetch } from './server-fetch.ts';

export type { ExternalAgentRun } from './run-store.ts';

export async function getExternalAgentRun(runId: string): Promise<ExternalAgentRun | undefined> {
  const run = await loadExternalAgentRun(runId);
  if (!run) return undefined;
  const withPreview = await refreshExternalPreview(run);
  const withApproval = withPreview.approvalStatus ? withPreview : withPreview.requiresApproval
    ? { ...withPreview, approvalStatus: 'pending' as const }
    : withPreview;
  const job = getGenerationJobSnapshot(runId);
  if (!job) return withApproval;
  const status = job.status;
  return status === withApproval.status ? withApproval : { ...withApproval, status, error: job.error ?? withApproval.error, updatedAt: job.updatedAt };
}

export async function createExternalAgentRun(
  projectId: string,
  message: string,
  references: unknown[],
  conversationId = `external:${projectId}`,
): Promise<ExternalAgentRun> {
  installExternalAgentServerFetch();
  const doc = await loadExternalProjectDoc(projectId);
  if (!doc) throw new Error('PROJECT_NOT_FOUND');
  const initial = createGenerationJob({ kind: 'external-agent', projectId }, async (runId, update) => {
    let run: ExternalAgentRun = {
      runId, projectId, conversationId, status: 'running', assistantText: '', proposal: null,
      requiresApproval: false, error: null, createdAt: Date.now(), updatedAt: Date.now(),
    };
    await saveExternalAgentRun(run);
    update({ progress: 10, phase: 'running' });
    let currentSession: ReturnType<typeof createExternalEditSession> | null = null;
    const prepared = prepareExternalAgentInput(message, doc.assets as MediaAsset[], references);
    const previous = await loadExternalConversation(projectId, conversationId);
    const now = Date.now();
    const conversation: ExternalConversation = previous ?? {
      projectId, conversationId, messages: [], llm: [], createdAt: now, updatedAt: now,
    };
    const appendConversation = async (llm: unknown[], assistantText: string, error?: string | null) => {
      await saveExternalConversation({
        ...conversation,
        llm,
        messages: [
          ...conversation.messages,
          { role: 'user', text: message },
          ...(assistantText ? [{ role: error ? 'error' as const : 'assistant' as const, text: assistantText }] : []),
        ],
        updatedAt: Date.now(),
      });
    };
    if (isExplicitPreviewRequest(message)) {
      run = { ...run, status: 'succeeded', previewStatus: 'awaiting-choice', assistantText: previewPrompt(), updatedAt: Date.now() };
      await saveExternalAgentRun(run);
      await appendConversation([...conversation.llm, { role: 'user', content: message }, { role: 'assistant', content: run.assistantText }], run.assistantText);
      update({ progress: 100, phase: 'awaiting-preview-choice' });
      return { assetId: runId, kind: 'image', name: 'external-agent-run', path: '', durationSeconds: 0 };
    }
    if (prepared.clarification) {
      run = { ...run, status: 'succeeded', assistantText: prepared.clarification, updatedAt: Date.now() };
      await saveExternalAgentRun(run);
      await appendConversation(conversation.llm, run.assistantText);
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
      const history = [...conversation.llm, { role: 'user' as const, content }] as LLMMessage[];
      const resultMessages = await runAgent(history, draftContext, (event) => {
      if (event.type === 'text-delta') run.assistantText += event.delta;
      if (event.type === 'tool') attemptSession = captureExternalToolActions(attemptSession, event.name, event.args as Record<string, unknown>);
      if (event.type === 'error') run.error = event.message;
      }, {
      model: getLanguageModel(config.provider, config.model, config.openAiApiMode),
      provider: config.provider,
      openAiApiMode: config.openAiApiMode,
      allowTool: isExternalAgentToolAllowed,
      });
      if (!run.error) {
        currentSession = attemptSession;
        run.providerUsed = config.provider;
        run.modelUsed = config.model;
        await appendConversation(resultMessages, run.assistantText);
        break;
      }
      if (index < configs.length - 1) {
        run.fallbackAttempts = [...(run.fallbackAttempts ?? []), { provider: config.provider, model: config.model }];
      }
    }
    if (run.error) throw new Error(run.error);
    if (currentSession?.operationCount) {
      const reviewed = reviewExternalEditSession(currentSession, run.assistantText);
      run = { ...run, proposal: reviewed.proposal, requiresApproval: true, approvalStatus: 'pending' };
    }
    run = { ...run, status: 'succeeded', updatedAt: Date.now() };
    await saveExternalAgentRun(run);
    update({ progress: 100, phase: 'completed' });
    return { assetId: runId, kind: 'image', name: 'external-agent-run', path: '', durationSeconds: 0 };
  });
  const run: ExternalAgentRun = {
    runId: initial.jobId, projectId, conversationId, status: 'queued', assistantText: '', proposal: null,
    requiresApproval: false, error: null, createdAt: Date.now(), updatedAt: Date.now(),
  };
  await saveExternalAgentRun(run);
  return run;
}
