import { useSyncExternalStore } from "react";
import type { Channel } from "../lib/bus";
import { subscribe, getVersion } from "../lib/bus";

/* Redraw this component whenever bump() is called (the page channel), or whenever the given channel bumps. */
export function useStore(ch?: Channel) {
  return useSyncExternalStore(ch ? ch.subscribe : subscribe, ch ? ch.version : getVersion);
}
