/* Picks the page for the current route: render() from sidenote.html. It runs again on every bump(). */
import { Fragment, useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CONFIG } from "./config";
import { getGeneration } from "./lib/bus";
import { R, S, view } from "./state/app";
import { PUBLIC, route } from "./state/router";
import { t } from "./i18n";
import { useStore } from "./ui/useStore";
import { Shell, Skeleton, Problem } from "./ui/Shell";
import { Logo, Hal } from "./ui/icons";
import { Overlay } from "./ui/Overlay";
import { css } from "./ui/css";
import { Landing } from "./pages/Landing";
import { SignIn } from "./pages/SignIn";
import { Home, Courses } from "./pages/Home";
import { Course } from "./pages/Course";
import { Settings } from "./pages/Settings";
import { ReviewPack } from "./pages/ReviewPack";
import { Review } from "./pages/Review";
import { LecturePage } from "./pages/Lecture";
import { Shared } from "./pages/Shared";
import { NewLecture } from "./pages/NewLecture";
import { Live } from "./pages/Live";
import { Help } from "./pages/Help";
import { Privacy } from "./pages/Privacy";

function page(a: string, b: string): ReactNode {
  return a === "home" ? <Home /> : a === "course" ? <Course id={b} /> : a === "courses" ? <Courses />
    : a === "lecture" ? <LecturePage id={b} /> : a === "s" ? <Shared id={b} /> : a === "new" ? <NewLecture />
    : a === "live" ? <Live /> : a === "pack" ? <ReviewPack id={b} /> : a === "review" ? <Review /> : a === "settings" ? <Settings />
    : a === "help" ? <Help /> : a === "privacy" ? <Privacy /> : a === "signin" ? <SignIn /> : a === "" ? <Landing /> : <Shell active=""><Problem title="Page not found" text="That address does not match anything in Halfold." /></Shell>;
}

/* afterRender() from sidenote.html: keep the chosen tab in view when the tab row scrolls sideways. */
function afterRender() {
  const tabs = document.querySelector(".tabs"), on = tabs && tabs.querySelector<HTMLElement>(".on");
  if (tabs && on) tabs.scrollLeft += on.getBoundingClientRect().left - tabs.getBoundingClientRect().left - (tabs.clientWidth - on.offsetWidth) / 2;
}

export function App() {
  useStore();
  useLayoutEffect(afterRender);
  const { a, b } = R;
  let body: ReactNode = null;
  if (view.loader === "shell") body = <Shell active=""><Skeleton /></Shell>;
  else if (view.loader === "center") body = <div className="center"><Hal size={56} mood="wow" /></div>;
  else if (view.loader === null) {
    if (S.error) {
      const card = <Problem title="That did not load" text={S.error} btn={<button className="btn primary" onClick={() => route()}>{t("Try again")}</button>} />;
      body = S.token && S.homeLoaded && !PUBLIC.includes(a) ? <Shell active="">{card}</Shell> : <div className="pub" style={css("min-height:100vh;background:var(--bg)")}><nav className="pub-nav"><Logo href="#/" /></nav><div className="wrap" style={css("max-width:720px")}>{card}</div></div>;
    } else body = page(a, b);
  }
  const pill = view.loader === null && CONFIG.USE_MOCK && a !== "";
  return <>
    {/* Every bump() draws the page with new elements, as render() did with innerHTML; refresh() updates it in place. */}
    <Fragment key={getGeneration()}>{body}</Fragment>
    {pill ? <div className="mock-pill">{t("Sample data")}</div> : null}
    {createPortal(t("You are offline. Recording still works and is sent when you are back online."), document.querySelector(".offline-bar")!)}
    <Overlay />
  </>;
}
