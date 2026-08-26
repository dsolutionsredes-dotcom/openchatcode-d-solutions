import type { AgentContext } from '../../src/agent/context.js';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { resolveUploadFile } from '../media-dir.ts';
import { transcriptionOptions } from '../plugins/media-provider-config.ts';
import { transcribeCloudAudio } from '../plugins/transcription-providers.ts';
import { getKey } from '../keystore.ts';
import { defaultTrackId, resolveTrackId, trackAlias } from '../../src/editor/types.js';
import { execAgentRuntimeTool } from '../../src/agent/tools/agent-runtime-tools.js';
import { execCaptionsTool } from '../../src/agent/tools/captions-tools.js';
import { CORE_DATA_TOOL_NAMES, execCoreDataTool } from '../../src/agent/tools/core-data-tools.js';
import { execMarkersTool } from '../../src/agent/tools/markers-tools.js';
import { execReadProjectTool } from '../../src/agent/tools/read-project-tools.js';
import { execScriptTool } from '../../src/agent/tools/script-tools.js';
import { execFindTranscript } from '../../src/agent/tools/transcript-find.js';
import { execReadTranscript } from '../../src/agent/tools/transcript-read.js';
import { execTimelineTool } from '../../src/agent/tools/timeline-tools.js';
import { execTrackTool } from '../../src/agent/tools/track-tools.js';
import { execWatermarkTool } from '../../src/agent/tools/watermark-tools.js';
import { execFinalizeUpload } from '../../src/agent/tools/upload-finalize.js';
import { execLibraryTool } from '../../src/agent/tools/library-tools.js';
import { execEditItemTool } from '../../src/agent/tools/edit-item-tools.js';
import { normalizeUploadedMedia } from '../plugins/normalize-media.ts';
import { processUploadReceiptAction } from './upload-receipt-action.ts';

type Args = Record<string, unknown>;

const CLOUD_PROVIDERS = new Set(['openai', 'mistral', 'deepgram', 'groq', 'elevenlabs', 'cartesia']);

async function execHeadlessTranscription(args: Args, ctx: AgentContext): Promise<unknown> {
  const state = ctx.getState();
  const track = resolveTrackId(state, args.track ?? 'A1') ?? defaultTrackId(state, 'audio');
  if (!track) return { error: 'no track available; create one with edit_track first' };
  const provider = typeof args.provider === 'string' && args.provider.trim()
    ? args.provider.trim()
    : getKey('PREFERRED_TRANSCRIPTION_PROVIDER');
  if (provider && !CLOUD_PROVIDERS.has(provider)) {
    return { error: `headless transcription requires a configured cloud provider; unsupported provider: ${provider}` };
  }
  const clips = state.items
    .filter((item) => (item.kind === 'audio' || item.kind === 'video') && item.track === track && item.src)
    .sort((a, b) => a.startFrame - b.startFrame);
  if (!clips.length) return { error: `no audio/video clip on ${trackAlias(state, track)}` };
  const results: Array<Record<string, unknown>> = [];
  for (const item of clips) {
    if (Array.isArray(item.transcript) && item.transcript.length && item.transcriptStale !== true) {
      results.push({ itemId: item.id, words: item.transcript.length, skipped: true, skippedReason: 'already-transcribed' });
      continue;
    }
    const filename = basename(item.src!.split('?')[0]!);
    const file = resolveUploadFile(filename);
    if (!file) return { error: `media file is not available for ${item.id}: ${filename}`, partial: results };
    const audio = await readFile(file);
    const options = transcriptionOptions();
    const transcript = await transcribeCloudAudio(options, {
      provider: (provider || 'openai') as 'openai' | 'mistral' | 'deepgram' | 'groq' | 'elevenlabs' | 'cartesia',
      language: options.language,
      diarize: options.diarization,
      audio,
    });
    ctx.commands.setItemTranscript(item.id, transcript.words);
    results.push({ itemId: item.id, words: transcript.words.length, text: transcript.text.slice(0, 200) });
  }
  return { ok: true, track: trackAlias(state, track), provider: provider || 'openai', clips: results.length, results };
}

/**
 * Execute only the dependency-closed tools reviewed for server-side EditorCore use.
 * This separate dispatch keeps GL, media, network, IndexedDB, generation, and
 * render modules out of the desktop server bundle.
 */
export async function executeOfflineTool(
  name: string,
  args: Args,
  ctx: AgentContext,
): Promise<unknown> {
  if (name === 'read_agent_artifact') return execAgentRuntimeTool(name, args, ctx);
  if (name === 'finalize_uploaded_asset') {
    return execFinalizeUpload(args, ctx, {
      postReceiptAction: async (body) => {
        const result = processUploadReceiptAction(body);
        return new Response(JSON.stringify(result.body), {
          status: result.status,
          headers: { 'content-type': 'application/json' },
        });
      },
      normalizeUploadedVideo: (src) => normalizeUploadedMedia(src, {
        logInfo: (message) => console.info(message),
        logError: (message) => console.error(message),
      }),
    });
  }
  if (CORE_DATA_TOOL_NAMES.has(name)) return execCoreDataTool(name, args, ctx);
  if (name === 'manage_timelines') return execTimelineTool(name, args, ctx);
  if (name === 'edit_track') return execTrackTool(name, args, ctx);
  if (name === 'read_script' || name === 'apply_script') return execScriptTool(name, args, ctx);
  if (name === 'read_captions' || name === 'edit_captions') return execCaptionsTool(name, args, ctx);
  if (name === 'update_watermark') return execWatermarkTool(name, args, ctx);
  if (name === 'manage_markers') return execMarkersTool(name, args, ctx);
  if (name === 'read_project') return execReadProjectTool(name, args, ctx);
  if (name === 'read_transcript') return execReadTranscript(args, ctx);
  if (name === 'find_transcript') return execFindTranscript(args, ctx);
  if (name === 'transcribe_track') return execHeadlessTranscription(args, ctx);
  if (name === 'browse_library') return execLibraryTool(name, args, ctx);
  if (name === 'edit_item') return execEditItemTool(name, args, ctx);
  return { error: `offline tool ${name} is not implemented` };
}
