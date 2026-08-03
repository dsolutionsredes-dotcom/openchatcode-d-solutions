// Central server-only provider configuration. It deliberately reuses the
// existing keystore, provider registry, and validation rules: secrets never
// cross this module's API boundary into HTTP responses or logs.
import { getKey, type KeyName } from './keystore.ts';
import { resolveLlmProviderConfig } from './llm-config.ts';
import { normalizeLlmProvider, normalizeOpenAiApiMode, LLM_PROVIDER_PRESETS, type LlmProvider, type OpenAiApiMode } from '../shared/llm-providers.ts';

export const PROVIDER_CATEGORIES = [
  'agent-brain', 'image', 'voice', 'video', 'music', 'transcription',
  'stock-media', 'media-storage', 'sandbox', 'web-scraping',
] as const;
export type ProviderCategory = (typeof PROVIDER_CATEGORIES)[number];

export interface ProviderConfigRequest {
  category: ProviderCategory;
  provider?: unknown;
  model?: unknown;
}

export interface AgentBrainProviderConfig {
  category: 'agent-brain';
  provider: LlmProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
  openAiApiMode: OpenAiApiMode;
}

function readKey(name: string): string { return getKey(name as KeyName); }

/**
 * Returns the existing LLM provider triplet for Agent Brain. Other categories
 * are intentionally recognized but not executed in this phase.
 */
export function resolveProviderConfig(request: ProviderConfigRequest): AgentBrainProviderConfig | undefined {
  if (request.category !== 'agent-brain') return undefined;
  const configured = resolveLlmProviderConfig(request.provider ?? readKey('LLM_PROVIDER'), readKey);
  const requestedModel = typeof request.model === 'string' && request.model.trim() ? request.model.trim() : configured.model;
  return {
    category: 'agent-brain',
    provider: configured.provider,
    apiKey: configured.apiKey,
    baseUrl: configured.baseUrl,
    model: requestedModel,
    openAiApiMode: normalizeOpenAiApiMode(readKey('LLM_OPENAI_API_MODE')),
  };
}

/** Configuration is usable only when the category's required secret is present. */
export function hasProviderCredentials(config: AgentBrainProviderConfig | undefined): config is AgentBrainProviderConfig {
  return !!config?.apiKey;
}

export type AgentProviderResolution = { selected: boolean; configs: AgentBrainProviderConfig[] };

export function resolveAgentBrainProviders(): AgentProviderResolution {
  const active = readKey('AGENT_ACTIVE_PROVIDER') || readKey('LLM_PROVIDER');
  if (!active || !LLM_PROVIDER_PRESETS.some((preset) => preset.id === active)) return { selected: false, configs: [] };
  const fallback = readKey('AGENT_FALLBACK_PROVIDERS').split(',').map((value) => value.trim()).filter(Boolean);
  const providers = [...new Set([active, ...fallback])].filter((value) => LLM_PROVIDER_PRESETS.some((preset) => preset.id === value));
  const activeModel = readKey('AGENT_ACTIVE_MODEL');
  return { selected: true, configs: providers.map((provider, index) => resolveProviderConfig({
    category: 'agent-brain', provider: normalizeLlmProvider(provider), model: index === 0 ? activeModel : undefined,
  })!) };
}
