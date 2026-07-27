import assert from 'node:assert/strict';
import { routeVisualTransition } from './transitionRouting';

const video = { kind: 'video' as const };

// 9:16 cover framing with a manual scale must stay in ClipWrapper.
assert.deepEqual(
  routeVisualTransition('page-curl', { ...video, transform: { scale: 1.8, x: -12 } }, video),
  { renderer: 'css', type: 'cross-dissolve' },
);

// auto_reframe is represented by zoom.reframeCurve and must not lose its crop.
assert.deepEqual(
  routeVisualTransition('rack-focus', video, { ...video, zoom: { reframeCurve: { version: 1, timebase: 'effect-frame', coordinateSpace: 'composition-normalized', keyframes: [{ frame: 0, focalPointX: 0.7, focalPointY: 0.5, magnification: 1.9 }] } } }),
  { renderer: 'css', type: 'cross-dissolve' },
);

// CSS transition types keep their real CSS animation while both wrappers remain mounted.
assert.deepEqual(
  routeVisualTransition('soft-wipe', { ...video, transform: { scale: 1.25 } }, { ...video, filters: { brightness: 1.1 } }),
  { renderer: 'css', type: 'soft-wipe' },
);

// Plain raster clips retain the WebGL transition path.
assert.deepEqual(routeVisualTransition('page-curl', video, video), { renderer: 'gl' });

console.log('transition routing checks passed');
