import assert from 'node:assert/strict';
import { resolveAssetReference } from './asset-resolver';
import type { MediaAsset } from '../editor/types';

const banner: MediaAsset = {
  id: '4da5a03e-7bc5-4d13-9fe2-31a8f74b56a1', name: 'Baner.png', kind: 'image',
  src: '/media/uploads/baner.png', durationInFrames: 150,
};
const video: MediaAsset = {
  id: 'b2d91ab1-8d77-4ec1-9b0b-9d3dfc5f7103', name: 'Banner.mp4', kind: 'video',
  src: '/media/uploads/banner.mp4', durationInFrames: 300,
};
const onlyBanner = [banner];

for (const input of ['Baner.png', 'Baner', 'baner', 'banner', 'el banner', 'la imagen del banner']) {
  const resolved = resolveAssetReference(onlyBanner, input);
  assert.equal(resolved.status, 'resolved', input);
  if (resolved.status === 'resolved') assert.equal(resolved.asset.id, banner.id);
}

const byId = resolveAssetReference(onlyBanner, banner.id.slice(0, 12));
assert.equal(byId.status, 'resolved');
const byReference = resolveAssetReference(onlyBanner, 'cualquier nombre', { references: [{ assetId: banner.id }] });
assert.equal(byReference.status, 'resolved');

const image = resolveAssetReference([banner, video], 'la imagen del banner');
assert.equal(image.status, 'resolved');
if (image.status === 'resolved') assert.equal(image.asset.kind, 'image');
const secondBanner: MediaAsset = { ...video, id: 'a9ee0d80-4df7-4225-9cdb-dcf5d4a62a78', name: 'banner.jpg', kind: 'image', src: '/media/uploads/banner.jpg' };
const ambiguous = resolveAssetReference([{ ...banner, name: 'Banner.png' }, secondBanner], 'banner');
assert.equal(ambiguous.status, 'ambiguous');
if (ambiguous.status === 'ambiguous') assert.deepEqual(ambiguous.candidates.map((asset) => asset.id), [banner.id, secondBanner.id]);
assert.equal(resolveAssetReference(onlyBanner, 'logo inexistente').status, 'not_found');

console.log('asset resolver checks passed');
