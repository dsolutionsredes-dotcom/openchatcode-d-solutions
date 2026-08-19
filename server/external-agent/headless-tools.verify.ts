import assert from 'node:assert/strict';
import { INITIAL } from '../../src/editor/initial.ts';
import { docFromTimeline } from '../../src/persist/projectStore.ts';
import {
  captureExternalToolActions,
  createExternalEditSession,
  reviewExternalEditSession,
} from '../../src/agent/external-edit-session.ts';
import { isExternalAgentToolAllowed } from './asset-input.ts';
import { installExternalAgentServerFetch } from './server-fetch.ts';

installExternalAgentServerFetch();

for (const tool of [
  'edit_item',
  'transcribe_track',
  'manage_transcript',
  'edit_captions',
  'submit_render_job',
  'track_export',
  'verify_export',
  'probe_media',
  'ToolSearch',
]) {
  assert.equal(isExternalAgentToolAllowed(tool), true, `${tool} is available to the external API agent`);
}

for (const tool of ['web_browser', 'run_code', 'detect_beats', 'remove_silence', 'normalize_loudness']) {
  assert.equal(isExternalAgentToolAllowed(tool), false, `${tool} is not advertised as headless yet`);
}

const video1 = {
  id: 'asset-video-1',
  name: 'video1.mp4',
  kind: 'video' as const,
  src: '/media/uploads/video1.mp4',
  durationInFrames: 180,
  width: 1920,
  height: 1080,
};
const video2 = {
  id: 'asset-video-2',
  name: 'video2.mp4',
  kind: 'video' as const,
  src: '/media/uploads/video2.mp4',
  durationInFrames: 180,
  width: 1920,
  height: 1080,
};
const logo = {
  id: 'asset-logo',
  name: 'logo.png',
  kind: 'image' as const,
  src: '/media/uploads/logo.png',
  durationInFrames: 150,
  width: 400,
  height: 120,
};
const timeline = {
  ...INITIAL,
  items: [],
  trackOrder: ['track_v2', 'track_v1'],
  tracks: {
    track_v2: { kind: 'video' as const },
    track_v1: { kind: 'video' as const },
  },
};
const doc = { ...docFromTimeline(timeline), assets: [video1, video2, logo] };
let session = createExternalEditSession(doc, 'External Agent', 'manual');

session.draft!.commands.addMediaItem(video1, { track: 'track_v1', startFrame: 0 });
session.draft!.commands.addMediaItem(video2, { track: 'track_v1', startFrame: 180 });
session.draft!.commands.addMediaItem(logo, { track: 'track_v2', startFrame: 0 });
session = captureExternalToolActions(session, 'edit_item', {
  adds: [
    { type: 'video', assetId: video1.id, track: 'V1', fromFrame: 0 },
    { type: 'video', assetId: video2.id, track: 'V1', fromFrame: 180 },
    { type: 'image', assetId: logo.id, track: 'V2', fromFrame: 0, durationInFrames: 360 },
  ],
});

const secondClip = session.draft!.getState().items.find((item) => item.name === video2.name);
assert.ok(secondClip, 'second video clip exists in the draft');
session.draft!.commands.addTransition(secondClip.id, 'cross-dissolve', 24);
session = captureExternalToolActions(session, 'edit_item', {
  adds: [{ type: 'transition', assetId: 'builtin:tr-cross-dissolve', incomingItemId: secondClip.id, durationInFrames: 24 }],
});

const reviewed = reviewExternalEditSession(session, 'Añade dos vídeos, agrega una transición y un logo.');
const proposal = reviewed.proposal;
assert.ok(proposal, 'a proposal is produced');
assert.equal(proposal.options.length, 1, 'one coherent proposal is produced');
assert.equal(proposal.options[0]!.operations.length, 2, 'multiple tool calls stay in one proposal');
assert.equal(proposal.resultState.items.length, 3, 'draft contains two videos and one logo');
assert.equal(proposal.resultState.transitions?.length, 1, 'draft contains one transition');
assert.equal(doc.timelines[0]!.items.length, 0, 'base project is unchanged before approval');

console.log('external headless tool policy checks passed');
