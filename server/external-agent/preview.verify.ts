import assert from 'node:assert/strict';
import { isExplicitPreviewRequest, previewPrompt } from './preview.ts';

assert.equal(isExplicitPreviewRequest('Genera preview'), true);
assert.equal(isExplicitPreviewRequest('Haz una previsualización del proyecto'), true);
assert.equal(isExplicitPreviewRequest('Mueve Baner.png al segundo 2'), false);
assert.equal(isExplicitPreviewRequest('No generes preview todavía'), false);
assert.match(previewPrompt(), /no se ha renderizado/i);
console.log('external preview request checks passed');
