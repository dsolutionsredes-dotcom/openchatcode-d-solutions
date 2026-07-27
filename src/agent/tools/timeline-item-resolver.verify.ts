import assert from 'node:assert/strict';
import type { TimelineState } from '../../editor/types';
import { resolveTimelineItem } from './timeline-item-resolver';

const state = {
  fps: 30, width: 1920, height: 1080, selectedId: null,
  trackOrder: ['V1', 'A1', 'C1'],
  tracks: { V1: { kind: 'video' }, A1: { kind: 'audio' }, C1: { kind: 'caption' } },
  items: [
    { id: 'clip-alpha', track: 'V1', startFrame: 0, durationInFrames: 30, kind: 'video', name: 'Alpha' },
    { id: 'clip-alpine', track: 'V1', startFrame: 30, durationInFrames: 30, kind: 'video', name: 'Alpine' },
  ],
} as unknown as TimelineState;

const itemId = (raw: unknown) => {
  const result = resolveTimelineItem(state, raw);
  if (!('item' in result)) throw new Error(result.error);
  return result.item.id;
};
const errorText = (raw: unknown) => {
  const result = resolveTimelineItem(state, raw);
  if (!('error' in result)) throw new Error(`expected rejection for ${String(raw)}`);
  return result.error;
};
assert.equal(itemId('clip-alpha'), 'clip-alpha', 'exact match wins');
assert.equal(itemId('clip-alph'), 'clip-alpha', 'unique prefix resolves');
assert.match(errorText('clip-al'), /ambiguous/);
for (const alias of ['C1', 'C2', 'V1', 'V2', 'A1', 'A2']) assert.match(errorText(alias), /track alias|track id/);

console.log('timeline-item-resolver.check: ok');
