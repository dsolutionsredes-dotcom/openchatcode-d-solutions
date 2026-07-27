import assert from 'node:assert/strict';
import { makeDraft } from '../../editor/store';
import { docFromTimeline } from '../../persist/projectStore';
import type { TimelineState } from '../../editor/types';
import type { AgentContext } from '../context';
import { execTranscriptTool } from './transcript-tools';

const state: TimelineState = {
  fps: 30, width: 1920, height: 1080, selectedId: null,
  items: [{
    id: 'clip', track: 'A1', startFrame: 0, durationInFrames: 300,
    name: 'clip', kind: 'audio', src: '/media/test.wav',
    transcript: [
      { text: 'Va', start: 10, end: 100 },
      { text: 'len', start: 100, end: 200 },
      { text: 'tina', start: 200, end: 300 },
    ],
  }],
};
const draft = makeDraft(docFromTimeline(state));
const ctx: AgentContext = {
  commands: draft.commands, getState: draft.getState, getDoc: draft.getDoc,
  getCreativeMode: () => null, templates: [], audio: [],
};

const originalFetch = globalThis.fetch;
const submitted: Array<Record<string, unknown>> = [];
try {
  draft.commands.setItemTranscript('clip', []);
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === '/media/test.wav') return new Response(new Blob(['audio'], { type: 'audio/wav' }));
    if (url.endsWith('/upload')) return new Response(JSON.stringify({ upload_url: 'https://upload.example/audio' }));
    if (url.endsWith('/transcript') && init?.method === 'POST') {
      submitted.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ id: `job-${submitted.length}` }));
    }
    if (url.includes('/transcript/job-')) return new Response(JSON.stringify({ status: 'completed', text: '', words: [], utterances: [] }));
    throw new Error(`unexpected request: ${url}`);
  };
  await execTranscriptTool('transcribe_track', { track: 'A1' }, ctx);
  await execTranscriptTool('manage_transcript', { action: 'retry_transcription', itemId: 'clip' }, ctx);
  assert.equal(submitted[0]?.language_code, 'es', 'transcribe_track defaults to Spanish');
  assert.equal(submitted[1]?.language_code, 'es', 'retry_transcription defaults to Spanish');
} finally {
  globalThis.fetch = originalFetch;
}

draft.commands.setItemTranscript('clip', [
  { text: 'Va', start: 10, end: 100 },
  { text: 'len', start: 100, end: 200 },
  { text: 'tina', start: 200, end: 300 },
]);
const merged = await execTranscriptTool('manage_transcript', {
  action: 'merge_words', itemId: 'clip', startIndex: 0, endIndex: 2, text: 'Valentina',
}, ctx) as { ok?: boolean };
assert.equal(merged.ok, true);
assert.deepEqual(draft.getState().items[0]?.transcript, [{ text: 'Valentina', start: 10, end: 300 }]);

draft.commands.setItemTranscript('clip', [
  { text: 'vá', start: 10, end: 100 },
  { text: 'mo', start: 100, end: 200 },
  { text: 'nos', start: 200, end: 300 },
]);
await execTranscriptTool('manage_transcript', {
  action: 'merge_words', itemId: 'clip', startIndex: 0, endIndex: 2, text: 'vámonos',
}, ctx);
assert.deepEqual(draft.getState().items[0]?.transcript, [{ text: 'vámonos', start: 10, end: 300 }]);

const schemas = await import('./transcript-tools');
const manage = schemas.TRANSCRIPT_TOOL_SCHEMAS.find((tool) => tool.name === 'manage_transcript');
const action = (manage?.input_schema.properties as Record<string, { enum?: string[] }>).action;
assert.ok(action?.enum?.includes('merge_words'));

console.log('transcript-language.check: ok');
