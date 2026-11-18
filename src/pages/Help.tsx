/* ---------- help (public) ---------- */
import { t } from "../i18n";
import { DocPage } from "./Doc";

const L = (xs: string[]) => xs.map(x => t(x));

export const Help = () => <DocPage title="Help" lead="How to get good notes out of a lecture, and what to do when something looks wrong." sections={[
  ["Signing in", L(["Sign in with your email: Halfold sends you a 6-digit code and you type it in. There is no password to remember. Some servers use an invite code instead.", "Your name is asked once, the first time."])],
  ["Getting a good recording", L(["Sit where you can hear the lecturer clearly. The front half of the room is usually enough.", "A laptop is the easiest device: open Halfold in a tab and carry on with your own work.", "On a phone, keep the page open and the screen on. Most phones pause web recording when the screen locks.", "For an online class, choose Record an online class and share the tab that is playing it, with tab audio turned on.", "If you already have a recording, upload it instead. The result is the same.", "You can also paste a link to a video. Only public links work: a video that needs a sign-in cannot be downloaded, so record it while it plays or upload the file."])],
  ["What you get", L(["Notes grouped by topic. Every point has a timestamp that takes you to the lecturer's own words.", "When you add the slide deck, what the lecturer said that is not on the slides is tagged Not on slides.", "Exam dates, deadlines and exam hints, collected on your home page with a countdown.", "Flashcards and a quiz.", "A review pack for each course: one revision sheet and a mock exam built from all its lectures."])],
  ["While the class is running", L(["The live transcript is a rough guide. The notes are written after the class ends.", "Catch me up gives you a short summary of the last five minutes.", "You can leave the recording page and look at other lectures. A bar at the top takes you back.", "If the connection drops, recording continues and the audio is sent later.", "If the page closes by accident, open Halfold again. It offers to finish the interrupted recording."])],
  ["Finding things", L(["On Home, the search box looks through course codes, lecture titles and the notes themselves.", "On a lecture, Search the transcript finds the exact words the lecturer said."])],
  ["How long recordings are kept", L(["A recording is kept for the number of days your plan allows. Settings shows the number, and some plans keep recordings for good.", "The notes, transcript, flashcards and quiz stay until you delete the lecture, even after the recording is gone."])],
  ["Sharing with classmates", L(["Share with class makes a link that anyone can read without an account.", "The link shows the notes, transcript, flashcards and quiz, not the recording.", "Stop sharing turns the link off."])],
  ["When the notes are wrong", L(["Tap the timestamp to check what was said.", "Turn on Edit notes to correct, delete or add a note.", "Use Tell us at the bottom of the notes to report a mistake. It helps the notes get better."])],
  ["Keyboard shortcuts", L(["Flashcards: left and right arrows move between cards, space flips.", "Quiz: number keys answer, Enter continues.", "Escape closes a window."])],
  ["Recording other people", "Some courses and lecturers do not allow recording. Check the rules for your class and ask if you are not sure. Do not share a recording of someone who has not agreed to it."]
]} />;
