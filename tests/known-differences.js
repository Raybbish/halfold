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
  },
  {
    match: /(^|\/)(m|d)-(en|zh)-12-course\.png$|^(375|1280)-(en|zh)\/course\.png$/,
    maxPixels: 25000,
    reason: 'course page: an Edit course button next to New lecture (editing and deleting courses, added after the migration)'
  },
  {
    match: /(^|\/)(m|d)-(en|zh)-09-more\.png$|^(375|1280)-(en|zh)\/more\.png$/,
    maxPixels: 100000,
    reason: 'lecture More menu: a Move to another course button (added after the migration)'
  },
  {
    match: /(^|\/)(m|d)-(en|zh)-14(-new|b-before-you-record)\.png$|^(375|1280)-(en|zh)\/new(-upload|-upload-file|-link-error|-tab|-rec-tip)?\.png$/,
    maxPixels: 1500,
    reason: 'New lecture page (and the Before you record dialog over it): Add a course is a button beside the Course label now, not the last item of the course list (DIFFERENCES.md part 1, item 8)'
  },
  {
    match: /(^|\/)(m|d)-(en|zh)-18-after-end\.png$/,
    maxPixels: 100000,
    reason: 'notes of a lecture recorded without slides: sample mode now makes them without slides (no slide labels, no sidenote marks), as a real backend does; sidenote.html gave every new lecture the full sample notes'
  }
];
