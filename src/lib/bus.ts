/* Redraw notifications. sidenote.html changed a module object and then called render();
   here the same code changes the object and calls bump(). The React side subscribes (ui/useStore.ts).

   bump() redraws before it returns, like render() did, so code that reads the page right after it
   (scrollIntoView in jump(), the #tabtop check in setTab()) still sees the new page. The UI layer
   supplies the synchronous flush (React's flushSync) through setFlusher(); this file does not import React.

   There are two channels: the page (#app) and the overlay (#overlay). Opening or closing a dialog
   redraws only the overlay, as modal() and closeModal() only touched #overlay before. */
type Listener = () => void;
export interface Channel { bump(): void; subscribe(fn: Listener): () => void; version(): number }

let flusher: (fn: () => void) => void = fn => fn();
export function setFlusher(f: (fn: () => void) => void) { flusher = f; }

const all: { listeners: Set<Listener>; next(): void }[] = [];
export function createChannel(): Channel {
  const listeners = new Set<Listener>(); let v = 0;
  all.push({ listeners, next() { v++; } });
  return {
    bump() { v++; flusher(() => listeners.forEach(l => l())); },
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    version() { return v; }
  };
}

const page = createChannel();
export const subscribe = page.subscribe, getVersion = page.version;

/* bump() stands for render(): sidenote.html rebuilt all of #app, so whatever had keyboard focus inside it was
   destroyed and focus went back to <body>. The flashcard and quiz keys depend on that (Space flips the card after
   clicking Next), so after a bump() the app drops focus inside #app the same way (see App.tsx).
   refresh() is for the places that patched one part of the page without render() (the search results, the live
   transcript, the course picker): it redraws and leaves focus where it is. */
let full = false;
export function bump() { full = true; page.bump(); }
export function refresh() { page.bump(); }
export function takeFullRedraw() { const f = full; full = false; return f; }
/* Redraw every channel at once, e.g. after the interface language changes. Counts as a full redraw. */
export function bumpAll() { full = true; all.forEach(c => c.next()); flusher(() => all.forEach(c => c.listeners.forEach(l => l()))); }
