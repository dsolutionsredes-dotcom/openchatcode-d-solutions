// Central server-only provider configuration. It deliberately reuses the
// existing keystore, provider registry, and validation rules: secrets never
// cross this module's API boundary into HTTP responses or logs.
import { getKey, type KeyName } from './keystore.ts';
import { resolveLlmProviderConfig } from './llm-config.ts';
import { normalizeOpenAiApiMode, type LlmProvider, type OpenAiApiMode } from '../shared/llm-providers.ts';

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
