/* Picks the page for the current route: render() from sidenote.html. It runs again on every bump(). */
import { Fragment, useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CONFIG } from "./config";
import { takeFullRedraw } from "./lib/bus";
import { R, S, view } from "./state/app";
import { PUBLIC, route } from "./state/router";
import { t } from "./i18n";
import { useStore } from "./ui/useStore";
import { Shell, Skeleton, Problem } from "./ui/Shell";
import { Logo, Sid } from "./ui/icons";
import { Overlay } from "./ui/Overlay";
import { css } from "./ui/css";

function Placeholder({ name }: { name: string }) { return <div className="placeholder" data-page={name}>{name}</div>; }

function page(a: string, b: string): ReactNode {
  return a === "home" ? <Shell active="home"><Placeholder name="home" /></Shell> : a === "course" ? <Shell active={b}><Placeholder name={"course " + b} /></Shell> : a === "courses" ? <Shell active="courses"><Placeholder name="courses" /></Shell>
    : a === "lecture" ? <Shell active=""><Placeholder name={"lecture " + b} /></Shell> : a === "s" ? <Placeholder name={"shared " + b} /> : a === "new" ? <Shell active="new"><Placeholder name="new" /></Shell>
    : a === "live" ? <Shell active="new"><Placeholder name="live" /></Shell> : a === "pack" ? <Shell active={b}><Placeholder name={"pack " + b} /></Shell> : a === "settings" ? <Shell active="settings"><Placeholder name="settings" /></Shell>
    : a === "signin" ? <Placeholder name="signin" /> : a === "" ? <Placeholder name="landing" /> : <Shell active=""><Problem title="Page not found" text="That address does not match anything in Sidenote." /></Shell>;
}

/* afterRender() from sidenote.html: keep the chosen tab in view when the tab row scrolls sideways. */
function afterRender() {
  const tabs = document.querySelector(".tabs"), on = tabs && tabs.querySelector<HTMLElement>(".on");
  if (tabs && on) tabs.scrollLeft += on.getBoundingClientRect().left - tabs.getBoundingClientRect().left - (tabs.clientWidth - on.offsetWidth) / 2;
}

export function App() {
  useStore();
  useLayoutEffect(() => {
    /* A full redraw replaced every element in #app, so keyboard focus inside it was lost. Do the same (see lib/bus.ts). */
    if (takeFullRedraw()) { const el = document.activeElement as HTMLElement | null, app = document.getElementById("app"); if (el && app && app.contains(el)) el.blur(); }
    afterRender();
  });
  const { a, b } = R;
  let body: ReactNode = null;
  if (view.loader === "shell") body = <Shell active="" raw><Skeleton /></Shell>;
  else if (view.loader === "center") body = <div className="center"><Sid size={56} mood="wow" /></div>;
  else if (view.loader === null) {
    if (S.error) {
      const card = <Problem title="That did not load" text={S.error} btn={<button className="btn primary" onClick={() => route()}>{t("Try again")}</button>} />;
      body = S.token && S.homeLoaded && !PUBLIC.includes(a) ? <Shell active="">{card}</Shell> : <div className="pub" style={css("min-height:100vh;background:var(--bg)")}><nav className="pub-nav"><Logo href="#/" /></nav><div className="wrap" style={css("max-width:720px")}>{card}</div></div>;
    } else body = page(a, b);
  }
  const pill = view.loader === null && CONFIG.USE_MOCK && a !== "";
  return <>
    {/* A new route gets new elements, as the old innerHTML swap did; within one route React updates in place. */}
    <Fragment key={(view.loader || "page") + "|" + a + "/" + b}>{body}</Fragment>
    {pill ? <div className="mock-pill">{t("Sample data")}</div> : null}
    {createPortal(t("You are offline. Recording still works and is sent when you are back online."), document.querySelector(".offline-bar")!)}
    <Overlay />
  </>;
}
