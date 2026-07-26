import assert from 'node:assert/strict';
import { __resetTranscribeJobs, enqueueTranscription, getTranscribeJob } from './transcribe-jobs';

const originalFetch = globalThis.fetch;
let submitted: Record<string, unknown> | undefined;

try {
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === '/api/extract-audio') return new Response('', { status: 404 });
    if (url === '/media/uploads/video.mp4') return new Response(new Blob(['video audio'], { type: 'video/mp4' }));
    if (url.endsWith('/upload')) return new Response(JSON.stringify({ upload_url: 'https://upload.example/video' }));
    if (url.endsWith('/transcript') && init?.method === 'POST') {
      submitted = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: 'job-default-language' }));
    }
    if (url.endsWith('/transcript/job-default-language')) return new Response(JSON.stringify({ status: 'completed', text: '', words: [], utterances: [] }));
    throw new Error(`unexpected request: ${url}`);
  };

  enqueueTranscription({ id: 'video-1', src: '/media/uploads/video.mp4' });
  for (let i = 0; i < 20 && getTranscribeJob('video-1')?.status === 'running'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(getTranscribeJob('video-1')?.status, 'done');
  assert.equal(submitted?.language_code, 'es', 'automatic ingestion defaults to Spanish');
  assert.equal(submitted?.language_detection, undefined);
} finally {
  globalThis.fetch = originalFetch;
  __resetTranscribeJobs();
}

console.log('transcribe jobs default language checks passed');
