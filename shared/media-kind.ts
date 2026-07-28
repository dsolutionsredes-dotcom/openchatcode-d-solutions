export type MediaKind = 'video' | 'image' | 'audio' | 'gif' | 'svg';

const VIDEO_EXTENSIONS = ['.mp4', '.m4v', '.mov', '.webm'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.heic', '.heif'];
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.opus', '.flac'];

/** Pure filename/MIME detection shared by browser imports and server-side ingestion. */
export function kindOfDescriptor(rawName: string, rawType = ''): MediaKind | null {
  const name = rawName.toLowerCase();
  const type = rawType.toLowerCase();
  if (type === 'image/gif' || name.endsWith('.gif')) return 'gif';
  if (type === 'image/svg+xml' || name.endsWith('.svg')) return 'svg';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('audio/')) return 'audio';
  if (VIDEO_EXTENSIONS.some((extension) => name.endsWith(extension))) return 'video';
  if (IMAGE_EXTENSIONS.some((extension) => name.endsWith(extension))) return 'image';
  if (AUDIO_EXTENSIONS.some((extension) => name.endsWith(extension))) return 'audio';
  return null;
}
