/* ---------- privacy (public) ----------
   Written from what the server really does (server/): sign-in by emailed code, the services it sends data to, how long
   recordings are kept, what a shared link shows and how things are deleted. The contact email comes from the backend
   (CONFIG.CONTACT_EMAIL, its CONTACT_EMAIL); without one it shows as a marked placeholder (design, "before going live"). */
import { CONFIG } from "../config";
import { t } from "../i18n";
import { DocPage, Todo } from "./Doc";

const L = (xs: string[]) => xs.map(x => t(x));

export const Privacy = () => <DocPage title="Privacy" lead="What Halfold does with your recordings and notes." sections={[
  ["What is stored", L(["Your email address and the name you give.", "Your university, what you study, your year and when you graduate, where you studied before university if you say, and your answers to the two optional boxes about messages and paid surveys, with when you gave or withdrew each.", "Your lecture recordings, transcripts, notes, flashcards and quizzes, and the slides (PDF) you add.", "Your own edits and your progress, such as the flashcards you know."])],
  /* By kind of service and where it is, not by name (2026-11-20): what matters to a student is what leaves Halfold and
     for where, and a service can change without this page changing. Keep the places true when a service changes:
     speech to text (ElevenLabs or Deepgram) in the United States, the AI model (DeepSeek) in mainland China, and
     recordings once their notes are written in Cloudflare R2 (server R2_* settings), in a bucket made with the location
     hint Asia-Pacific (deploy/server/README.md). Without R2 they stay on the server: then say so instead. */
  ["Who handles it", L(["Your recording is sent to a speech-to-text service, which turns it into a transcript. The service is in the United States.",
    "Notes, flashcards, quizzes, catch-up summaries and review packs are written by an AI model service, from the transcript and the slides. The service is in mainland China.",
    "Once the notes are written, your recording and slides are kept at a cloud storage service, set to store them in the Asia-Pacific region.",
    "Payments go through a payment service. Halfold never sees your card number.",
    "The sign-in email with your code is sent through an email delivery service, which gets your email address."])],
  ["Where the server is", "The Halfold server is at a cloud provider in Singapore. Your account, transcripts and notes are stored there, and your recording until its notes are written."],
  ["Video links", "When you paste a public video link, the Halfold server downloads that video to make the notes."],
  ["How long it is kept", L(["A recording is kept for the number of days your plan allows. Settings shows the number, and some plans keep recordings for good.", "Notes stay until you delete them."])],
  ["Sharing", "A share link shows the notes, transcript, flashcards and quiz, not the recording. You can turn the link off at any time with Stop sharing."],
  ["Deleting your data", L(["Deleting a lecture deletes its recording and files.", "Deleting your whole account is not something you can do yourself yet. To have it done, write to the contact email below."])],
  ["Contact", [CONFIG.CONTACT_EMAIL ? <a key="c" href={"mailto:" + CONFIG.CONTACT_EMAIL} data-notr="">{CONFIG.CONTACT_EMAIL}</a> : <Todo key="c" s="[Contact email: to be decided]" />]],
  ["Recording other people", "A lecture recording contains other people's voices. Check your course's rules, ask the lecturer if you are not sure, and keep recordings to yourself unless you have permission to share them."]
]} />;
