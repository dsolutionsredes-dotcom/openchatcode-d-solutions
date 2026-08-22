import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  EXTERNAL_DRAFT_TOOL_NAMES,
  EXTERNAL_EDIT_TOOL_NAMES,
  EXTERNAL_READ_TOOL_NAMES,
} from '../../src/agent/external-tool-policy.ts';
import {
  buildLibraryItems,
  type LibraryCategory,
  type LibraryItem,
} from '../../src/agent/tools/library-catalog.ts';
import { keyStatus } from '../keystore.ts';
import { isExternalApiAuthorized } from './projects.ts';

type PublicCapability = {
  capability: string;
  enabled: boolean;
  mode: 'server-tool' | 'external-api' | 'configured-provider';
  tool?: string;
  note?: string;
};

const CATEGORY_ALIASES: Record<string, LibraryCategory> = {
  transition: 'transitions',
  transitions: 'transitions',
  effect: 'fx',
  effects: 'fx',
  fx: 'fx',
  lut: 'luts',
  luts: 'luts',
  zoom: 'zoom',
  zooms: 'zoom',
  'audio-fx': 'audio-fx',
  'audio-effects': 'audio-fx',
  'sound-effects': 'sound-effects',
  sfx: 'sound-effects',
  'motion-graphics': 'motion-graphics',
};

const LIBRARY_CATEGORIES: readonly LibraryCategory[] = [
  'motion-graphics', 'luts', 'zoom', 'fx', 'audio-fx', 'sound-effects', 'transitions',
];

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function hasTool(name: string): boolean {
  return EXTERNAL_DRAFT_TOOL_NAMES.has(name);
}

function highLevelCapabilities(): PublicCapability[] {
  const status = keyStatus();
  return [
    {
      capability: 'edit_timeline',
      enabled: hasTool('edit_item'),
      mode: 'server-tool',
      tool: 'edit_item',
    },
    {
      capability: 'transitions',
      enabled: hasTool('browse_library') && hasTool('edit_item'),
      mode: 'server-tool',
      tool: 'browse_library + edit_item',
      note: 'El catálogo real se consulta con category=transitions.',
    },
    {
      capability: 'video_effects',
      enabled: hasTool('browse_library') && hasTool('manage_effects'),
      mode: 'server-tool',
      tool: 'browse_library + manage_effects',
      note: 'Incluye FX/LUT/zoom disponibles en el catálogo del servidor.',
    },
    {
      capability: 'audio_edit',
      enabled: hasTool('add_audio') || hasTool('edit_item'),
      mode: 'server-tool',
      tool: 'add_audio/edit_item',
    },
    {
      capability: 'denoise',
      enabled: hasTool('isolate_voice'),
      mode: 'server-tool',
      tool: 'isolate_voice',
      note: hasTool('isolate_voice')
        ? 'Reducción de ruido habilitada en modo servidor.'
        : 'Existe en el editor, pero isolate_voice no está expuesto al agente headless de AUTO_EDITOR.',
    },
    {
      capability: 'transcription',
      enabled: hasTool('transcribe_track') && status.caps.transcription,
      mode: 'configured-provider',
      tool: 'transcribe_track',
      note: status.caps.transcription
        ? 'Proveedor de transcripción configurado.'
        : 'La herramienta existe, pero falta proveedor/API configurado.',
    },
    {
      capability: 'captions',
      enabled: hasTool('edit_captions'),
      mode: 'server-tool',
      tool: 'edit_captions',
    },
    {
      capability: 'transcript_edit',
      enabled: hasTool('manage_transcript'),
      mode: 'server-tool',
      tool: 'manage_transcript',
    },
    {
      capability: 'media_pool',
      enabled: hasTool('manage_media_pool'),
      mode: 'server-tool',
      tool: 'manage_media_pool',
    },
    {
      capability: 'aspect_ratio_layout',
      enabled: hasTool('set_aspect_ratio') && hasTool('apply_layout'),
      mode: 'server-tool',
      tool: 'set_aspect_ratio/apply_layout',
    },
    {
      capability: 'preview_render',
      enabled: true,
      mode: 'external-api',
      note: 'Preview se gestiona por la API externa de runs/preview.',
    },
    {
      capability: 'final_render',
      enabled: true,
      mode: 'external-api',
      note: 'Render final se gestiona por /projects/:projectId/renders.',
    },
  ];
}

function toolRequiredForItem(item: LibraryItem): string | null {
  if (item.category === 'audio-fx') return 'isolate_voice';
  if (item.category === 'transitions') return 'edit_item';
  if (item.category === 'fx' || item.category === 'luts' || item.category === 'zoom') return 'edit_item';
  if (item.category === 'sound-effects') return 'edit_item';
  if (item.category === 'motion-graphics') return 'add_motion_graphic';
  return null;
}

function publicCatalogItem(item: LibraryItem) {
  const requiredTool = toolRequiredForItem(item);
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    description: item.description,
    group: item.group ?? null,
    requiredTool,
    serverExecutable: requiredTool ? hasTool(requiredTool) : true,
  };
}

function normalizedCategory(value: string | null): LibraryCategory | null {
  if (!value) return null;
  return CATEGORY_ALIASES[value.trim().toLowerCase()] ?? null;
}

export function isExternalCapabilitiesPath(value: string): boolean {
  const path = new URL(value || '/', 'http://localhost').pathname;
  return path === '/capabilities' || path === '/catalog';
}

/**
 * Read-only, authenticated introspection for AUTO_EDITOR.
 *
 * GET /api/external/capabilities
 * GET /api/external/catalog?category=transitions&search=fade&limit=100
 *
 * This endpoint reports the CURRENT server/headless policy. It does not expose
 * secret values and it never invents editor options.
 */
export async function handleExternalCapabilitiesRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!isExternalApiAuthorized(req)) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'method not allowed — use GET' });
    return;
  }

  const url = new URL(req.url ?? '/', 'http://localhost');

  if (url.pathname === '/capabilities') {
    const status = keyStatus();
    sendJson(res, 200, {
      engine: 'openchatcut',
      mode: 'headless-api',
      capabilities: highLevelCapabilities(),
      tools: {
        read: [...EXTERNAL_READ_TOOL_NAMES].sort(),
        edit: [...EXTERNAL_EDIT_TOOL_NAMES].sort(),
      },
      configuredProviderCapabilities: status.caps,
      catalogCategories: [...LIBRARY_CATEGORIES],
      catalogPath: '/api/external/catalog',
      note: 'Capabilities es la verdad del modo servidor de AUTO_EDITOR; el editor web puede tener funciones adicionales no expuestas aquí.',
    });
    return;
  }

  if (url.pathname === '/catalog') {
    const requested = url.searchParams.get('category');
    const category = normalizedCategory(requested);
    if (requested && !category) {
      sendJson(res, 400, {
        error: 'unknown catalog category',
        allowed: [...LIBRARY_CATEGORIES],
      });
      return;
    }

    const search = (url.searchParams.get('search') ?? '').trim().toLowerCase();
    const rawLimit = Number(url.searchParams.get('limit') ?? 100);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(250, Math.floor(rawLimit))) : 100;

    // The external server agent currently runs with templates:[]. The catalog
    // builder is deliberately shader-free, so this remains safe in VPS/headless mode.
    let items = buildLibraryItems([]);
    if (category) items = items.filter((item) => item.category === category);
    if (search) {
      items = items.filter((item) => (
        item.id.toLowerCase().includes(search)
        || item.name.toLowerCase().includes(search)
        || item.description.toLowerCase().includes(search)
        || (item.group ?? '').toLowerCase().includes(search)
      ));
    }

    const total = items.length;
    sendJson(res, 200, {
      engine: 'openchatcut',
      category: category ?? 'all',
      search: search || null,
      total,
      returned: Math.min(total, limit),
      templatesIncluded: false,
      items: items.slice(0, limit).map(publicCatalogItem),
    });
    return;
  }

  sendJson(res, 404, { error: 'not found' });
}
