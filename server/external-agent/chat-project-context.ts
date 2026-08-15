import { readStore, setStoredEntry } from '../plugins/project-store.ts';
import { getExternalProject, type ProjectMeta } from './projects.ts';

export interface ChatProjectContext {
  chatId: string;
  projectId: string;
  updatedAt: number;
}

const KEY = 'external-chat-project-contexts';
const CHAT_ID = /^[a-zA-Z0-9:_-]{1,160}$/;

function contexts(value: unknown): ChatProjectContext[] {
  return Array.isArray(value) ? value.filter((item): item is ChatProjectContext => (
    !!item && typeof item === 'object' && typeof (item as ChatProjectContext).chatId === 'string'
    && typeof (item as ChatProjectContext).projectId === 'string' && typeof (item as ChatProjectContext).updatedAt === 'number'
  )) : [];
}

export async function getChatProjectContext(chatId: string): Promise<(ChatProjectContext & { project: ProjectMeta }) | undefined> {
  const context = contexts((await readStore()).entries[KEY]).find((item) => item.chatId === chatId);
  if (!context) return undefined;
  const project = await getExternalProject(context.projectId);
  return project ? { ...context, project } : undefined;
}

export async function setChatProjectContext(chatId: string, projectId: string): Promise<(ChatProjectContext & { project: ProjectMeta }) | undefined> {
  if (!CHAT_ID.test(chatId)) return undefined;
  const project = await getExternalProject(projectId);
  if (!project) return undefined;
  const store = await readStore();
  const next: ChatProjectContext = { chatId, projectId, updatedAt: Date.now() };
  await setStoredEntry(KEY, [next, ...contexts(store.entries[KEY]).filter((item) => item.chatId !== chatId)]);
  return { ...next, project };
}

export async function clearChatProjectContext(chatId: string): Promise<boolean> {
  if (!CHAT_ID.test(chatId)) return false;
  const store = await readStore();
  const current = contexts(store.entries[KEY]);
  const remaining = current.filter((item) => item.chatId !== chatId);
  if (remaining.length === current.length) return true;
  await setStoredEntry(KEY, remaining);
  return true;
}
