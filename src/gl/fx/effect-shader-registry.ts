import lumaKeyFrag from './luma-key.frag?raw';
import localMosaicFrag from './local-mosaic.frag?raw';
import magnifyFrag from './magnify.frag?raw';
import rectMaskFrag from './rect-mask.frag?raw';
import circleMaskFrag from './circle-mask.frag?raw';
import crtFrag from './crt.frag?raw';
import cameraShakeFrag from './camera-shake.frag?raw';
import tiltShiftPass1Frag from './tilt-shift-pass1.frag?raw';
import asciiRainFrag from './ascii-rain.frag?raw';
import lutFrag from './lut.frag?raw';
import chromaKeyFrag from './chroma-key.frag?raw';
import colorWheelsFrag from './color-wheels.frag?raw';
import levelsFrag from './levels.frag?raw';
import highlightsShadowsFrag from './highlights-shadows.frag?raw';
import clarityFrag from './clarity.frag?raw';
import hslQualifyFrag from './hsl-qualify.frag?raw';
import vignetteFrag from './vignette.frag?raw';
import filmGrainFrag from './film-grain.frag?raw';
import rgbSplitFrag from './rgb-split.frag?raw';
import glitchFrag from './glitch.frag?raw';
import bloomFrag from './bloom.frag?raw';
import pixelateFrag from './pixelate.frag?raw';
import posterizeFrag from './posterize.frag?raw';
import duotoneFrag from './duotone.frag?raw';
import mirrorFrag from './mirror.frag?raw';
import fisheyeFrag from './fisheye.frag?raw';
import kaleidoscopeFrag from './kaleidoscope.frag?raw';
import edgeGlowFrag from './edge-glow.frag?raw';
import softBlurFrag from './soft-blur.frag?raw';
import lightLeakFrag from './light-leak.frag?raw';
import lookTealOrangeFrag from './look-teal-orange.frag?raw';
import lookMonoFrag from './look-mono.frag?raw';
import lookWarmFrag from './look-warm.frag?raw';
import lookCoolFrag from './look-cool.frag?raw';
import lookSunsetFrag from './look-sunset.frag?raw';
import lookCyberFrag from './look-cyber.frag?raw';
import lookBleachFrag from './look-bleach.frag?raw';
import lookFujiChromeFrag from './look-fuji-chrome.frag?raw';
import lookFujiPortraFrag from './look-fuji-portra.frag?raw';
import lookFujiVelviaFrag from './look-fuji-velvia.frag?raw';
import lookRicohGrFrag from './look-ricoh-gr.frag?raw';
import lookKodakGoldFrag from './look-kodak-gold.frag?raw';
import lookDisposableFrag from './look-disposable.frag?raw';
import lookCinestillFrag from './look-cinestill.frag?raw';
import sepiaFrag from './sepia.frag?raw';
import invertFrag from './invert.frag?raw';
import halftoneFrag from './halftone.frag?raw';
import motionBlurFrag from './motion-blur.frag?raw';

/** Browser/WebGL-only shader source registry. Node must import effect-metadata.ts instead. */
export const WEBGL_SHADER_REGISTRY: Record<string, string> = {
  "builtin:fx-luma-key": lumaKeyFrag,
  "builtin:fx-local-mosaic": localMosaicFrag,
  "builtin:fx-magnify": magnifyFrag,
  "builtin:fx-rect-mask": rectMaskFrag,
  "builtin:fx-circle-mask": circleMaskFrag,
  "builtin:fx-crt": crtFrag,
  "builtin:fx-ascii-rain": asciiRainFrag,
  "builtin:fx-shake": cameraShakeFrag,
  "builtin:fx-tilt-shift": tiltShiftPass1Frag,
  "builtin:fx-chroma-key": chromaKeyFrag,
  "builtin:fx-color-wheels": colorWheelsFrag,
  "builtin:fx-levels": levelsFrag,
  "builtin:fx-highlights-shadows": highlightsShadowsFrag,
  "builtin:fx-clarity": clarityFrag,
  "builtin:fx-hsl-qualify": hslQualifyFrag,
  "builtin:fx-vignette": vignetteFrag,
  "builtin:fx-film-grain": filmGrainFrag,
  "builtin:fx-rgb-split": rgbSplitFrag,
  "builtin:fx-glitch": glitchFrag,
  "builtin:fx-bloom": bloomFrag,
  "builtin:fx-pixelate": pixelateFrag,
  "builtin:fx-posterize": posterizeFrag,
  "builtin:fx-duotone": duotoneFrag,
  "builtin:fx-mirror": mirrorFrag,
  "builtin:fx-fisheye": fisheyeFrag,
  "builtin:fx-kaleidoscope": kaleidoscopeFrag,
  "builtin:fx-edge-glow": edgeGlowFrag,
  "builtin:fx-soft-blur": softBlurFrag,
  "builtin:fx-light-leak": lightLeakFrag,
  "builtin:fx-sepia": sepiaFrag,
  "builtin:fx-invert": invertFrag,
  "builtin:fx-halftone": halftoneFrag,
  "builtin:fx-motion-blur": motionBlurFrag,
  "builtin:slog3-s709": lutFrag,
  "builtin:canon-log3-709": lutFrag,
  "builtin:look-teal-orange": lookTealOrangeFrag,
  "builtin:look-mono": lookMonoFrag,
  "builtin:look-warm": lookWarmFrag,
  "builtin:look-cool": lookCoolFrag,
  "builtin:look-sunset": lookSunsetFrag,
  "builtin:look-cyber": lookCyberFrag,
  "builtin:look-bleach": lookBleachFrag,
  "builtin:look-fuji-chrome": lookFujiChromeFrag,
  "builtin:look-fuji-portra": lookFujiPortraFrag,
  "builtin:look-fuji-velvia": lookFujiVelviaFrag,
  "builtin:look-ricoh-gr": lookRicohGrFrag,
  "builtin:look-kodak-gold": lookKodakGoldFrag,
  "builtin:look-disposable": lookDisposableFrag,
  "builtin:look-cinestill": lookCinestillFrag,
};
