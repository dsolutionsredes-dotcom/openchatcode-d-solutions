import assert from 'node:assert/strict';
import { INITIAL } from '../../src/editor/initial';
import { docFromTimeline } from '../../src/persist/projectStore';
import { captureExternalToolActions, createExternalEditSession, externalDraftContext, reviewExternalEditSession } from '../../src/agent/external-edit-session';
import { execReadProjectTool } from '../../src/agent/tools/read-project-tools';
import { validateGenericAdd } from '../../src/agent/tools/edit-item-generic';
import { isExternalAgentToolAllowed, prepareExternalAgentInput } from './asset-input';

const banner = {
  id: '4da5a03e-7bc5-4d13-9fe2-31a8f74b56a1', name: 'Baner.png', kind: 'image' as const,
  src: '/media/uploads/baner.png', durationInFrames: 150,
};
const doc = { ...docFromTimeline({ ...INITIAL, items: [] }), assets: [banner] };
const session = createExternalEditSession(doc, 'external-test', 'manual');
const ctx = externalDraftContext(session, {
  commands: session.draft!.commands,
  getState: session.draft!.getState,
  getDoc: session.draft!.getDoc,
  getCreativeMode: () => null,
  templates: [],
  audio: [],
  getProjectId: () => 'project-assets',
});

assert.equal(isExternalAgentToolAllowed('read_project'), true, 'external server allows the existing project reader');
for (const tool of [
  'read_transcript', 'find_transcript', 'read_captions', 'edit_captions', 'manage_effects',
  'manage_markers', 'apply_layout', 'list_audio', 'add_audio', 'list_templates',
  'search_templates', 'add_motion_graphic', 'read_script', 'apply_script',
]) {
  assert.equal(isExternalAgentToolAllowed(tool), true, `${tool} is server-safe`);
}
for (const tool of [
  'transcribe_track', 'detect_scenes', 'auto_reframe', 'view_timeline_frames',
  'submit_render_job', 'submit_video', 'submit_music', 'run_code', 'web_browser',
  'request_asset_upload_url', 'delete_project',
]) {
  assert.equal(isExternalAgentToolAllowed(tool), false, `${tool} remains unavailable server-side`);
}
const read = await execReadProjectTool('read_project', { view: 'assets' }, ctx) as { mediaPool: { assets: Array<{ id: string; name: string }> } };
assert.deepEqual(read.mediaPool.assets.map((asset) => ({ id: asset.id, name: asset.name })), [{ id: banner.id, name: 'Baner.png' }]);

const prepared = prepareExternalAgentInput('Agrega el banner al inicio del timeline', doc.assets, []);
assert.ok(prepared.content?.includes(banner.id), 'human reference is injected as the real asset id before the LLM runs');
assert.equal(session.draft!.getState().items.length, 0, 'reading/resolving never changes the real or draft timeline');

const placement = validateGenericAdd(session.draft!.getState(), doc.assets, {
  type: 'image', assetId: 'la imagen del banner', fromFrame: 0,
});
assert.equal(placement.plan, 'addMedia');
assert.equal(placement.assetId, banner.id, 'placement converts the human name to its UUID');
ctx.commands.addMediaItem(banner, { track: ctx.getState().trackOrder[0]!, startFrame: 0 });
const staged = captureExternalToolActions(session, 'edit_item', { adds: [{ type: 'image', assetId: 'el banner', fromFrame: 0 }] });
const proposal = reviewExternalEditSession(staged, 'Agrega el banner al inicio del timeline').proposal;
assert.ok(proposal, 'a resolved asset can become a proposal');
assert.equal(doc.timelines[0]!.items.length, 0, 'the persisted/base TimelineState stays unchanged before approval');

const canonicalBanner = { ...banner, name: 'Banner.png' };
const competing = { ...banner, id: 'c6a4c1f0-2511-46d0-a5df-a5597f896e10', name: 'banner.jpg', src: '/media/uploads/banner.jpg' };
const ambiguous = prepareExternalAgentInput('Agrega banner al inicio', [canonicalBanner, competing], []);
assert.match(ambiguous.clarification ?? '', /Necesito aclaración/);
assert.equal(ambiguous.content, undefined, 'ambiguous names never reach the LLM as a selected asset');

console.log('external asset resolution checks passed');
