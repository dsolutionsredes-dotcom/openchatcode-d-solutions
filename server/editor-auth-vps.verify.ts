import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { trustedEditorRequest } from './editor-auth.ts';
import { requestOrigin } from './agent-runs/request.ts';

function request(headers: Record<string, string>, remoteAddress = '203.0.113.10'): IncomingMessage {
  return { socket: { remoteAddress }, headers } as unknown as IncomingMessage;
}

const previousVps = process.env.OPENCHATCUT_VPS;
const previousOrigin = process.env.OPENCHATCUT_PUBLIC_ORIGIN;
try {
  process.env.OPENCHATCUT_VPS = '1';
  process.env.OPENCHATCUT_PUBLIC_ORIGIN = 'https://openchatcode.d-solution.org';
  const sameOrigin = request({
    host: 'openchatcode.d-solution.org',
    origin: 'https://openchatcode.d-solution.org',
    'sec-fetch-site': 'same-origin',
  });
  assert.equal(trustedEditorRequest(sameOrigin, true), true, 'VPS editor write is trusted centrally');
  assert.equal(trustedEditorRequest(sameOrigin, false), true, 'VPS editor read is trusted centrally');
  assert.equal(requestOrigin(sameOrigin), 'https://openchatcode.d-solution.org', 'Agent Runs keeps configured HTTPS origin');
  assert.equal(trustedEditorRequest(request({
    host: 'openchatcode.d-solution.org',
    origin: 'https://evil.example',
    'sec-fetch-site': 'same-origin',
  }), true), false, 'cross-origin VPS editor request is rejected');
  assert.equal(trustedEditorRequest(request({
    host: 'openchatcode.d-solution.org',
    'sec-fetch-site': 'same-origin',
  }), true), false, 'VPS writes require Origin');
  assert.equal(trustedEditorRequest(request({
    host: 'openchatcode.d-solution.org',
    'sec-fetch-site': 'cross-site',
  }), false), false, 'VPS reads require same-origin fetch metadata');
} finally {
  if (previousVps === undefined) delete process.env.OPENCHATCUT_VPS;
  else process.env.OPENCHATCUT_VPS = previousVps;
  if (previousOrigin === undefined) delete process.env.OPENCHATCUT_PUBLIC_ORIGIN;
  else process.env.OPENCHATCUT_PUBLIC_ORIGIN = previousOrigin;
}

console.log('editor-auth-vps.verify: central VPS trust and HTTPS origin passed');
