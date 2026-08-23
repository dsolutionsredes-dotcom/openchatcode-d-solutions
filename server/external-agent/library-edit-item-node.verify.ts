import assert from 'node:assert/strict';
import { makeDraft } from '../../src/editor/store.js';
import type { AgentContext } from '../../src/agent/context.js';
import type { ProjectDoc, Timeline } from '../../src/editor/types.js';
import { CURRENT_PROJECT_VERSION } from '../../shared/project-version.js';
import { EFFECT_METADATA } from '../../src/gl/fx/effect-metadata.js';
import { execLibraryTool } from '../../src/agent/tools/library-tools.js';
import { execEditItemTool } from '../../src/agent/tools/edit-item-tools.js';

const timeline: Timeline = {
  id: 'tl_node_catalog',
  name: 'node catalog',
  order: 0,
  fps: 30,
  width: 1920,
  height: 1080,
  items: [{
    id: 'clip_a', track: 'V1', startFrame: 0, durationInFrames: 90,
    name: 'clip_a', kind: 'video', src: '/media/uploads/test.mp4',
  }],
  selectedId: null,
  trackOrder: ['V1', 'A1'],
  tracks: { V1: { kind: 'video', name: 'Video 1' }, A1: { kind: 'audio', name: 'Audio 1' } },
};

const doc: ProjectDoc = {
  version: CURRENT_PROJECT_VERSION,
  assets: [],
  mediaFolders: [],
  timelines: [timeline],
  activeTimelineId: timeline.id,
};

const draft = makeDraft(doc);
const ctx: AgentContext = {
  commands: draft.commands,
  getState: draft.getState,
  getDoc: draft.getDoc,
  getCreativeMode: () => null,
  templates: [],
  audio: [],
};

assert.ok(Object.keys(EFFECT_METADATA).length >= 40, 'official metadata catalog is present');
const catalog = await execLibraryTool('browse_library', { category: 'fx', query: 'bloom' }, ctx) as {
  results: Array<{ id: string }>;
};
assert.ok(catalog.results.some((item) => item.id === 'builtin:fx-bloom'));

const applied = await execEditItemTool('edit_item', {
  adds: [{ type: 'effect', targetItemId: 'clip_a', assetId: 'builtin:fx-bloom', propertyOverrides: { intensity: 1.2 } }],
}, ctx) as { ok: boolean };
assert.equal(applied.ok, true);

const invalid = await execEditItemTool('edit_item', {
  adds: [{ type: 'effect', targetItemId: 'clip_a', assetId: 'builtin:fx-bloom', propertyOverrides: { not_a_parameter: 1 } }],
}, ctx) as { ok: boolean; aborted?: boolean };
assert.equal(invalid.ok, false);
assert.equal(invalid.aborted, true);

const unknown = await execEditItemTool('edit_item', {
  adds: [{ type: 'effect', targetItemId: 'clip_a', assetId: 'builtin:fx-does-not-exist' }],
}, ctx) as { ok: boolean; aborted?: boolean };
assert.equal(unknown.ok, false);
assert.equal(unknown.aborted, true);

console.log('library/edit_item Node verification passed');
