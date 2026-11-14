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

/* The instant a local day starts (00:00 in the time zone). */
export function startOfDay(ymd: string, timeZone: string) {
  const guess = Date.parse(ymd + "T00:00:00Z");
  const offset = (at: number) => {   // minutes the zone is ahead of UTC at an instant
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(at)).map(x => [x.type, x.value]));
    return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - at) / 60000;
  };
  let at = guess - offset(guess) * 60000;
  at = guess - offset(at) * 60000;   // again, in case the offset changed in between (summer time)
  return new Date(at);
}

/* The month a limit counts in: when it began and the day the next one starts ("YYYY-MM-DD"), in the time zone. */
export function monthOf(at: Date, timeZone: string) {
  const [y, m] = localDate(at, timeZone).split("-").map(Number);
  const first = `${y}-${String(m).padStart(2, "0")}-01`, next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { start: startOfDay(first, timeZone), next };
}

/* "1 Dec" for a "YYYY-MM-DD"; with the year ("14 Dec 2026") when asked. */
export function shortDate(ymd: string, withYear = false) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) }).format(new Date(ymd + "T00:00:00Z"));
}
