import {
  EXTERNAL_SESSION_TOOLS,
  externalDraftSchemas,
  type ExternalRegisteredTool,
} from '../../src/agent/external-tool-shape.js';
import { isExternalServerDirectTool } from '../../src/agent/external-tool-policy.js';
import { AGENT_RUNTIME_TOOL_SCHEMAS } from '../../src/agent/tools/schemas/agent-runtime-tools.js';
import { CORE_TOOL_SCHEMAS } from '../../src/agent/tools/schemas/core-tools.js';
import { CAPTIONS_TOOL_SCHEMAS } from '../../src/agent/tools/schemas/captions-tools.js';
import { MARKERS_TOOL_SCHEMAS } from '../../src/agent/tools/schemas/markers-tools.js';
import { READ_PROJECT_TOOL_SCHEMAS } from '../../src/agent/tools/schemas/read-project-tools.js';
import { SCRIPT_TOOL_SCHEMAS } from '../../src/agent/tools/schemas/script-tools.js';
import { TIMELINE_TOOL_SCHEMAS } from '../../src/agent/tools/schemas/timeline-tools.js';
import { TRACK_TOOL_SCHEMAS } from '../../src/agent/tools/schemas/track-tools.js';
import { TRANSCRIPT_TOOL_SCHEMAS } from '../../src/agent/tools/schemas/transcript-tools.js';
import { WATERMARK_TOOL_SCHEMAS } from '../../src/agent/tools/schemas/watermark-tools.js';
import { UPLOAD_TOOL_SCHEMAS } from '../../src/agent/tools/schemas/upload-tools.js';
import { LIBRARY_TOOL_SCHEMAS } from '../../src/agent/tools/schemas/library-tools.js';
import { EDIT_ITEM_TOOL_SCHEMAS } from '../../src/agent/tools/schemas/edit-item-tools.js';

const OFFLINE_TOOL_DESCRIPTIONS: Record<string, string> = {
  begin_edit_session: 'Start an offline server draft. Manual mode creates a durable pending proposal; auto mode applies at review.',
  review_edit_session: 'Finish the offline draft. Manual mode returns a pending proposal; auto mode atomically commits it.',
  approve_edit_session: 'Approve and atomically commit the pending offline proposal.',
  reject_edit_session: 'Reject the pending offline proposal without changing the stored project.',
  edit_captions: 'Edit built-in caption template, style, layout, text, source, and language data. preset_* actions require the browser editor.',
  finalize_uploaded_asset: 'Finalize a verified official upload receipt into the current project media pool.',
  browse_library: 'Browse the current OpenChatCut metadata catalog without loading WebGL shaders.',
  edit_item: 'Validate and apply catalog-backed data-only timeline edits in the offline draft.',
};

const OFFLINE_SCHEMA_GROUPS = [
  AGENT_RUNTIME_TOOL_SCHEMAS,
  CORE_TOOL_SCHEMAS,
  TIMELINE_TOOL_SCHEMAS,
  TRACK_TOOL_SCHEMAS,
  SCRIPT_TOOL_SCHEMAS,
  CAPTIONS_TOOL_SCHEMAS,
  WATERMARK_TOOL_SCHEMAS,
  MARKERS_TOOL_SCHEMAS,
  READ_PROJECT_TOOL_SCHEMAS,
  TRANSCRIPT_TOOL_SCHEMAS,
  UPLOAD_TOOL_SCHEMAS,
  LIBRARY_TOOL_SCHEMAS,
  EDIT_ITEM_TOOL_SCHEMAS,
] as const;

function serverDirectSchemas(): ExternalRegisteredTool[] {
  const byName = new Map(
    OFFLINE_SCHEMA_GROUPS
      .flat()
      .filter((tool) => isExternalServerDirectTool(tool.name))
      .map((tool) => [tool.name, tool]),
  );
  return externalDraftSchemas([...byName.values()]);
}

/** Lifecycle controls plus the reviewed, dependency-closed pure-data editor subset. */
export function offlineExternalToolSchemas(): ExternalRegisteredTool[] {
  return [...EXTERNAL_SESSION_TOOLS, ...serverDirectSchemas()].map((tool) => (
    OFFLINE_TOOL_DESCRIPTIONS[tool.name]
      ? { ...tool, description: OFFLINE_TOOL_DESCRIPTIONS[tool.name] }
      : tool
  ));
}
