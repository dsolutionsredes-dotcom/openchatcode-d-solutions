import type { Locale } from '../i18n/locale';

/** Normalizes only intent-matching text; callers keep the original user text. */
export function normalizeIntentText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[“”„‟«»]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function agentLanguageName(locale: Locale): 'Chinese' | 'English' | 'Spanish' {
  return locale === 'zh' ? 'Chinese' : locale === 'es' ? 'Spanish' : 'English';
}

/** Search-only aliases. Technical tool names and schemas remain canonical. */
const TOOL_ALIAS_GROUPS: ReadonlyArray<readonly [readonly string[], string]> = [
  [['update_item_props', 'move_item', 'set_item_timing', 'duplicate_item', 'remove_item', 'split_item', 'edit_track', 'edit_item', 'manage_timelines'], 'editar cambiar modificar cortar recortar dividir mover eliminar borrar acortar alargar velocidad clip elemento pista linea de tiempo secuencia agregar video linea tiempo anadir video timeline'],
  [['set_aspect_ratio', 'apply_layout', 'auto_reframe'], 'formato vertical horizontal relacion de aspecto proporcion reel short shorts tiktok cuadrado llenar pantalla recortar lados reencuadrar'],
  [['read_captions', 'edit_captions', 'apply_caption_avoidance', 'place_graphics_in_safe_zone'], 'subtitulos subtitulado texto en pantalla'],
  [['read_transcript', 'find_transcript', 'clean_script', 'edit_gap', 'delete_text', 'manage_transcript', 'read_script', 'apply_script', 'transcribe_track'], 'transcribir transcripcion guion texto hablado voz discurso locucion'],
  [['remove_silence', 'edit_gap', 'delete_text', 'clean_script'], 'quitar silencios silencio pausas muletillas palabras de relleno'],
  [['list_audio', 'add_audio', 'normalize_loudness', 'isolate_voice', 'analyze_music', 'inspect_music', 'music_edit_plan', 'sync_cuts_to_music', 'detect_beats', 'music_image_plan', 'sync_images_to_music'], 'audio musica sonido volumen subir bajar ritmo beats compases sincronizar cortes musica'],
  [['browse_library', 'manage_effects', 'list_templates', 'search_templates', 'manage_template', 'update_watermark', 'add_motion_graphic', 'create_motion_graphic', 'create_motion_graphic_from_code'], 'biblioteca efecto efectos transicion transiciones zoom acercamiento glitch lut plantilla plantillas marca de agua grafico'],
  [['submit_image', 'submit_video', 'submit_voice', 'submit_music', 'submit_sound', 'submit_shader', 'submit_motion_graphic', 'rerun_generation'], 'generar imagen video voz musica sonido motion graphics animacion'],
  [['search_media', 'manage_media_pool', 'download_media', 'push_asset', 'import_url_asset', 'search_stock_media', 'edit_asset', 'import_media', 'finalize_uploaded_asset', 'request_asset_download', 'probe_media', 'import_asset', 'import_folder'], 'media medios archivo recurso asset importar subir descargar banco stock video'],
  [['submit_export', 'submit_render_job', 'track_export', 'read_export_history', 'verify_export', 'download_media', 'export_motion_graphic_prores'], 'exportar exportacion renderizar render video final prores premiere resolve'],
  [['list_projects', 'create_project', 'delete_project', 'restore_project', 'duplicate_project', 'edit_project', 'target_project', 'get_editor_url', 'manage_versions', 'manage_markers', 'manage_design_style'], 'proyecto proyectos secuencia version versiones marcador marcadores estilo diseño'],
  [['view_timeline_frames', 'view_asset_frames', 'detect_scenes', 'find_highlights', 'review_scene_plan'], 'escenas escena mejores escenas destacados highlights'],
  [['multicam_sync', 'change_cam'], 'multicam multicamara camara angulos'],
  [['inspect_color', 'auto_grade', 'manage_effects'], 'color corregir correccion exposicion contraste saturacion blancos negros temperatura balance grading'],
  [['web_browser', 'web_search', 'web_map', 'web_crawl', 'web_batch_scrape', 'manage_skill', 'install_skill', 'run_skill_script', 'run_code', 'search_fonts'], 'web buscar busqueda internet navegador sitio pagina rastrear skill codigo fuentes'],
  [['manage_link_group', 'undo_last_change', 'redo_last_change'], 'deshacer rehacer undo redo revertir'],
  [['apply_layout'], 'composicion picture in picture pip pantalla dividida split screen grid cuadricula layout'],
];

const TOOL_ALIASES = new Map<string, string>();
for (const [names, aliases] of TOOL_ALIAS_GROUPS) {
  for (const name of names) {
    const previous = TOOL_ALIASES.get(name);
    TOOL_ALIASES.set(name, previous ? `${previous} ${aliases}` : aliases);
  }
}

export function toolSearchAliases(toolName: string): string {
  return TOOL_ALIASES.get(toolName) ?? '';
}
