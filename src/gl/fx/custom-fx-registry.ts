import type { FxDef } from './uniforms.js';

/** Shared runtime registry for plugin/custom effects. It contains no shader imports. */
export const CUSTOM_FX: Record<string, FxDef> = {};
