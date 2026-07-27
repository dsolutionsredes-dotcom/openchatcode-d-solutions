import type { TranscriptWord } from '../transcript/types';
import type { CaptionStyleOverride } from './styles';
import { segmentWords } from './segmenter';


/** 3×3 title-safe anchors + shorthands (edit_captions action=layout preset). */
export type CaptionAnchor =
  | 'top' | 'center' | 'bottom'
  | 'top-left' | 'top-center' | 'top-right'
  | 'middle-left' | 'middle-center' | 'middle-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right';


/** Whole-caption-block placement (edit_captions action=layout). Anchor picks
 * the title-safe grid cell; offset*Ratio nudges it as a fraction of canvas w/h. */
export interface CaptionLayout {
  anchor?: CaptionAnchor;
  offsetXRatio?: number;
  offsetYRatio?: number;
}


// Captions (字幕) = a styled singleton overlay burned onto the video, separate
// from the 文字稿 editing surface. Words are paginated into "pages" and shown in
// sync with playback (timings are TIMELINE ms once resolved).
//
// Captions mirror an audio item's transcript. When that item is
// edited (words deleted / silence compressed) the caption words are re-projected
// onto the edited timeline (see retimeWords) — captions follow edits. If no item
// is referenced, `words` + `offsetFrames` provide a standalone (sample) source.
export type CaptionTemplate = 'plain' | 'black-bar' | 'persona' | 'off-the-wall' | 'the-french-dispatch' | 'dogme' | 'boyz-n-the-hood' | 'bubble-pop' | 'submagic' | 'story' | 'bili' | 'luxe' | 'noir' | 'atelier' | 'product' | 'signal' | 'studio' | 'white-card' | 'bold-outline' | 'deyi-card' | 'tiktok' | 'netflix';
export type CaptionPacing = 'word' | 'phrase';


/** One translated caption phrase, timed on the (edited) timeline in ms. */
export interface TranslatedCue {
  start: number;
  end: number;
  text: string;
}


export interface CaptionsData {
  enabled: boolean;
  template: CaptionTemplate;
  pacing: CaptionPacing;
  hideOnSilenceMs?: number;
  lingerMs?: number;
  /** audio item whose (edited) transcript drives the captions */
  sourceItemId?: string | null;
  /** MULTI-source merge — 字幕可汇总全部已转写轨: item ids whose (edited) transcripts
   * merge into ONE time-ordered caption stream (see resolveCaptionWords in resolve.ts).
   * Empty/undefined → no effect, `sourceItemId` still drives (backward compatible). */
  sources?: string[];
  /** 'timeline' = ignore `sources`/`sourceItemId`, merge EVERY item with a transcript;
   * 'item' or undefined (default) = single-source `sourceItemId`, or `sources` if set. */
  sourceMode?: 'item' | 'timeline';
  /** standalone fallback source words (source ms) when no item is referenced */
  words?: TranscriptWord[];
  /** timeline offset (frames) for the standalone words */
  offsetFrames?: number;
  /** bilingual: show a translated second line under the original */
  bilingual?: boolean;
  /** translation language label (e.g. "中文") — display/regeneration hint */
  translationLang?: string;
  /** translated phrase cues (timeline ms), aligned to the source phrases */
  translation?: TranslatedCue[];
  /** display a transcript VARIANT (translation / corrected pass) as the caption
   * text instead of the source words. Keys `sourceItemId`'s `variants` by id; the
