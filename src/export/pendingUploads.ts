import type { TimelineItem } from '../editor/types';

export const PENDING_UPLOAD_EXPORT_MESSAGE = 'Uno o más videos todavía se están subiendo o procesando. Espera a que terminen antes de exportar.';

/** A blob URL belongs to an in-browser upload and is not available to renderers yet. */
export function hasPendingUpload(items: ReadonlyArray<Pick<TimelineItem, 'src'>>): boolean {
  return items.some((item) => item.src?.startsWith('blob:') ?? false);
}
