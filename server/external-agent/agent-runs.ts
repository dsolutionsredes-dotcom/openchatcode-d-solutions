import { createGenerationJob, getGenerationJobSnapshot } from '../plugins/generation-jobs.ts';
import { loadExternalProjectDoc } from './projects.ts';
import { createExternalEditSession, captureExternalToolActions, externalDraftContext, reviewExternalEditSession } from '../../src/agent/external-edit-session.ts';
import { runAgent } from '../../src/agent/runtime.ts';
import { getLanguageModel } from '../../src/agent/client.ts';
import { hasProviderCredentials, resolveAgentBrainProviders } from '../provider-config.ts';
import type { MediaAsset } from '../../src/editor/types.ts';
import { replayActions } from '../../src/editor/store.ts';
import { buildProposal, isProposalStale, type Proposal } from '../../src/agent/proposal.ts';
import { isExternalAgentToolAllowed, prepareExternalAgentInput } from './asset-input.ts';
import {
  loadExternalAgentRun,
  loadLatestExternalDraftRun,
  saveExternalAgentRun,
  supersedeExternalAgentRun,
  type ExternalAgentRun,
} from './run-store.ts';
import { loadExternalConversation, saveExternalConversation, type ExternalConversation } from './conversation-store.ts';
import type { LLMMessage } from '../../src/agent/runtime.ts';
import { isExplicitPreviewRequest, previewPrompt, refreshExternalPreview } from './preview.ts';
import { installExternalAgentServerFetch } from './server-fetch.ts';
import { applyLiveCaps, applyLiveKeyStatus, applyLiveModels } from '../../src/agent/capabilities.ts';
import { keyStatus } from '../keystore.ts';

export type { ExternalAgentRun } from './run-store.ts';

const EXTERNAL_AGENT_SYSTEM_SUFFIX = `
# AUTO_EDITOR / modo servidor
Estás ejecutándose como el agente de OpenChatCut detrás de AUTO_EDITOR mediante API externa.

Reglas obligatorias específicas de este modo:
- Conserva el comportamiento conversacional y el estilo de respuesta del agente original de OpenChatCut. No impongas una longitud, resumen o formato especial distinto del SYSTEM_PROMPT base solo por estar en modo externo.
- No pidas confirmación para cada herramienta o subpaso. AUTO_EDITOR gestiona una única propuesta/aprobación para las operaciones de una misma instrucción.
- Usa únicamente las herramientas disponibles en esta ejecución. Nunca inventes capacidades, transiciones, efectos, plantillas, fuentes ni opciones del editor.
- Cuando el usuario pregunte qué transiciones, efectos, zooms, audio-fx o recursos existen, consulta browse_library y responde únicamente con resultados reales.
- Para obtener una lista, usa browse_library en modo list (category + group o query), no te quedes en el overview. Para transiciones: category="transitions", group="transitions".
- Si una capacidad no aparece entre las herramientas disponibles de esta ejecución, informa que no está habilitada en el modo servidor de AUTO_EDITOR. No finjas que fue ejecutada.
- No recomiendes programas o servicios externos salvo que el usuario lo pida explícitamente.
- Si una herramienta devuelve error, informa el error real y no inventes que la acción se completó.
`.trim();

function syncExternalAgentCapabilities(): void {
  const status = keyStatus();
  applyLiveCaps(status.caps);
  applyLiveKeyStatus(status.keys);
  applyLiveModels(status.models);
}

function proposalOperations(proposal: Proposal) {
  return proposal.options[0]?.operations ?? [];
}

function draftDocFromProposal(proposal: Proposal) {
  return replayActions(
    proposal.baseDoc,
    proposalOperations(proposal).flatMap((operation) => operation.actions),
  );
}

/**
 * Make the external response agree with the pending proposal state.
 *
 * A model summary can describe the draft as if it were already applied. Do
 * not try to correct individual verbs here: the proposal state is the source
 * of truth, so pending edits receive a neutral status message for every kind
 * of operation.
 */
function pendingApprovalText(operationCount: number): string {
  const noun = operationCount === 1 ? 'un cambio' : `${operationCount} cambios`;
  return `He preparado una propuesta con ${noun}. Todavía no se ha aplicado.\n\n¿Quieres aprobarla o prefieres rechazarla?`;
}

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
  syncExternalAgentCapabilities();

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
    const pendingDraft = await loadLatestExternalDraftRun(projectId, conversationId, runId);

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

    /*
     * Preview is a continuation of the current draft, not a render of the old
     * persisted project. We create a new preview run that owns the same proposal,
     * then supersede the older pending run so only one run can ever be approved.
     */
    if (isExplicitPreviewRequest(message)) {
      run = {
        ...run,
        status: 'succeeded',
        proposal: pendingDraft?.proposal ?? null,
        requiresApproval: false,
        approvalStatus: undefined,
        previewStatus: 'awaiting-choice',
        assistantText: previewPrompt(),
        ...(pendingDraft ? { supersedesRunId: pendingDraft.runId } : {}),
        updatedAt: Date.now(),
      };
      await saveExternalAgentRun(run);
      if (pendingDraft) await supersedeExternalAgentRun(pendingDraft.runId, runId);
      await appendConversation(
        [...conversation.llm, { role: 'user', content: message }, { role: 'assistant', content: run.assistantText }],
        run.assistantText,
      );
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

    /*
     * Continue the prior unapproved draft only when its original base still
     * matches the persisted project. Otherwise start from the live project so a
     * stale proposal can never silently overwrite newer edits.
     */
    const continuation = pendingDraft?.proposal && !isProposalStale(pendingDraft.proposal, doc)
      ? pendingDraft
      : undefined;
    const workingDoc = continuation?.proposal
      ? draftDocFromProposal(continuation.proposal)
      : doc;

    for (const [index, config] of configs.entries()) {
      run.error = null;
      run.assistantText = '';
      let latestTurnText = '';

      const session = createExternalEditSession(workingDoc, 'External Agent', 'manual');
      const live = {
        commands: session.draft!.commands,
        getState: session.draft!.getState,
        getDoc: session.draft!.getDoc,
        getCreativeMode: () => null,
        templates: [],
        audio: [],
        getProjectId: () => projectId,
      };
      const draftContext = externalDraftContext(session, live);
      let attemptSession = session;
      const history = [...conversation.llm, { role: 'user' as const, content }] as LLMMessage[];

      const resultMessages = await runAgent(history, draftContext, (event) => {
        // Keep only the latest visible model turn. Older tool-turn narration is
        // internal execution detail and must not be forwarded to Telegram.
        if (event.type === 'text-start') latestTurnText = '';
        if (event.type === 'text-delta') latestTurnText += event.delta;
        if (event.type === 'tool') {
          attemptSession = captureExternalToolActions(
            attemptSession,
            event.name,
            event.args as Record<string, unknown>,
          );
        }
        if (event.type === 'error') run.error = event.message;
      }, {
        model: getLanguageModel(config.provider, config.model, config.openAiApiMode),
        provider: config.provider,
        openAiApiMode: config.openAiApiMode,
        allowTool: isExternalAgentToolAllowed,
        systemSuffix: EXTERNAL_AGENT_SYSTEM_SUFFIX,
      });

      if (!run.error) {
        currentSession = attemptSession;
        run.providerUsed = config.provider;
        run.modelUsed = config.model;
        run.assistantText = latestTurnText.trim();
        break;
      }
      if (index < configs.length - 1) {
        run.fallbackAttempts = [
          ...(run.fallbackAttempts ?? []),
          { provider: config.provider, model: config.model },
        ];
      }
    }

    if (run.error) throw new Error(run.error);

    if (currentSession?.operationCount) {
      const approvalText = pendingApprovalText(currentSession.operationCount);
      if (continuation?.proposal && currentSession.draft) {
        const combinedOperations = [
          ...proposalOperations(continuation.proposal),
          ...currentSession.operations,
        ];
        const proposal = buildProposal(
          combinedOperations,
          approvalText,
          continuation.proposal.baseDoc,
          currentSession.draft.getState(),
        );
        run = {
          ...run,
          assistantText: approvalText,
          proposal,
          requiresApproval: true,
          approvalStatus: 'pending',
          supersedesRunId: continuation.runId,
        };
      } else {
        const reviewed = reviewExternalEditSession(currentSession, approvalText);
        run = {
          ...run,
          assistantText: approvalText,
          proposal: reviewed.proposal,
          requiresApproval: true,
          approvalStatus: 'pending',
        };
      }
    }

    await appendConversation(resultMessages, run.assistantText);
    run = { ...run, status: 'succeeded', updatedAt: Date.now() };
    await saveExternalAgentRun(run);

    /*
     * Only after the new combined proposal exists do we invalidate the prior
     * run. If the LLM/tool execution failed, the older draft remains usable.
     */
    if (continuation && run.proposal) {
      await supersedeExternalAgentRun(continuation.runId, runId);
    }

    update({ progress: 100, phase: 'completed' });
    return { assetId: runId, kind: 'image', name: 'external-agent-run', path: '', durationSeconds: 0 };
  });

  const run: ExternalAgentRun = {
    runId: initial.jobId,
    projectId,
    conversationId,
    status: 'queued',
    assistantText: '',
    proposal: null,
    requiresApproval: false,
    error: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await saveExternalAgentRun(run);
  return run;
}
