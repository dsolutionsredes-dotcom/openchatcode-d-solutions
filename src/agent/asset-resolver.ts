import type { MediaAsset, MediaAssetKind } from '../editor/types';

export type AssetResolution =
  | { status: 'resolved'; asset: MediaAsset }
  | { status: 'ambiguous'; candidates: MediaAsset[] }
  | { status: 'not_found' };

export interface AssetResolveOptions {
  kind?: MediaAssetKind;
  references?: unknown[];
}

const IGNORED_WORDS = new Set([
  'el', 'la', 'los', 'las', 'imagen', 'image', 'foto', 'video', 'audio', 'archivo', 'file',
]);

function plain(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function withoutExtension(value: string): string {
  return value.replace(/\.[^.\\/]+$/, '');
}

/** Stable comparison key: case/accent/extension/separator insensitive. */
export function normalizeAssetName(value: string): string {
  return plain(withoutExtension(value)).replace(/[\s\-_\p{P}\p{S}]+/gu, '');
}

function words(value: string): string[] {
  return plain(withoutExtension(value))
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word && !IGNORED_WORDS.has(word));
}

function queryForms(value: string): string[] {
  const forms = new Set<string>();
  const raw = value.trim();
  if (raw) {
    forms.add(raw.toLowerCase());
    forms.add(withoutExtension(raw).toLowerCase());
    forms.add(normalizeAssetName(raw));
  }
  const tokens = words(value);
  // Asset names are normally short. Limiting the window avoids treating a whole
  // sentence as a filename while still handling "la imagen del banner".
  for (let from = 0; from < tokens.length; from += 1) {
    for (let to = from + 1; to <= Math.min(tokens.length, from + 3); to += 1) {
      forms.add(tokens.slice(from, to).join(''));
    }
  }
  return [...forms].filter(Boolean);
}

function levenshtein(left: string, right: string): number {
  if (!left) return right.length;
  if (!right) return left.length;
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const current = row[j]!;
      row[j] = Math.min(
        row[j]! + 1,
        row[j - 1]! + 1,
        previous + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      previous = current;
    }
  }
  return row[right.length]!;
}

function result(matches: MediaAsset[]): AssetResolution {
  return matches.length === 1
    ? { status: 'resolved', asset: matches[0]! }
    : matches.length > 1
      ? { status: 'ambiguous', candidates: matches }
      : { status: 'not_found' };
}

function referenceIds(references: unknown[] | undefined): string[] {
  if (!references) return [];
  return references.flatMap((reference) => {
    if (!reference || typeof reference !== 'object') return [];
    const item = reference as Record<string, unknown>;
    return [item.assetId, item.id].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  });
}

function detectedKind(text: string): MediaAssetKind | undefined {
  const tokenSet = new Set(plain(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  if (tokenSet.has('imagen') || tokenSet.has('image') || tokenSet.has('foto')) return 'image';
  if (tokenSet.has('audio')) return 'audio';
  if (tokenSet.has('video')) return 'video';
  return undefined;
}

/**
 * Resolve a human asset reference without involving an LLM. Exact ids and
 * names always win; fuzzy matching is deliberately limited to one edit and
 * only returns an asset when that result is unique.
 */
export function resolveAssetReference(
  assets: readonly MediaAsset[],
  reference: string,
  options: AssetResolveOptions = {},
): AssetResolution {
  const kind = options.kind ?? detectedKind(reference);
  const eligible = assets.filter((asset) => !kind || asset.kind === kind);
  const directIds = referenceIds(options.references);
  for (const id of directIds) {
    const exact = eligible.filter((asset) => asset.id === id);
    if (exact.length) return result(exact);
  }

  const raw = reference.trim();
  if (!raw) return { status: 'not_found' };
  const exactId = eligible.filter((asset) => asset.id === raw);
  if (exactId.length) return result(exactId);
  const prefixes = eligible.filter((asset) => asset.id.startsWith(raw));
  if (prefixes.length) return result(prefixes);

  const exactName = eligible.filter((asset) => asset.name === raw);
  if (exactName.length) return result(exactName);
  const caseInsensitiveName = eligible.filter((asset) => asset.name.toLowerCase() === raw.toLowerCase());
  if (caseInsensitiveName.length) return result(caseInsensitiveName);

  const forms = queryForms(raw);
  const normalizedName = (asset: MediaAsset) => normalizeAssetName(asset.name);
  const normalizedMatches = eligible.filter((asset) => forms.includes(normalizedName(asset)));
  if (normalizedMatches.length) return result(normalizedMatches);

  const fuzzy = eligible.filter((asset) => {
    const name = normalizedName(asset);
    return name.length >= 5 && forms.some((form) => form.length >= 5 && levenshtein(form, name) <= 1);
  });
  return result(fuzzy);
}
