import { readStore, setStoredEntry } from '../plugins/project-store.ts';

export interface ExternalConversation {
  projectId: string;
  conversationId: string;
  /** Rendered rows for a future server-side or browser conversation view. */
  messages: Array<{ role: 'user' | 'assistant' | 'error'; text: string }>;
  /** Provider-neutral AI SDK history used to give the Agent Brain its context. */
  llm: unknown[];
  createdAt: number;
  updatedAt: number;
}

const MAX_CONVERSATIONS_PER_PROJECT = 100;
const MAX_HISTORY_MESSAGES = 200;
const keyFor = (projectId: string) => `external-chat:${projectId}`;

function isConversation(value: unknown): value is ExternalConversation {
  if (!value || typeof value !== 'object') return false;
  const conversation = value as Partial<ExternalConversation>;
  return typeof conversation.projectId === 'string'
    && typeof conversation.conversationId === 'string'
    && Array.isArray(conversation.messages)
    && Array.isArray(conversation.llm)
    && typeof conversation.createdAt === 'number'
    && typeof conversation.updatedAt === 'number';
}

export async function loadExternalConversation(
  projectId: string,
  conversationId: string,
): Promise<ExternalConversation | undefined> {
  const store = await readStore();
  const conversations = Array.isArray(store.entries[keyFor(projectId)])
    ? store.entries[keyFor(projectId)].filter(isConversation)
    : [];
  return conversations.find((conversation) => conversation.conversationId === conversationId);
}

/**
 * Store external-chat history in the same durable project store as projects,
 * jobs and settings. n8n never owns this state.
 */
export async function saveExternalConversation(conversation: ExternalConversation): Promise<void> {
  const store = await readStore();
  const key = keyFor(conversation.projectId);
  const current = Array.isArray(store.entries[key]) ? store.entries[key].filter(isConversation) : [];
  const normalized: ExternalConversation = {
    ...conversation,
    messages: conversation.messages.slice(-MAX_HISTORY_MESSAGES),
    llm: conversation.llm.slice(-MAX_HISTORY_MESSAGES),
  };
  const next = [normalized, ...current.filter((item) => item.conversationId !== normalized.conversationId)]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_CONVERSATIONS_PER_PROJECT);
  await setStoredEntry(key, next);
}
