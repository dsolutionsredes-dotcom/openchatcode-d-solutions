import type { ModelMessage } from 'ai';
import type { AgentToolSchema } from './tool-schema';
import { generateAgentTextDetailed, type GeneratedAgentTextResult } from './client';
import { getAgentModelSnapshot } from './model-selection';
import { normalizeIntentText } from './intent-normalization';
import { routedToolSelection } from './tool-routing';
import { loadAgentSettings } from './settings/agentSettings';
import type { LlmProvider } from '../../shared/llm-providers';

export const SEMANTIC_INTENT_RESOLVER_CONFIG = {
  enabled: true,
  provider: 'gemini' as const,
  model: 'gemini-2.5-flash-lite',
  maxOutputTokens: 180,
  confidenceThreshold: 0.78,
  mutationConfidenceThreshold: 0.84,
} as const;
type SemanticIntentResolverConfig = {
  readonly enabled: boolean;
  readonly provider: LlmProvider;
  readonly model: string;
  readonly maxOutputTokens: number;
  readonly confidenceThreshold: number;
  readonly mutationConfidenceThreshold: number;
};

function activeResolverConfig(
  override?: Partial<SemanticIntentResolverConfig>,
): SemanticIntentResolverConfig {
  const settings = loadAgentSettings();
  return {
    ...SEMANTIC_INTENT_RESOLVER_CONFIG,
    enabled: settings.semanticIntentResolverEnabled ?? SEMANTIC_INTENT_RESOLVER_CONFIG.enabled,
    provider: settings.semanticIntentResolverProvider ?? SEMANTIC_INTENT_RESOLVER_CONFIG.provider,
    model: settings.semanticIntentResolverModel ?? SEMANTIC_INTENT_RESOLVER_CONFIG.model,
    maxOutputTokens: settings.semanticIntentResolverMaxOutputTokens ?? SEMANTIC_INTENT_RESOLVER_CONFIG.maxOutputTokens,
    ...override,
  };
}

export type SemanticIntentFamily =
  | 'timeline_edit'
  | 'split'
  | 'remove'
  | 'trim'
  | 'aspect_layout'
  | 'captions'
  | 'transcription'
  | 'silence'
  | 'audio_music'
  | 'effects'
  | 'color'
  | 'scenes'
  | 'reframe'
  | 'export_render'
  | 'media_assets'
  | 'projects'
  | 'web_skills'
  | 'generation'
  | 'undo_redo';

const FAMILY_DESCRIPTIONS: Readonly<Record<SemanticIntentFamily, string>> = {
  timeline_edit: 'move, change, add, or edit timeline items and tracks',
  split: 'split or divide a clip or image at a point',
  remove: 'remove an item, clip, image, or part from the timeline',
  trim: 'keep or shorten a beginning, end, or selected portion',
  aspect_layout: 'aspect ratio, vertical/reel format, layout, picture-in-picture, split screen',
  captions: 'captions or subtitles',
  transcription: 'transcription, spoken words, script, or ASR',
  silence: 'silences, pauses, or filler words',
  audio_music: 'audio, music, volume, beats, or music synchronization',
  effects: 'effects, transitions, zoom, templates, library, LUT, or watermark',
  color: 'color correction, grading, exposure, contrast, saturation, whites, or blacks',
  scenes: 'scenes, highlights, best moments, or scene planning',
  reframe: 'automatic reframing or following a person',
  export_render: 'rendering, exporting, or delivery formats',
  media_assets: 'import, upload, download, media pool, or assets',
  projects: 'projects, sequences, versions, markers, or styles',
  web_skills: 'web search, crawling, skills, fonts, or code',
  generation: 'generate image, video, voice, music, sound, or motion graphics',
  undo_redo: 'undo or redo a previous change',
};

const FAMILY_TO_TOOLS: Readonly<Record<SemanticIntentFamily, readonly string[]>> = {
  timeline_edit: ['update_item_props', 'move_item', 'set_item_timing', 'edit_track', 'edit_item', 'manage_timelines'],
  split: ['split_item', 'edit_item'],
  remove: ['remove_item', 'edit_item'],
  trim: ['set_item_timing', 'edit_item', 'split_item'],
  aspect_layout: ['set_aspect_ratio', 'apply_layout', 'auto_reframe'],
  captions: ['read_captions', 'edit_captions', 'edit_item', 'apply_caption_avoidance'],
  transcription: ['transcribe_track', 'read_transcript', 'find_transcript', 'manage_transcript'],
  silence: ['remove_silence', 'read_transcript', 'find_transcript', 'clean_script'],
  audio_music: ['list_audio', 'add_audio', 'normalize_loudness', 'detect_beats', 'music_edit_plan', 'sync_cuts_to_music'],
  effects: ['browse_library', 'manage_effects', 'edit_item', 'list_templates', 'search_templates', 'update_watermark'],
  color: ['inspect_color', 'auto_grade', 'manage_effects'],
  scenes: ['detect_scenes', 'find_highlights', 'review_scene_plan', 'view_timeline_frames'],
  reframe: ['auto_reframe', 'view_asset_frames', 'view_timeline_frames'],
  export_render: ['submit_export', 'submit_render_job', 'track_export', 'verify_export', 'read_export_history'],
  media_assets: ['search_media', 'manage_media_pool', 'import_media', 'edit_asset', 'download_media', 'probe_media'],
  projects: ['list_projects', 'manage_timelines', 'manage_versions', 'manage_markers', 'manage_design_style', 'target_project'],
  web_skills: ['web_search', 'web_browser', 'web_crawl', 'manage_skill', 'run_code', 'search_fonts'],
  generation: ['submit_image', 'submit_video', 'submit_voice', 'submit_music', 'submit_sound', 'submit_motion_graphic'],
  undo_redo: ['undo_last_change', 'redo_last_change'],
};

const MUTATING_FAMILIES = new Set<SemanticIntentFamily>([
  'timeline_edit', 'split', 'remove', 'trim', 'aspect_layout', 'captions', 'silence',
  'audio_music', 'effects', 'color', 'reframe', 'export_render', 'media_assets',
  'projects', 'generation', 'undo_redo',
]);

export interface SemanticIntentMetrics {
  readonly path: 'fast-path' | 'semantic' | 'fallback';
  readonly usedResolver: boolean;
  readonly latencyMs: number;
  readonly confidence?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly estimatedInputTokens?: number;
  readonly fallbackReason?: string;
}

export interface SemanticIntentResolution {
  readonly families: readonly SemanticIntentFamily[];
  readonly toolNames: readonly string[];
  readonly confidence: number;
  readonly metrics: SemanticIntentMetrics;
}

export interface SemanticIntentResolverDependencies {
  readonly generate?: (options: {
    readonly system: string;
    readonly prompt: string;
    readonly maxOutputTokens: number;
    readonly provider: LlmProvider;
    readonly model: string;
  }) => Promise<GeneratedAgentTextResult>;
  /** Test seam for the existing AgentSettings pattern. */
  readonly config?: Partial<SemanticIntentResolverConfig>;
}

const FAMILY_NAMES = Object.keys(FAMILY_DESCRIPTIONS) as SemanticIntentFamily[];

function textFromMessage(message: ModelMessage): string {
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return '';
  return message.content.flatMap((part) => (
    part && typeof part === 'object' && 'text' in part && typeof part.text === 'string'
      ? [part.text]
      : []
  )).join(' ');
}

function userMessages(messages: readonly ModelMessage[]): readonly string[] {
  return messages
    .filter((message) => message.role === 'user')
    .map(textFromMessage)
    .map((text) => text.trim())
    .filter(Boolean)
    .slice(-2);
}

function currentUserText(messages: readonly ModelMessage[]): string {
  return userMessages(messages).at(-1) ?? '';
}

function isConversationalOnly(text: string): boolean {
  return new Set(['hola', 'gracias', 'muchas gracias', 'ok', 'vale', 'perfecto', 'hello', 'thanks', '你好']).has(
    normalizeIntentText(text),
  );
}

function shouldResolve(messages: readonly ModelMessage[]): boolean {
  const current = currentUserText(messages);
  if (!current || isConversationalOnly(current)) return false;
  const normalized = normalizeIntentText(current);
  const routed = routedToolSelection(normalized, false);
  const vagueContinuation = /\b(hazlo|dale|aplica|continua)\b/.test(normalized);
  return routed.matchedGroupCount === 0 || routed.overflow || vagueContinuation;
}

function compactContext(messages: readonly ModelMessage[]): string {
  return userMessages(messages)
    .map((text, index, all) => `${index === all.length - 1 ? 'current' : 'previous'}: ${text.slice(0, 600)}`)
    .join('\n');
}

function resolverPrompt(messages: readonly ModelMessage[]): string {
  const families = FAMILY_NAMES.map((family) => `${family}: ${FAMILY_DESCRIPTIONS[family]}`).join('\n');
  return [
    'Classify the user intent for a video editor. Return JSON only:',
    '{"confidence":0.0,"families":["timeline_edit"]}',
    'Use only the listed family ids. Use [] and low confidence when the request is conversational, hypothetical, unclear, or lacks an actionable editing intent.',
    'Do not invent tools, arguments, ids, or actions. This is discovery only; it never executes an edit.',
    'Available intent families:', families,
    'Recent minimal conversation:', compactContext(messages),
  ].join('\n');
}

function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(trimmed); } catch { /* try the first JSON object only */ }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('resolver returned invalid JSON');
  return JSON.parse(trimmed.slice(start, end + 1));
}

function recordFrom(value: unknown): { confidence: number; families: SemanticIntentFamily[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('resolver response is not an object');
  const raw = value as Record<string, unknown>;
  const confidence = typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)
    ? Math.max(0, Math.min(1, raw.confidence))
    : 0;
  const families = Array.isArray(raw.families)
    ? raw.families.filter((family): family is SemanticIntentFamily => typeof family === 'string' && FAMILY_NAMES.includes(family as SemanticIntentFamily))
    : [];
  return { confidence, families: [...new Set(families)] };
}

function fallback(metrics: Omit<SemanticIntentMetrics, 'path' | 'usedResolver'>): SemanticIntentResolution {
  return { families: [], toolNames: [], confidence: 0, metrics: { ...metrics, path: 'fallback', usedResolver: true } };
}

export async function resolveSemanticIntent(
  catalog: readonly AgentToolSchema[],
  messages: readonly ModelMessage[],
  dependencies: SemanticIntentResolverDependencies = {},
): Promise<SemanticIntentResolution> {
  const started = performance.now();
  const config = activeResolverConfig(dependencies.config);
  if (!config.enabled || !shouldResolve(messages)) {
    return {
      families: [],
      toolNames: [],
      confidence: 0,
      metrics: { path: 'fast-path', usedResolver: false, latencyMs: 0 },
    };
  }
  if (!dependencies.generate && !getAgentModelSnapshot().choices.some((choice) => (
    choice.backend === 'api' && choice.provider === config.provider
  ))) {
    return fallback({ latencyMs: performance.now() - started, fallbackReason: 'gemini-not-configured' });
  }
  const generate = dependencies.generate ?? generateAgentTextDetailed;
  try {
    const result = await generate({
      system: 'You are a tiny intent classifier. Never execute tools and never rewrite the user message.',
      prompt: resolverPrompt(messages),
      maxOutputTokens: config.maxOutputTokens,
      provider: config.provider,
      model: config.model,
    });
    const parsed = recordFrom(parseJson(result.text));
    const selectedFamilies = parsed.families.filter((family) => (
      parsed.confidence >= config.confidenceThreshold
      && (!MUTATING_FAMILIES.has(family) || parsed.confidence >= config.mutationConfidenceThreshold)
    ));
    const catalogNames = new Set(catalog.map((schema) => schema.name));
    const toolNames = [...new Set(selectedFamilies.flatMap((family) => FAMILY_TO_TOOLS[family]))]
      .filter((name) => catalogNames.has(name));
    return {
      families: selectedFamilies,
      toolNames,
      confidence: parsed.confidence,
      metrics: {
        path: toolNames.length ? 'semantic' : 'fallback',
        usedResolver: true,
        latencyMs: performance.now() - started,
        confidence: parsed.confidence,
        ...(result.usage?.inputTokens !== undefined ? { inputTokens: result.usage.inputTokens } : {}),
        ...(result.usage?.outputTokens !== undefined ? { outputTokens: result.usage.outputTokens } : {}),
        estimatedInputTokens: Math.ceil(resolverPrompt(messages).length / 4),
        ...(toolNames.length ? {} : { fallbackReason: 'low-confidence-or-no-canonical-family' }),
      },
    };
  } catch (error) {
    return fallback({
      latencyMs: performance.now() - started,
      fallbackReason: error instanceof Error ? error.message : String(error),
    });
  }
}
