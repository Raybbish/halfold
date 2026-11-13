/* Dates in the students' time zone (APP_TIMEZONE). The front end counts down to exam dates from `today`. */

/* "YYYY-MM-DD" of an instant in a time zone. */
export function localDate(at: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/* lecture.date is shown as it is: "Today" (translated by the front end) or e.g. "Tue 10 Nov". */
export function displayDate(createdIso: string, timeZone: string, now = new Date()) {
  const at = new Date(createdIso);
  if (localDate(at, timeZone) === localDate(now, timeZone)) return "Today";
  return new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short" }).format(at).replace(",", "");
}

/* The weekday and date of an instant, for the notes prompt ("Thursday 2026-11-12"), so the model can turn "next Tuesday" into a date. */
export function promptDate(at: Date, timeZone: string) {
  const day = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long" }).format(at);
  return `${day} ${localDate(at, timeZone)}`;
}
