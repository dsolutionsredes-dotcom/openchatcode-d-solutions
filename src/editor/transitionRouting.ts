import { CSS_TRANSITION_TYPES, GLSL_TRANSITION_TYPES, isRasterMediaKind } from './types';
import type { CssTransitionType, TimelineItem } from './types';

type TransitionClip = Pick<TimelineItem, 'kind' | 'transform' | 'zoom' | 'keyframes' | 'filters' | 'effects'>;

export type VisualTransitionRoute =
  | { renderer: 'gl' }
  | { renderer: 'css'; type: CssTransitionType };

/**
 * GlTransition renders fresh source textures, bypassing ClipWrapper. Any of these
 * properties therefore requires the DOM/CSS path so crop, reframe, zoom and FX
 * continue to be applied to both sides of the transition.
 */
export function needsClipWrapperTransition(item: TransitionClip | undefined): boolean {
  return !!item && (
    item.transform !== undefined
    || item.zoom !== undefined
    || item.keyframes !== undefined
    || item.filters !== undefined
    || item.effects !== undefined
  );
}

function isTexturable(item: TransitionClip | undefined): boolean {
  return !!item && isRasterMediaKind(item.kind) && item.kind !== 'svg' && item.kind !== 'gif';
}

/** Choose GL only when both clips can be rendered without losing ClipWrapper state. */
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
