/**
 * Browser-independent labels and order for the built-in Library.
 * Keep this file free of editor, WebGL, and shader imports: it is also used
 * by the VPS/headless external catalog endpoint.
 */

export const ZOOM_SHAPE_LABELS = {
  punch: '冲击',
  hold: '推进拉回',
  'slow-push': '慢推',
  instant: '瞬时',
  'zoom-out': '拉远',
  'ease-in': '缓入推近',
  bounce: '弹性推近',
  snap: '快切推近',
  pulse: '心跳脉冲',
  'whip-in': '甩入推近',
} as const;

export const ZOOM_SHAPE_ORDER = [
  'punch', 'hold', 'slow-push', 'instant', 'zoom-out', 'ease-in', 'bounce',
  'snap', 'pulse', 'whip-in',
] as const;

export const TRANSITION_LABELS = {
  'anticipation-zoom': '推进转场',
  'clean-line-wipe': '白色划线转场',
  'cross-dissolve': '叠化转场',
  'dip-to-black': '闪黑转场',
  flash: '闪白转场',
  'impact-shake': '冲击抖动转场',
  'luma-blend': '叠加转场',
  'organic-dissolve': '光溶转场',
  'page-curl': '翻页转场',
  'rack-focus': '焦点转场',
  'soft-wipe': '柔化擦除转场',
  'whip-pan': '甩镜转场',
  'circle-wipe': '圆形擦除转场',
  'radial-blur': '径向模糊转场',
  'glitch-cut': '故障切换转场',
  'dip-to-color': '闪色转场',
  'audio-cross-fade': '音频交叉淡化',
  'custom-shader': '自定义着色器转场',
} as const;

export const TRANSITION_ORDER = [
  'anticipation-zoom', 'clean-line-wipe', 'cross-dissolve', 'dip-to-black',
  'flash', 'impact-shake', 'luma-blend', 'organic-dissolve', 'page-curl',
  'rack-focus', 'soft-wipe', 'whip-pan', 'circle-wipe', 'radial-blur',
  'glitch-cut', 'dip-to-color',
] as const;

export const AUDIO_TRANSITION_ORDER = ['audio-cross-fade'] as const;
