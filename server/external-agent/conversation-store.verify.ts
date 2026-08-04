import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const tempHome = await mkdtemp(`${tmpdir()}\\openchatcut-external-chat-`);
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

const { loadExternalConversation, saveExternalConversation } = await import('./conversation-store.ts');

try {
  await saveExternalConversation({
    projectId: 'project-1', conversationId: 'telegram:42',
    messages: [{ role: 'user', text: 'Añade el banner' }],
    llm: [{ role: 'user', content: 'Añade el banner' }],
    createdAt: 1, updatedAt: 2,
  });
  const stored = await loadExternalConversation('project-1', 'telegram:42');
  assert.ok(stored);
  assert.equal(stored.messages[0]?.text, 'Añade el banner');
  assert.equal(stored.llm.length, 1);

  // The same Telegram chat in another project is a different conversation.
  await saveExternalConversation({
    projectId: 'project-2', conversationId: 'telegram:42',
    messages: [{ role: 'user', text: 'Make it shorter' }],
    llm: [{ role: 'user', content: 'Make it shorter' }],
    createdAt: 3, updatedAt: 4,
  });
  const otherProject = await loadExternalConversation('project-2', 'telegram:42');
  assert.ok(otherProject);
  assert.equal(otherProject.llm[0]?.content, 'Make it shorter');
  assert.match(String((await loadExternalConversation('project-1', 'telegram:42'))?.llm[0]?.content), /banner/);

  // A second Telegram chat in the same project is also isolated.
  await saveExternalConversation({
    projectId: 'project-1', conversationId: 'telegram:99',
    messages: [{ role: 'user', text: 'Other chat' }],
    llm: [{ role: 'user', content: 'Other chat' }],
    createdAt: 5, updatedAt: 6,
  });
  assert.equal((await loadExternalConversation('project-1', 'telegram:99'))?.llm[0]?.content, 'Other chat');
  console.log('external conversation store checks passed');
} finally {
  await rm(tempHome, { recursive: true, force: true });
}
