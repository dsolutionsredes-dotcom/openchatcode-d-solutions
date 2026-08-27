import assert from 'node:assert/strict';
import { ASK_MODE_TOOL_SCHEMAS } from '../../src/agent/ask-mode-tools.ts';
import { TOOL_SCHEMAS } from '../../src/agent/tools.ts';
import { offlineExternalToolSchemas } from '../external-agent/offline-tools.ts';
import {
  canonicalServerRunToolCatalog,
  resolveServerRunToolCatalogAgainst,
  resolveServerRunToolCatalog,
} from './tool-policy.ts';
import { serverToolCatalogForGeneration } from './tool-catalog-generation.ts';

assert.deepEqual(
  canonicalServerRunToolCatalog(false),
  await serverToolCatalogForGeneration(TOOL_SCHEMAS),
);
assert.deepEqual(
  canonicalServerRunToolCatalog(true),
  await serverToolCatalogForGeneration(ASK_MODE_TOOL_SCHEMAS),
);
const requested = await serverToolCatalogForGeneration(TOOL_SCHEMAS.slice(0, 3));
assert.deepEqual(
  resolveServerRunToolCatalog(requested, false),
  requested,
  'canonical browser schemas resolve to server-owned schema objects',
);

const first = TOOL_SCHEMAS[0];
assert(first);
assert.throws(
  () => resolveServerRunToolCatalog([
    { ...first, description: `${first.description ?? ''} forged` },
  ], false),
  /Non-canonical or inactive/,
);
assert.throws(
  () => resolveServerRunToolCatalog([first, first], false),
  /Duplicate server run tool schema/,
);
assert.throws(
  () => resolveServerRunToolCatalog([{ name: 'unknown_tool', input_schema: {} }], false),
  /Non-canonical or inactive/,
);
const editOnly = TOOL_SCHEMAS.find((schema) => (
  !ASK_MODE_TOOL_SCHEMAS.some((candidate) => candidate.name === schema.name)
));
assert(editOnly, 'the edit catalog includes tools absent from Ask mode');
assert.throws(
  () => resolveServerRunToolCatalog([editOnly], true),
  /Non-canonical or inactive/,
  'Ask mode cannot smuggle an editing schema into the server catalog',
);

const offlineCatalog = offlineExternalToolSchemas();
const beginEditSession = offlineCatalog.find((schema) => schema.name === 'begin_edit_session');
assert(beginEditSession, 'offline catalog exposes the edit-session lifecycle');
assert.deepEqual(
  resolveServerRunToolCatalogAgainst([beginEditSession], offlineCatalog),
  [beginEditSession],
  'authenticated headless hosts can use their own immutable tool catalog',
);
assert.throws(
  () => resolveServerRunToolCatalogAgainst([
    { ...beginEditSession, description: `${beginEditSession.description ?? ''} forged` },
  ], offlineCatalog),
  /Non-canonical or inactive/,
  'headless catalogs reject forged schemas too',
);

console.log('server run canonical tool policy verification passed');
