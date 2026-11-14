# Live recording fixtures

Real pieces of a browser recording, made by Chrome's `MediaRecorder` with a 3-second timeslice (the front end uses 15),
the way `src/features/recording/recorder.ts` records: `audioBitsPerSecond` 32 000, one `dataavailable` blob per piece.
The sound is 10.9 seconds of macOS text-to-speech (English, then Cantonese, then English).

- `live-webm/`: `audio/webm;codecs=opus`, what Chrome sends. Only the first piece has the header; each later piece
  starts in the middle of a cluster.
- `live-mp4/`: `audio/mp4;codecs=mp4a.40.2` (AAC in fragmented MP4), the closest Chrome gets to Safari. The first piece
  is the header alone, with no sound.

Neither piece after the first can be read on its own; joined in order they are 10.9 seconds.
