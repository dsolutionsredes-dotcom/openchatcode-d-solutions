import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { requestShapeAllowed } from './request-shape-gate';
import { externalMcpToken } from '../editor-auth';

function req(overrides: Record<string, unknown> = {}): IncomingMessage {
  return {
    method: 'POST',
    url: '/api/keys',
    socket: { remoteAddress: '127.0.0.1' },
    headers: {
      host: '127.0.0.1:5199',
      origin: 'http://127.0.0.1:5199',
      'sec-fetch-site': 'same-origin',
    },
    ...overrides,
  } as unknown as IncomingMessage;
}

const ok = req();
assert.equal(requestShapeAllowed(ok), true, 'same-origin loopback write allowed');

const readOnly = req({ method: 'GET' });
assert.equal(requestShapeAllowed(readOnly), true, 'reads always allowed');

const crossSite = req({ headers: { ...ok.headers, 'sec-fetch-site': 'cross-site' } });
assert.equal(requestShapeAllowed(crossSite), false, 'cross-site write blocked');

const noOrigin = req({ headers: { host: '127.0.0.1:5199', 'sec-fetch-site': 'same-origin' } });
assert.equal(requestShapeAllowed(noOrigin), false, 'write without origin blocked');

const foreignOrigin = req({
  headers: { host: '127.0.0.1:5199', origin: 'http://evil.example', 'sec-fetch-site': 'same-origin' },
});
assert.equal(requestShapeAllowed(foreignOrigin), false, 'foreign origin blocked');

const nonLoopback = req({ socket: { remoteAddress: '10.0.0.5' } });
assert.equal(requestShapeAllowed(nonLoopback), false, 'non-loopback socket blocked');

const previousVps = process.env.OPENCHATCUT_VPS;
const previousOrigin = process.env.OPENCHATCUT_PUBLIC_ORIGIN;
process.env.OPENCHATCUT_VPS = '1';
process.env.OPENCHATCUT_PUBLIC_ORIGIN = 'https://openchatcode.d-solution.org';
const vpsRequest = req({
  url: '/api/keys/test',
  socket: { remoteAddress: '10.0.0.5' },
  headers: {
    host: 'openchatcode.d-solution.org',
    origin: 'https://openchatcode.d-solution.org',
    'sec-fetch-site': 'same-origin',
  },
});
assert.equal(requestShapeAllowed(vpsRequest), true, 'configured VPS editor may test settings');
assert.equal(requestShapeAllowed({ ...vpsRequest, url: '/api/keys' }), true, 'configured VPS editor may save settings');
for (const path of [
  '/api/agent-runs', '/llm', '/api/model-packs', '/api/asr', '/render', '/export/job',
  '/api/settings', '/api/project-store', '/generate',
]) {
  assert.equal(requestShapeAllowed({ ...vpsRequest, url: path }), true, `configured VPS editor may use ${path}`);
}
assert.equal(requestShapeAllowed({ ...vpsRequest, headers: { ...vpsRequest.headers, origin: 'https://evil.example' } }), false, 'external origin blocked');
assert.equal(requestShapeAllowed({ ...vpsRequest, headers: { ...vpsRequest.headers, 'sec-fetch-site': 'cross-site' } }), false, 'cross-site fetch blocked');

const bearer = req({ url: '/api/external-mcp/mcp', headers: { ...vpsRequest.headers, authorization: 'Bearer abc' } });
assert.equal(requestShapeAllowed(bearer), false, 'an arbitrary bearer token does not bypass the origin gate');

const scopedElsewhere = req({ ...vpsRequest, headers: { ...vpsRequest.headers, origin: 'https://evil.example', authorization: `Bearer ${externalMcpToken()}` } });
assert.equal(requestShapeAllowed(scopedElsewhere), false, 'the MCP token is scoped to its endpoint');

const externalMcp = req({
  url: '/api/external-mcp/mcp',
  socket: { remoteAddress: '10.0.0.5' },
  headers: { ...vpsRequest.headers, authorization: `Bearer ${externalMcpToken()}` },
});
assert.equal(requestShapeAllowed(externalMcp), true, 'the exact MCP token reaches its own endpoint');

const autoEditorWithoutBearer = { ...vpsRequest, url: '/api/auto-editor/message' };
assert.equal(requestShapeAllowed(autoEditorWithoutBearer), false, 'AUTO_EDITOR remains outside the VPS settings exception');
assert.equal(requestShapeAllowed({ ...autoEditorWithoutBearer, headers: { authorization: 'Bearer invalid' } }), false, 'AUTO_EDITOR rejects invalid bearer when not an allowed VPS settings route');
assert.equal(requestShapeAllowed({ ...autoEditorWithoutBearer, headers: { authorization: `Bearer ${externalMcpToken()}` } }), true, 'AUTO_EDITOR accepts only the configured bearer at the shape gate');

const handoffUpload = req({ url: '/upload?handoff=opaque-single-use-token', socket: { remoteAddress: '10.0.0.5' }, headers: {} });
assert.equal(requestShapeAllowed(handoffUpload), true, 'handoff upload reaches its own token verifier');

if (previousVps === undefined) delete process.env.OPENCHATCUT_VPS; else process.env.OPENCHATCUT_VPS = previousVps;
if (previousOrigin === undefined) delete process.env.OPENCHATCUT_PUBLIC_ORIGIN; else process.env.OPENCHATCUT_PUBLIC_ORIGIN = previousOrigin;

console.log('request-shape-gate.verify: ok');
