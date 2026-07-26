import assert from 'node:assert/strict';
import { loadTranscriptionSource, transcribeBlob, TranscriptionError } from './assemblyai';
import { putMediaBlob, resetMediaBlobMemory } from '../persist/mediaBlobStore';

const originalFetch = globalThis.fetch;

try {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  resetMediaBlobMemory();

  const src = '/media/uploads/cached-audio.wav';
  await putMediaBlob(src, new Blob(['cached audio'], { type: 'audio/wav' }));
  const cached = await loadTranscriptionSource(src);
  assert.equal(await cached.text(), 'cached audio');

  resetMediaBlobMemory();
  await assert.rejects(() => loadTranscriptionSource('/media/uploads/missing.wav'), (error) => (
    error instanceof TranscriptionError && error.code === 'source-unavailable'
  ));

  const submitted: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/upload')) return new Response(JSON.stringify({ upload_url: 'https://upload.example/audio' }));
    if (url.endsWith('/transcript') && init?.method === 'POST') {
      submitted.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ id: `job-${submitted.length}` }));
    }
    if (url.includes('/transcript/job-')) return new Response(JSON.stringify({ status: 'completed', text: '', words: [], utterances: [] }));
    throw new Error(`unexpected request: ${url}`);
  };
  await transcribeBlob(new Blob(['audio']));
  await transcribeBlob(new Blob(['audio']), undefined, { languageCode: 'auto' });
  assert.equal(submitted[0].language_code, 'es', 'Spanish is the default language code');
  assert.equal(submitted[0].language_detection, undefined);
  assert.equal(submitted[1].language_detection, true, 'auto remains available when requested explicitly');
  assert.equal(submitted[1].language_code, undefined);
} finally {
  globalThis.fetch = originalFetch;
  resetMediaBlobMemory();
}

console.log('assemblyai.check: ok');
