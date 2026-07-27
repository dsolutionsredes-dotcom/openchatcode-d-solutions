import { sampleKeyframes } from '../editor/keyframes';
import { zoomAt } from '../editor/zoom';
import type { AspectFit, KeyframeProp, TimelineItem } from '../editor/types';

type MediaEl = HTMLVideoElement | HTMLImageElement;

function keyframe(item: TimelineItem, prop: KeyframeProp, frame: number): number | undefined {
  const values = item.keyframes?.[prop];
  return values?.length ? sampleKeyframes(values, frame) : undefined;
}

/** Rasterize the ClipWrapper-supported visual state of an image/video into a canvas. */
export function composeTimelineItemFrame(
  ctx: CanvasRenderingContext2D,
  el: MediaEl,
  item: TimelineItem,
  fit: AspectFit,
  absoluteFrame: number,
): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const localFrame = Math.max(0, Math.min(item.durationInFrames - 1, absoluteFrame - item.startFrame));
  const nw = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
  const nh = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!nw || !nh) return;

  const t = item.transform;
  const x = keyframe(item, 'x', localFrame) ?? t?.x ?? 0;
  const y = keyframe(item, 'y', localFrame) ?? t?.y ?? 0;
  const rotation = keyframe(item, 'rotation', localFrame) ?? t?.rotation ?? 0;
  const scale = keyframe(item, 'scale', localFrame) ?? t?.scale ?? 1;
  const crop = t?.crop;

  // ClipWrapper clips the full layer before applying its outer transform.
  ctx.save();
  ctx.translate(W / 2 + (x / 100) * W, H / 2 + (y / 100) * H);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.scale(scale, scale);
  ctx.translate(-W / 2, -H / 2);
  if (crop) {
    const left = (crop.left ?? 0) * W;
    const top = (crop.top ?? 0) * H;
    const right = (crop.right ?? 0) * W;
    const bottom = (crop.bottom ?? 0) * H;
    ctx.beginPath();
    ctx.rect(left, top, Math.max(0, W - left - right), Math.max(0, H - top - bottom));
    ctx.clip();
  }

  // Zoom is an inner ClipWrapper layer, therefore its focal transform happens
  // after clipping and before the fitted media is drawn.
  if (item.zoom) {
    const z = zoomAt(item.zoom, localFrame, item.durationInFrames);
    ctx.translate(z.focalX * W, z.focalY * H);
    ctx.scale(z.magnification, z.magnification);
    ctx.translate(-z.focalX * W, -z.focalY * H);
  }
  const fittedScale = fit === 'cover' ? Math.max(W / nw, H / nh) : Math.min(W / nw, H / nh);
  const dw = nw * fittedScale;
  const dh = nh * fittedScale;
  ctx.drawImage(el, (W - dw) / 2, (H - dh) / 2, dw, dh);
  ctx.restore();
}
