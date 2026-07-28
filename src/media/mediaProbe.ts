import { kindOfDescriptor, type MediaKind } from '../../shared/media-kind';

export { kindOfDescriptor } from '../../shared/media-kind';
export type { MediaKind } from '../../shared/media-kind';

export interface MediaMetadata {
  durationInFrames: number;
  width?: number;
  height?: number;
}

const IMAGE_SECONDS = 5;
const GIF_SECONDS_FALLBACK = 5;
export function kindOf(file: File): MediaKind | null {
  return kindOfDescriptor(file.name, file.type);
}

function probeStill(url: string, frames: number, release: () => void): Promise<MediaMetadata> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      release();
      resolve({ durationInFrames: frames, width: image.naturalWidth || undefined, height: image.naturalHeight || undefined });
    };
    image.onerror = () => { release(); resolve({ durationInFrames: frames }); };
    image.src = url;
  });
}

function probeGif(url: string, fps: number, release: () => void): Promise<MediaMetadata> {
  const fallbackFrames = Math.round(GIF_SECONDS_FALLBACK * fps);
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const done = (metadata: MediaMetadata) => { release(); resolve(metadata); };
    video.preload = 'metadata';
    video.onloadedmetadata = () => done({
      durationInFrames: Number.isFinite(video.duration) && video.duration > 0
        ? Math.max(1, Math.round(video.duration * fps)) : fallbackFrames,
      width: video.videoWidth || undefined,
      height: video.videoHeight || undefined,
    });
    video.onerror = () => {
      const image = new Image();
      image.onload = () => done({ durationInFrames: fallbackFrames, width: image.naturalWidth || undefined, height: image.naturalHeight || undefined });
      image.onerror = () => done({ durationInFrames: fallbackFrames });
      image.src = url;
    };
    video.src = url;
  });
}

function probeTimed(url: string, kind: 'video' | 'audio', fps: number, release: () => void): Promise<MediaMetadata> {
  return new Promise((resolve) => {
    const element = kind === 'video' ? document.createElement('video') : document.createElement('audio');
    element.preload = 'metadata';
    element.onloadedmetadata = () => {
      release();
      resolve({
        durationInFrames: Math.max(1, Math.round((element.duration || IMAGE_SECONDS) * fps)),
        width: element instanceof HTMLVideoElement ? element.videoWidth : undefined,
        height: element instanceof HTMLVideoElement ? element.videoHeight : undefined,
      });
    };
    element.onerror = () => { release(); resolve({ durationInFrames: Math.round(IMAGE_SECONDS * fps) }); };
    element.src = url;
  });
}

export function probeMediaSource(url: string, kind: MediaKind, fps: number, release: () => void = () => undefined): Promise<MediaMetadata> {
  if (kind === 'image' || kind === 'svg') return probeStill(url, Math.round(IMAGE_SECONDS * fps), release);
  if (kind === 'gif') return probeGif(url, fps, release);
  return probeTimed(url, kind, fps, release);
}

export function probeMediaFile(file: File, kind: MediaKind, fps: number): Promise<MediaMetadata> {
  const url = URL.createObjectURL(file);
  return probeMediaSource(url, kind, fps, () => URL.revokeObjectURL(url));
}
