import assert from 'node:assert/strict';
import type { AgentContext } from '../context';
import type { AtomicAction } from '../../editor/reduce';
import { execSceneDetectionTool } from './scene-detection-tools';

const batches: Array<{ actions: AtomicAction[]; label?: string }> = [];
const item = {
  id: 'item_video', track: 'v1', startFrame: 100, durationInFrames: 180,
  name: 'trimmed speed clip', kind: 'video' as const, src: '/media/uploads/source.mp4',
  srcInFrame: 60, playbackRate: 2,
};
const ctx = {
  getState: () => ({
    fps: 30, width: 1920, height: 1080, items: [item], selectedId: item.id,
    tracks: { v1: { kind: 'video' as const } }, trackOrder: ['v1'],
  }),
  getDoc: () => ({ assets: [{ id: 'asset_video', name: 'source.mp4', kind: 'video' as const, src: item.src, durationInFrames: 600 }] }),
  commands: { batch: (actions: AtomicAction[], label?: string) => batches.push({ actions, label }) },
  templates: [], audio: [], getCreativeMode: () => null,
} as unknown as AgentContext;

const originalFetch = globalThis.fetch;
const completed = {
  id: 'scene_done', src: item.src, status: 'completed', progress: 1, processedMs: 20_000,
  createdAt: 1, updatedAt: 2, error: null,
  result: {
    durationMs: 20_000, threshold: 0.3, minSceneMs: 750, sampleFps: 12,
    scenes: [
      { timeMs: 1000, score: 0.7, kind: 'cut' },
      { timeMs: 4000, score: 0.6, kind: 'cut' },
      { timeMs: 8000, score: 0.35, kind: 'transition' },
    ],
  },
};
const calls: string[] = [];
globalThis.fetch = async (input, init) => {
  const url = String(input);
  calls.push(`${init?.method ?? 'GET'} ${url}`);
  if (url === '/api/detect-scenes/jobs' && init?.method === 'POST') {
    return new Response(JSON.stringify(completed), { status: 202, headers: { 'content-type': 'application/json' } });
  }
  if (url === '/api/detect-scenes/jobs/scene_done' && init?.method === 'DELETE') {
    return new Response(JSON.stringify({ ...completed, status: 'cancelled', result: null, progress: 0.2 }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url === '/api/detect-scenes/jobs/scene_done') {
    return new Response(JSON.stringify(completed), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
};

try {
  const marked = await execSceneDetectionTool('detect_scenes', { itemId: 'item_', apply: 'markers' }, ctx) as { applicableCount: number; appliedCount: number };
  assert.equal(marked.applicableCount, 2);
  assert.equal(marked.appliedCount, 2);
  assert.equal(batches[0]!.label, 'Add scene markers');
  assert.deepEqual(batches[0]!.actions.map((action) => action.type === 'addMarker' ? action.marker.fromFrame : null), [130, 190]);

  const split = await execSceneDetectionTool('detect_scenes', { itemId: item.id, apply: 'split' }, ctx) as { appliedCount: number };
  assert.equal(split.appliedCount, 2);
  const splitActions = batches[1]!.actions;
  assert.equal(splitActions[0]!.type, 'split');
  assert.equal(splitActions[1]!.type, 'split');
  if (splitActions[0]!.type === 'split' && splitActions[1]!.type === 'split') {
    assert.equal(splitActions[0]!.atFrame, 130);
    assert.equal(splitActions[1]!.id, splitActions[0]!.newId);
    assert.equal(splitActions[1]!.atFrame, 190);
  }
  const status = await execSceneDetectionTool('detect_scenes', { action: 'status', jobId: 'scene_done' }, ctx) as { status: string };
  assert.equal(status.status, 'completed');
  const cancelled = await execSceneDetectionTool('detect_scenes', { action: 'cancel', jobId: 'scene_done' }, ctx) as { status: string };
  assert.equal(cancelled.status, 'cancelled');
  assert.ok(calls.includes('POST /api/detect-scenes/jobs'));
  assert.ok(calls.every((call) => !call.includes('POST /api/detect-scenes ')));
  console.log('scene-detection-tools.check: ok');
} finally {
  globalThis.fetch = originalFetch;
}
