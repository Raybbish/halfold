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

/* bump() stands for render(). sidenote.html rebuilt all of #app with innerHTML on every render(), and parts of its
   behaviour depend on getting new elements each time: the next flashcard appears unflipped without a flip animation,
   a jump moves the timeline head without sliding, keyboard focus inside #app is dropped (the flashcard and quiz keys
   rely on that), and a form shows what the module objects hold (auth, nf, state). So a bump() gives the page new
   elements too: App.tsx keys the page by `generation`.
   refresh() is for the places that patched only one part of the page without render() (the lecture search, the
   transcript search, the live transcript): React updates the page in place, so the search box keeps focus. */
let generation = 0;
export function bump() { generation++; page.bump(); }
export function refresh() { page.bump(); }
export const getGeneration = () => generation;
/* Redraw every channel at once, e.g. after the interface language changes. A full redraw of the page. */
export function bumpAll() { generation++; all.forEach(c => c.next()); flusher(() => all.forEach(c => c.listeners.forEach(l => l()))); }
