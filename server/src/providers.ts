/* Builds the speech-to-text service and the notes model named in the settings. */
import type { Config, SttProviderName } from "./config";
import type { Transcriber } from "./stt/types";
import { ElevenLabsScribe } from "./stt/elevenlabs";
import { DeepgramNova } from "./stt/deepgram";
import { SonioxAsync } from "./stt/soniox";
import { AssemblyAi, ASSEMBLYAI_PRICES } from "./stt/assemblyai";
import type { NotesWriter } from "./notes/types";
import { DeepSeekWriter } from "./notes/deepseek";

export function createTranscriber(config: Config, name: SttProviderName = config.stt.provider, model?: string): Transcriber {
  if (name === "deepgram") { const d = config.stt.deepgram; return new DeepgramNova(d.apiKey, model || d.model, d.languages, d.usdPerHourMono, d.usdPerHourMulti); }
  if (name === "soniox") { const s = config.stt.soniox; return new SonioxAsync(s.apiKey, model || s.model, s.usdPerHour); }
  /* Another model than the configured one (compare-stt "assemblyai:assemblyai-stt-3-7") is priced at its own list price. */
  if (name === "assemblyai") { const a = config.stt.assemblyai; return new AssemblyAi(a.apiKey, model || a.model, model && model !== a.model ? ASSEMBLYAI_PRICES[model] ?? a.usdPerHour : a.usdPerHour); }
  const e = config.stt.elevenlabs; return new ElevenLabsScribe(e.apiKey, model || e.model, e.usdPerHour);
}

export function createNotesWriter(config: Config): NotesWriter {
  return new DeepSeekWriter(config.notes.deepseek);
}

/* Settings that are missing, for a warning at start: the server still runs, and lectures fail with a clear reason. */
export function missingKeys(config: Config) {
  const out: string[] = [];
  if (config.stt.provider === "elevenlabs" && !config.stt.elevenlabs.apiKey) out.push("ELEVENLABS_API_KEY");
  if (config.stt.provider === "deepgram" && !config.stt.deepgram.apiKey) out.push("DEEPGRAM_API_KEY");
  if (config.stt.provider === "soniox" && !config.stt.soniox.apiKey) out.push("SONIOX_API_KEY");
  if (config.stt.provider === "assemblyai" && !config.stt.assemblyai.apiKey) out.push("ASSEMBLYAI_API_KEY");
  if (!config.notes.deepseek.apiKey) out.push("DEEPSEEK_API_KEY");
  return out;
}
