import {
  connectedProjectIds,
  editorBinding,
  editorBindingMatches,
  ExternalEditorCallError,
  invokeEditorTool,
  type EditorBinding,
} from './broker.ts';

function resultRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function sessionIdOf(value: Record<string, unknown>): string {
  return typeof value.editSessionId === 'string' ? value.editSessionId.trim() : '';
}

/**
 * Server-side adapter for one live OpenChatCut editor.
 *
 * It deliberately has no stored-project fallback: V6 editing is allowed only
 * while exactly one browser editor is connected. The editor still owns the
 * draft, revision checks, and final atomic apply.
 */
export class BrowserAgentRuntime {
  private binding: EditorBinding;
  private session: Record<string, unknown> | null = null;
  readonly projectId: string;
  private readonly ownerId: string;

  private constructor(
    projectId: string,
    ownerId: string,
    binding: EditorBinding,
  ) {
    this.projectId = projectId;
    this.ownerId = ownerId;
    this.binding = binding;
  }

  static connect(projectId: string, ownerId: string): BrowserAgentRuntime {
    const connected = connectedProjectIds();
    if (connected.length !== 1 || connected[0] !== projectId) {
      throw new ExternalEditorCallError(
        'rejected',
        connected.length === 0
          ? 'Open the intended OpenChatCut project before sending an editing instruction.'
          : 'Only one OpenChatCut project may be open for V6 editing. Close the other editor first.',
      );
    }
    const binding = editorBinding(projectId);
    if (!binding || !editorBindingMatches(binding)) {
      throw new ExternalEditorCallError(
        'rejected',
        'The selected OpenChatCut editor is no longer connected. Reopen the project and retry.',
      );
    }
    return new BrowserAgentRuntime(projectId, ownerId, binding);
  }

  currentSessionInfo(): Record<string, unknown> | null {
    return this.session ? { ...this.session } : null;
  }

  async execute(name: string, args: Record<string, unknown>): Promise<unknown> {
    this.refreshBinding(name === 'get_edit_session');
    const result = await invokeEditorTool(this.ownerId, this.binding, name, args);
    this.observe(name, result);
    // Draft tools mutate only the isolated editor draft. Refresh its status so
    // a model that ends after a tool call can still be turned into one proposal.
    const sessionId = sessionIdOf(args);
    if (sessionId && !['get_edit_session', 'review_edit_session', 'approve_edit_session', 'reject_edit_session', 'discard_edit_session'].includes(name)) {
      const status = await invokeEditorTool(this.ownerId, this.binding, 'get_edit_session', { editSessionId: sessionId });
      this.observe('get_edit_session', status);
    }
    return result;
  }

  private refreshBinding(allowRevisionDrift: boolean): void {
    const current = editorBinding(this.projectId);
    if (!current || !editorBindingMatches(current)) {
      throw new ExternalEditorCallError(
        'stale',
        'The OpenChatCut editor connection changed. The edit needs reconciliation before retrying.',
      );
    }
    if (allowRevisionDrift) {
      if (current.editorInstanceId !== this.binding.editorInstanceId) {
        throw new ExternalEditorCallError('stale', 'The OpenChatCut editor session changed.');
      }
      this.binding = current;
      return;
    }
    if (current.baseRevision !== this.binding.baseRevision
      || current.editorInstanceId !== this.binding.editorInstanceId) {
      throw new ExternalEditorCallError(
        'stale',
        'The project changed while this edit was pending. It needs reconciliation before retrying.',
      );
    }
  }

  private observe(name: string, value: unknown): void {
    if (!['begin_edit_session', 'get_edit_session', 'review_edit_session', 'approve_edit_session', 'reject_edit_session', 'discard_edit_session'].includes(name)) return;
    const record = resultRecord(value);
    if (sessionIdOf(record)) this.session = record;
  }
}
