import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { ServerResponse } from 'node:http';
import { handleBridge } from './external-agent.ts';

class ResponseCapture {
  statusCode = 200;
  body = '';
  headers = new Map<string, string>();
  setHeader(name: string, value: string): void { this.headers.set(name, value); }
  end(value?: string): void { this.body = value ?? ''; }
}

const token = process.env.OPENCHATCUT_MCP_TOKEN;
process.env.OPENCHATCUT_MCP_TOKEN = 'bridge-test-token';
const request = (method: string, url: string, authorization?: string, body?: unknown) => Object.assign(
  Readable.from(body === undefined ? [] : [JSON.stringify(body)]),
  { method, url, headers: authorization === undefined ? {} : { authorization: `Bearer ${authorization}` } },
);
const call = async (req: ReturnType<typeof request>) => {
  const res = new ResponseCapture();
  await handleBridge(req as never, res as unknown as ServerResponse);
  return res;
};

try {
  for (const [method, url, body] of [
    ['POST', '/register', { projectId: 'p', editorId: 'e', tools: [] }],
    ['GET', '/poll?projectId=p&editorId=e', undefined],
    ['POST', '/result', { id: 'missing', ok: true }],
  ] as const) {
    assert.equal((await call(request(method, url, undefined, body))).statusCode, 401);
    assert.equal((await call(request(method, url, 'wrong', body))).statusCode, 401);
  }

  assert.equal((await call(request('POST', '/register', 'bridge-test-token', {
    projectId: 'p', editorId: 'e', tools: [],
  }))).statusCode, 200);
  assert.equal((await call(request('GET', '/poll?projectId=p&editorId=e', 'bridge-test-token'))).statusCode, 204);
  assert.equal((await call(request('POST', '/result', 'bridge-test-token', {
    id: 'missing', ok: true,
  }))).statusCode, 404);
  console.log('external agent bridge authentication checks passed');
} finally {
  if (token === undefined) delete process.env.OPENCHATCUT_MCP_TOKEN;
  else process.env.OPENCHATCUT_MCP_TOKEN = token;
}
