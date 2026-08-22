import type { FxDef } from './uniforms';

/** Runtime-only custom FX registry shared by the browser renderer and catalog. */
export const CUSTOM_FX: Record<string, FxDef> = {};
