/* =====================================================================
   CONFIG
   Defaults are below. Anything set on window.SIDENOTE_CONFIG before the app
   starts (in index.html, or by a test with page.addInitScript) overrides
   them, so USE_MOCK, API_BASE and the rest change without a rebuild.
   For the backend developer: set USE_MOCK = false and API_BASE to your server.
   See reference/INTEGRATION.md for the endpoint list and data shapes.
   ===================================================================== */
export interface Config {
  USE_MOCK: boolean;
  API_BASE: string;
  CHUNK_SECONDS: number;
  AUDIO_KBPS: number;
  POLL_MS: number;
  MAX_UPLOAD_MB: number;
  EXAMPLE_SHARE_ID: string | null;
  SHARE_AUDIO: boolean;
}

declare global {
  interface Window { SIDENOTE_CONFIG?: Partial<Config> }
}

const DEFAULTS: Config = {
  USE_MOCK: true,          // false = talk to the real backend
  API_BASE: "/api",        // prefix for every request
  CHUNK_SECONDS: 15,       // how often recorded audio is sent while recording
  AUDIO_KBPS: 32,          // recording bitrate. 32 kbps is plenty for speech: a 90 minute lecture is about 22 MB
  POLL_MS: 3000,           // how often to ask whether notes are ready
  MAX_UPLOAD_MB: 500,
  EXAMPLE_SHARE_ID: "econ-w9", // the shared lecture behind "Example notes" on the public pages. null hides those links
  SHARE_AUDIO: false       // true = classmates with a share link can also play the recording
};

export const CONFIG: Config = { ...DEFAULTS, ...(window.SIDENOTE_CONFIG || {}) };
