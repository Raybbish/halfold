// Screenshots that differ from sidenote.html on purpose: live values on the recording screen, and fixes made after
// the migration was accepted.
// compare-shots.js marks a differing pair as expected when its id ("<set>/<file>.png" or "<file>.png") matches one of
// these. Expected differences are still listed in the output, with the reason, but do not fail npm test.
//
// maxPixels: the pair only counts as expected while fewer pixels than this differ, so a real change on that screen
// (a moved or missing element touches thousands of pixels) still fails.
module.exports = [
  {
    match: /(^|\/)(m|d)-(en|zh)-(15-live|16-home-while-recording|17-settings)\.png$/,
    maxPixels: 300,
    reason: 'taken while a recording runs: the clock (and on the recording screen the microphone level bar) show live values, so each run captures a different second or level'
  },
  {
    match: /(^|\/)(m|d)-zh-01-landing\.png$|^(375|1280)-zh\/landing\.png$/,
    reason: 'Chinese landing page: the example notes (sticky notes, feature grid) are translated now; sidenote.html left them in English'
  }
];
