import { CSS_TRANSITION_TYPES, GLSL_TRANSITION_TYPES, isRasterMediaKind } from './types';
import type { CssTransitionType, TimelineItem } from './types';

type TransitionClip = Pick<TimelineItem, 'kind' | 'transform' | 'zoom' | 'keyframes' | 'filters' | 'effects'>;

export type VisualTransitionRoute =
  | { renderer: 'gl' }
  | { renderer: 'css'; type: CssTransitionType };

/**
 * The staging compositor handles transform, zoom/reframe and keyframes. Effects
 * and filters still need the DOM path until their visual passes are rasterized too.
 */
export function needsClipWrapperTransition(item: TransitionClip | undefined): boolean {
  return !!item && (
    item.filters !== undefined
    || item.effects !== undefined
  );
}

function isTexturable(item: TransitionClip | undefined): boolean {
  return !!item && isRasterMediaKind(item.kind) && item.kind !== 'svg' && item.kind !== 'gif';
}

/** Raster media with supported framing state stays on the real GLSL path. */
export function routeVisualTransition(
  type: string,
  outgoing: TransitionClip | undefined,
  incoming: TransitionClip | undefined,
): VisualTransitionRoute {
  if (
    GLSL_TRANSITION_TYPES.has(type)
    && isTexturable(outgoing)
    && isTexturable(incoming)
    && !needsClipWrapperTransition(outgoing)
    && !needsClipWrapperTransition(incoming)
  ) return { renderer: 'gl' };

  return {
    renderer: 'css',
    type: CSS_TRANSITION_TYPES.has(type) ? type as CssTransitionType : 'cross-dissolve',
  };
}
