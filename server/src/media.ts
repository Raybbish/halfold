/* ffprobe and ffmpeg. Uploaded files can be any audio or video format; the pipeline turns each into one seekable,
   speech-sized audio file (mono AAC in M4A, faststart), used for transcription now and for playback in a later phase
   (INTEGRATION.md 4.2: seekable, M4A or MP3, plays on iPhone). */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface MediaInfo { duration: number; hasAudio: boolean }
export interface Media {
  /* null when the file is not something ffprobe can read. */
  probe(file: string): Promise<MediaInfo | null>;
  /* Writes `output` (M4A) from `input`, dropping any video. */
  toSpeechAudio(input: string, output: string, signal?: AbortSignal): Promise<void>;
}

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
  async toSpeechAudio(input: string, output: string, signal?: AbortSignal) {
    await run(this.ffmpeg, ["-y", "-v", "error", "-i", input, "-vn", "-map", "0:a:0", "-ac", "1", "-ar", "24000", "-c:a", "aac", "-b:a", "48k",
      "-movflags", "+faststart", "-f", "mp4", output], { signal, maxBuffer: 8 << 20 });
  }
}
