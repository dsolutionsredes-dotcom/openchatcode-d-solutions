export const EXTERNAL_READ_TOOL_NAMES = new Set([
  'read_timeline', 'list_templates', 'search_templates', 'list_audio',
  'read_script', 'view_timeline_frames', 'view_asset_frames', 'browse_library',
  'read_captions', 'read_project', 'read_transcript', 'find_transcript',
  'search_fonts', 'read_export_history', 'track_export', 'verify_export',
  'probe_media', 'ToolSearch',
]);

export const EXTERNAL_EDIT_TOOL_NAMES = new Set([
  'add_motion_graphic', 'update_item_props', 'move_item', 'set_item_timing',
  'duplicate_item', 'remove_item', 'split_item', 'add_audio', 'clear_timeline',
  'set_aspect_ratio', 'manage_timelines', 'edit_track', 'apply_script',
  'edit_item', 'manage_effects', 'edit_captions', 'update_watermark',
  'manage_markers', 'transcribe_track', 'clean_script', 'edit_gap',
  'delete_text', 'manage_transcript', 'apply_layout', 'edit_project',
  'submit_render_job',
]);

export const EXTERNAL_DRAFT_TOOL_NAMES = new Set([
  ...EXTERNAL_READ_TOOL_NAMES,
  ...EXTERNAL_EDIT_TOOL_NAMES,
]);

export function isExternalReadTool(name: string): boolean {
  return EXTERNAL_READ_TOOL_NAMES.has(name);
}

export function isExternalDraftTool(name: string): boolean {
  return EXTERNAL_DRAFT_TOOL_NAMES.has(name);
}
