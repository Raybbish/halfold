/* ---------- online class: record the sound of a browser tab ---------- */
import { toast } from "../../state/overlay";
import { live, rec } from "./recorder";
import { endLive } from "./finish";

export const CAN_TAB = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);   // phones cannot share a tab
export async function tabStream() {
  if (!navigator.mediaDevices.getDisplayMedia) throw Object.assign(new Error(), { name: "NotSupportedError" });
  const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }), a = s.getAudioTracks();
  if (!a.length) { s.getTracks().forEach(t => t.stop()); throw Object.assign(new Error(), { name: "NoAudioError" }); }
  rec.full = s; a[0].onended = () => { if (live.active) { toast("Sharing stopped, so the recording has ended."); endLive(); } };
  return new MediaStream(a);
}
