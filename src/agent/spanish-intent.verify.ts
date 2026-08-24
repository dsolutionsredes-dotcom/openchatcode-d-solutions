import assert from 'node:assert/strict';
import { agentLanguagePrompt } from './systemPrompt';
import { normalizeIntentText } from './intent-normalization';
import { ToolActivation } from './tool-activation';
import { routedToolNames } from './tool-routing';
import { TOOL_SCHEMAS } from './tools';
import { execCoreTool } from './tools/core-tools';

const names = (text: string): ReadonlySet<string> => routedToolNames(text, false);
const activation = (text: string): ReadonlySet<string> => (
  new ToolActivation(TOOL_SCHEMAS, [{ role: 'user', content: text }]).names()
    .reduce((set, name) => set.add(name), new Set<string>())
);
const assertAny = (text: string, expected: readonly string[], source: ReadonlySet<string>) => {
  assert.ok(expected.some((name) => source.has(name)), `${text} routes to ${expected.join(', ')}`);
};

const original = 'hazlo tipo réél, súbele el color';
assert.equal(normalizeIntentText(original), 'hazlo tipo reel subele el color');
assert.equal(original, 'hazlo tipo réél, súbele el color', 'normalization never mutates original text');

assert.equal(names('hola').size, 0, 'hola does not route an edit group');
assertAny('cambia el proyecto a vertical', ['set_aspect_ratio', 'apply_layout', 'auto_reframe'], activation('cambia el proyecto a vertical'));
assertAny('hazlo formato reel', ['set_aspect_ratio', 'apply_layout', 'auto_reframe'], names('hazlo formato reel'));
assertAny('corta este clip', ['edit_item', 'split_item', 'remove_item'], activation('corta este clip'));
assertAny('quita esta parte', ['edit_item', 'remove_item', 'split_item'], activation('quita esta parte'));
assertAny('pon subtitulos', ['read_captions', 'edit_captions', 'edit_item'], activation('pon subtitulos'));
assertAny('transcribe el video', ['transcribe_track', 'read_transcript'], activation('transcribe el video'));
assertAny('quita silencios', ['remove_silence', 'clean_script'], activation('quita silencios'));
assertAny('sube el volumen de la musica', ['list_audio', 'normalize_loudness', 'music_edit_plan'], activation('sube el volumen de la musica'));
assertAny('pon una transicion suave', ['browse_library', 'manage_effects', 'edit_item'], activation('pon una transicion suave'));
assertAny('haz un zoom cuando empiece a hablar', ['browse_library', 'manage_effects', 'edit_item'], activation('haz un zoom cuando empiece a hablar'));
assertAny('corrige el color', ['inspect_color', 'auto_grade', 'manage_effects'], activation('corrige el color'));
assertAny('sube la saturacion y baja los blancos', ['inspect_color', 'auto_grade', 'manage_effects'], activation('sube la saturacion y baja los blancos'));
assertAny('sincroniza los cortes con la musica', ['detect_beats', 'music_edit_plan', 'sync_cuts_to_music'], activation('sincroniza los cortes con la musica'));
assertAny('busca las mejores escenas', ['find_highlights', 'detect_scenes', 'review_scene_plan'], activation('busca las mejores escenas'));
assertAny('reencuadralo siguiendo a la persona', ['auto_reframe'], activation('reencuadralo siguiendo a la persona'));
assertAny('haz picture in picture', ['apply_layout'], activation('haz picture in picture'));
assertAny('renderiza en vertical', ['submit_render_job', 'submit_export', 'set_aspect_ratio'], activation('renderiza en vertical'));
assert.equal(activation('solo revisa el proyecto, no cambies nada').has('edit_project'), false, 'Spanish read-only suppresses mutation routing');

async function search(query: string): Promise<Set<string>> {
  const result = await execCoreTool('ToolSearch', { query, limit: 12 }, {} as never, TOOL_SCHEMAS) as {
    results?: Array<{ name?: string }>;
  };
  return new Set((result.results ?? []).flatMap((item) => item.name ? [item.name] : []));
}

const formatSearch = await search('cambiar formato vertical');
assertAny('ToolSearch formato vertical', ['set_aspect_ratio', 'apply_layout', 'auto_reframe'], formatSearch);
assert.equal(formatSearch.has('edit_project'), false, 'format discovery does not prefer edit_project');
assertAny('ToolSearch media timeline', ['edit_item', 'import_media', 'search_media'], await search('agrega el video a la linea de tiempo'));
assertAny('ToolSearch corregir color', ['inspect_color', 'auto_grade', 'manage_effects'], await search('corregir color'));
assertAny('ToolSearch transicion', ['browse_library', 'manage_effects'], await search('poner transicion'));
assertAny('ToolSearch silencios', ['remove_silence'], await search('quitar silencios'));
assertAny('ToolSearch musica', ['detect_beats', 'music_edit_plan', 'sync_cuts_to_music'], await search('sincronizar cortes con musica'));
assertAny('ToolSearch glitch', ['browse_library', 'manage_effects'], await search('buscar efecto glitch'));

assert.match(agentLanguagePrompt('es'), /Spanish/);
assert.match(agentLanguagePrompt('en'), /English/);
assert.match(agentLanguagePrompt('zh'), /Chinese/);

for (const text of ['trim the clip', 'vertical video', 'remove silence']) {
  assert.ok(activation(text).size > 0, `English remains routable: ${text}`);
}
for (const text of ['剪辑片段', '竖屏视频', '删除静音']) {
  assert.ok(activation(text).size > 0, `Chinese remains routable: ${text}`);
}

console.log(`spanish-intent.verify: ${TOOL_SCHEMAS.length} canonical tools preserved`);
