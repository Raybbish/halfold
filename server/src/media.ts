/* ffprobe and ffmpeg. Uploaded files can be any audio or video format; the pipeline turns each into one seekable,
   speech-sized audio file (mono AAC in M4A, faststart), used for transcription now and for playback in a later phase
   (INTEGRATION.md 4.2: seekable, M4A or MP3, plays on iPhone). */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface MediaInfo { duration: number; hasAudio: boolean }
export interface SpeechOptions {
  signal?: AbortSignal;
  /* Live recordings: a chunk that never arrived becomes silence, so everything after it keeps its time. */
  fillGaps?: boolean;
}
export interface CutOptions {
  from: number;               // seconds from the start of the recording
  to?: number;                // default: to the end of what is there
  signal?: AbortSignal;
}
export interface Media {
  /* null when the file is not something ffprobe can read. */
  probe(file: string): Promise<MediaInfo | null>;
  /* Writes `output` (M4A) from `input`, dropping any video. */
  toSpeechAudio(input: string, output: string, o?: SpeechOptions): Promise<void>;
  /* Writes the part [from, to] of a recording made of `parts` (files in `dir`, joined in order, as the browser's
     recorder sent them) as a speech file (M4A), and returns its length in seconds. The pieces of a browser recording
     cannot be read one by one: only the first carries the header. Seeking to `from` reads the earlier pieces without
     decoding them, so a cut at the end of a 90-minute recording takes a fraction of a second. */
  cutSpeech(dir: string, parts: string[], output: string, o: CutOptions): Promise<number>;
}

const SPEECH = ["-vn", "-map", "0:a:0", "-ac", "1", "-ar", "24000", "-c:a", "aac", "-b:a", "48k", "-movflags", "+faststart", "-f", "mp4"];

export class Ffmpeg implements Media {
  constructor(private readonly ffmpeg = "ffmpeg", private readonly ffprobe = "ffprobe") {}
  async probe(file: string): Promise<MediaInfo | null> {
    try {
      const { stdout } = await run(this.ffprobe, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { maxBuffer: 8 << 20 });
      const j = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_type?: string; duration?: string }[] };
      const audio = (j.streams || []).filter(s => s.codec_type === "audio");
      const duration = Number(j.format?.duration ?? audio[0]?.duration);
      return { duration: Number.isFinite(duration) ? duration : 0, hasAudio: audio.length > 0 };
    } catch { return null; }
  }
  async toSpeechAudio(input: string, output: string, o: SpeechOptions = {}) {
    await run(this.ffmpeg, ["-y", "-v", "error", "-i", input, ...(o.fillGaps ? ["-af", "aresample=async=1:first_pts=0"] : []), ...SPEECH, output],
      { signal: o.signal, maxBuffer: 8 << 20 });
  }
  async cutSpeech(dir: string, parts: string[], output: string, o: CutOptions) {
    /* The concat protocol reads the pieces as one file and can seek in it. Names are relative to `dir`, so the
       argument stays short however long the class (Linux limits one argument to 128 KB). */
    if (!parts.length || parts.some(p => !/^[A-Za-z0-9_.-]+$/.test(p))) throw new Error("bad part names");
    const span = o.to != null ? ["-t", String(Math.max(0, o.to - o.from))] : [];
    await run(this.ffmpeg, ["-y", "-v", "error", "-ss", String(o.from), "-i", "concat:" + parts.join("|"), ...span, ...SPEECH, output],
      { cwd: dir, signal: o.signal, maxBuffer: 8 << 20 });
    const info = await this.probe(output);
    return info?.duration ?? 0;
  }
}
