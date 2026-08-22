/** Browser-independent catalog metadata for built-in FX and LUTs. */
export interface FxCatalogMetadata {
  id: string;
  name: string;
  desc: string;
}

export const FX_METADATA: Record<string, FxCatalogMetadata> = {
  'builtin:fx-luma-key': { id: 'builtin:fx-luma-key', name: '黑底叠加', desc: '把黑色背景变透明、保留亮部，像 Screen 混合——叠加火焰/烟雾/漏光/粒子等黑底素材。' },
  'builtin:fx-local-mosaic': { id: 'builtin:fx-local-mosaic', name: '局部马赛克', desc: '对矩形区域打码，可调位置/尺寸/块大小/羽化。' },
  'builtin:fx-magnify': { id: 'builtin:fx-magnify', name: '放大镜', desc: '在指定圆心加一个放大镜头，可调半径/倍率/边框。' },
  'builtin:fx-rect-mask': { id: 'builtin:fx-rect-mask', name: '方形蒙版', desc: '把画面裁成圆角矩形，可调位置/尺寸/圆角/羽化/反转。' },
  'builtin:fx-circle-mask': { id: 'builtin:fx-circle-mask', name: '圆形蒙版', desc: '把画面裁成柔边圆形，可调圆心/半径/羽化/反转。' },
  'builtin:fx-crt': { id: 'builtin:fx-crt', name: 'CRT 复古显像管', desc: '模拟 CRT 显像管：扫描线/屏幕弯曲/RGB 偏移/噪点/暗角。动画。' },
  'builtin:fx-ascii-rain': { id: 'builtin:fx-ascii-rain', name: 'ASCII 字符雨', desc: '在视频亮部生成蓝色发光 ASCII 字符雨。' },
  'builtin:fx-shake': { id: 'builtin:fx-shake', name: '手持运镜', desc: 'fbm 噪声抖动 + 旋转/缩放/呼吸，模拟手持相机运动。动画。' },
  'builtin:fx-tilt-shift': { id: 'builtin:fx-tilt-shift', name: '移轴镜头', desc: '模拟移轴镜头：一条焦点带清晰、上下渐糊 + 饱和度/暗角。两遍可分离高斯模糊。' },
  'builtin:fx-chroma-key': { id: 'builtin:fx-chroma-key', name: '色度键/绿幕', desc: '按键色（默认绿幕）抠除背景，可调容差/羽化/溢色抑制。' },
  'builtin:fx-color-wheels': { id: 'builtin:fx-color-wheels', name: '三路色轮', desc: '调色台三路色轮：lift 暗部偏移、gamma 中间调、gain 亮部增益，均以 0.5 灰为中性，逐通道作用。' },
  'builtin:fx-levels': { id: 'builtin:fx-levels', name: '色阶', desc: '输入黑/白场重映射 + 中间调 Gamma + 输出黑/白场（逐通道），配合 inspect_color 的黑白点读数使用。' },
  'builtin:fx-highlights-shadows': { id: 'builtin:fx-highlights-shadows', name: '高光/阴影', desc: '按亮度软掩膜分别调整：提亮暗部（保护高光）、回收或增强高光。' },
  'builtin:fx-clarity': { id: 'builtin:fx-clarity', name: '清晰度', desc: '中间调局部对比（亮度 unsharp）：正值增质感，负值柔化肤质。' },
  'builtin:fx-hsl-qualify': { id: 'builtin:fx-hsl-qualify', name: 'HSL 定向调整', desc: '二级校色：只对选中的色相区间（中心±宽度+羽化）做色相偏移/饱和度/明度调整；肤色、天空、品牌色定向修。' },
  'builtin:fx-vignette': { id: 'builtin:fx-vignette', name: '暗角', desc: '四周压暗，突出中心主体。可调强度/柔和/圆度。' },
  'builtin:fx-film-grain': { id: 'builtin:fx-film-grain', name: '胶片颗粒', desc: '动态胶片噪点质感。动画。' },
  'builtin:fx-rgb-split': { id: 'builtin:fx-rgb-split', name: 'RGB 分离', desc: '通道错位色差，赛博/故障感。' },
  'builtin:fx-glitch': { id: 'builtin:fx-glitch', name: '故障闪烁', desc: '横向切片错位 + 偶发反色/色差。动画。' },
  'builtin:fx-bloom': { id: 'builtin:fx-bloom', name: '光晕 Bloom', desc: '亮部溢光，电影高光感。' },
  'builtin:fx-pixelate': { id: 'builtin:fx-pixelate', name: '像素化', desc: '整帧像素块风格化。' },
  'builtin:fx-posterize': { id: 'builtin:fx-posterize', name: '色调分离', desc: '减少色阶，插画/海报感。' },
  'builtin:fx-duotone': { id: 'builtin:fx-duotone', name: '双色调', desc: '按亮度映射阴影色与高光色。' },
  'builtin:fx-mirror': { id: 'builtin:fx-mirror', name: '镜像对称', desc: '左右/上下镜像拼贴。mode: 0左→右 1右→左 2上→下 3下→上。' },
  'builtin:fx-fisheye': { id: 'builtin:fx-fisheye', name: '鱼眼', desc: '桶形畸变广角效果。' },
  'builtin:fx-kaleidoscope': { id: 'builtin:fx-kaleidoscope', name: '万花筒', desc: '径向分片镜像，万花筒图案。' },
  'builtin:fx-edge-glow': { id: 'builtin:fx-edge-glow', name: '边缘发光', desc: 'Sobel 边缘检测叠加彩色描边。' },
  'builtin:fx-soft-blur': { id: 'builtin:fx-soft-blur', name: '柔焦模糊', desc: '轻量全图柔焦。' },
  'builtin:fx-light-leak': { id: 'builtin:fx-light-leak', name: '漏光', desc: '胶片漏光色带，轻微呼吸动画。' },
  'builtin:fx-sepia': { id: 'builtin:fx-sepia', name: '棕褐色', desc: '经典 Sepia 复古染色。' },
  'builtin:fx-invert': { id: 'builtin:fx-invert', name: '反色', desc: 'RGB 反相，负片/故障风格。' },
  'builtin:fx-halftone': { id: 'builtin:fx-halftone', name: '半色调网点', desc: '印刷网点/漫画圆点风格。' },
  'builtin:fx-motion-blur': { id: 'builtin:fx-motion-blur', name: '运动模糊', desc: '定向拖影，表现速度感。' },
};

export const FX_ORDER = [
  'builtin:fx-rect-mask', 'builtin:fx-circle-mask', 'builtin:fx-local-mosaic',
  'builtin:fx-magnify', 'builtin:fx-tilt-shift', 'builtin:fx-crt',
  'builtin:fx-ascii-rain', 'builtin:fx-shake', 'builtin:fx-luma-key',
  'builtin:fx-chroma-key', 'builtin:fx-color-wheels', 'builtin:fx-levels',
  'builtin:fx-highlights-shadows', 'builtin:fx-clarity', 'builtin:fx-hsl-qualify',
  'builtin:fx-vignette', 'builtin:fx-film-grain', 'builtin:fx-rgb-split',
  'builtin:fx-glitch', 'builtin:fx-bloom', 'builtin:fx-pixelate',
  'builtin:fx-posterize', 'builtin:fx-duotone', 'builtin:fx-mirror',
  'builtin:fx-fisheye', 'builtin:fx-kaleidoscope', 'builtin:fx-edge-glow',
  'builtin:fx-soft-blur', 'builtin:fx-light-leak', 'builtin:fx-sepia',
  'builtin:fx-invert', 'builtin:fx-halftone', 'builtin:fx-motion-blur',
] as const;

export const LUT_METADATA: Record<string, FxCatalogMetadata> = {
  'builtin:slog3-s709': { id: 'builtin:slog3-s709', name: 'Sony S-Log3 → s709', desc: 'Sony S-Log3 / S-Gamut3.Cine → Rec.709。.cube 三维查找表（Sony_Slog3_s709.cube, 33³）+ 通用 lut.frag（sampler3D，BT.709 编解码包夹）' },
  'builtin:canon-log3-709': { id: 'builtin:canon-log3-709', name: 'Canon Log 3 → BT.709', desc: 'Canon Cinema Gamut / Canon Log 3 → Canon 709。.cube 三维查找表（CinemaGamut_CanonLog3-to-Canon709_33_Ver.1.0.cube, 33³）+ 通用 lut.frag' },
  'builtin:look-teal-orange': { id: 'builtin:look-teal-orange', name: '青橙电影感', desc: '阴影偏青、高光偏橙的好莱坞调色。' },
  'builtin:look-mono': { id: 'builtin:look-mono', name: '黑白胶片', desc: '高对比黑白 + 轻微动态颗粒。' },
  'builtin:look-warm': { id: 'builtin:look-warm', name: '暖调复古', desc: '偏暖色温与轻度褪色，复古质感。' },
  'builtin:look-cool': { id: 'builtin:look-cool', name: '冷调青蓝', desc: '偏冷色温，阴影加压蓝。' },
  'builtin:look-sunset': { id: 'builtin:look-sunset', name: '日落暖金', desc: '高光偏金、阴影压暖的黄昏感。' },
  'builtin:look-cyber': { id: 'builtin:look-cyber', name: '赛博霓虹', desc: '阴影青蓝、高光品红的霓虹科幻调。' },
  'builtin:look-bleach': { id: 'builtin:look-bleach', name: '漂白旁路', desc: '低饱和 + 抬黑的漂白旁路电影感。' },
  'builtin:look-fuji-chrome': { id: 'builtin:look-fuji-chrome', name: '富士 Classic Chrome', desc: '低饱和、柔和对比、中灰偏冷——旅行/街拍纪录片感（灵感自富士胶片模拟，非官方 LUT）。' },
  'builtin:look-fuji-portra': { id: 'builtin:look-fuji-portra', name: '富士人像 Pro Neg', desc: '奶油肤色、粉柔高光、抬黑阴影——人像/生活感（灵感自 Portra / Pro Neg）。' },
  'builtin:look-fuji-velvia': { id: 'builtin:look-fuji-velvia', name: '富士 Velvia 风光', desc: '高饱和绿/蓝、通透对比——景区/自然风光（灵感自 Velvia 反转片）。' },
  'builtin:look-ricoh-gr': { id: 'builtin:look-ricoh-gr', name: '理光 GR 街拍', desc: '硬一点对比、冷中性灰、城市纪实——GR 随手拍感（灵感自理光街拍审美）。' },
  'builtin:look-kodak-gold': { id: 'builtin:look-kodak-gold', name: '柯达金 Gold', desc: '暖黄绿怀旧、软对比——千禧年随手拍 / 家庭相册感（灵感自 Kodak Gold）。' },
  'builtin:look-disposable': { id: 'builtin:look-disposable', name: '拍立得 / 一次性', desc: '软糊、绿偏、粗颗粒、暗角——拍立得与一次性相机那味。' },
  'builtin:look-cinestill': { id: 'builtin:look-cinestill', name: 'CineStill 夜景', desc: '钨丝灯冷青、高光微溢——夜街/霓虹（灵感自 CineStill 800T）。' },
};

export const LUT_ORDER = [
  'builtin:slog3-s709', 'builtin:canon-log3-709', 'builtin:look-fuji-chrome',
  'builtin:look-fuji-portra', 'builtin:look-fuji-velvia', 'builtin:look-ricoh-gr',
  'builtin:look-kodak-gold', 'builtin:look-disposable', 'builtin:look-cinestill',
  'builtin:look-teal-orange', 'builtin:look-mono', 'builtin:look-warm',
  'builtin:look-cool', 'builtin:look-sunset', 'builtin:look-cyber', 'builtin:look-bleach',
] as const;
