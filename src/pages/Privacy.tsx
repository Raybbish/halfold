/* ---------- privacy (public) ----------
   Written from what the server really does (server/): sign-in by emailed code, the services it sends data to, how long
   recordings are kept, what a shared link shows and how things are deleted. The contact email and where the server is
   are not decided yet: they show as marked placeholders (design, "before going live"). */
import { t } from "../i18n";
import { DocPage, Todo } from "./Doc";

const L = (xs: string[]) => xs.map(x => t(x));

export const Privacy = () => <DocPage title="Privacy" lead="What Halfnote does with your recordings and notes." sections={[
  ["What is stored", L(["Your email address and the name you give.", "Your lecture recordings, transcripts, notes, flashcards and quizzes, and the slides (PDF) you add.", "Your own edits and your progress, such as the flashcards you know."])],
  ["Who handles it", L(["Speech to text is done by ElevenLabs or Deepgram, whichever the server is set to use. Your recording is sent there to be turned into a transcript.", "Notes, flashcards, quizzes, catch-up summaries and review packs are written by DeepSeek, from the transcript and the slides.", "Payments go through Stripe.", "The sign-in email with your code is sent through Resend."])],
  ["Where the server is", [<Todo key="w" s="[Where the server is: to be decided]" />]],
  ["Video links", "When you paste a public video link, the Halfnote server downloads that video to make the notes."],
  ["How long it is kept", L(["A recording is kept for the number of days your plan allows. Settings shows the number, and some plans keep recordings for good.", "Notes stay until you delete them."])],
  ["Sharing", "A share link shows the notes, transcript, flashcards and quiz, not the recording. You can turn the link off at any time with Stop sharing."],
  ["Deleting your data", L(["Deleting a lecture deletes its recording and files.", "Deleting your whole account is not something you can do yourself yet. To have it done, write to the contact email below."])],
  ["Contact", [<Todo key="c" s="[Contact email: to be decided]" />]],
  ["Recording other people", "A lecture recording contains other people's voices. Check your course's rules, ask the lecturer if you are not sure, and keep recordings to yourself unless you have permission to share them."]
]} />;
