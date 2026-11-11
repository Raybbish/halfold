/* Picks the page for the current route. This is render() from sidenote.html: it runs again on every bump(). */
import { Fragment, useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CONFIG } from "./config";
import { takeFullRedraw } from "./lib/bus";
import { R, S, view } from "./state/app";
import { PUBLIC, route } from "./state/router";
import { t } from "./i18n";
import { useStore } from "./ui/useStore";

function Placeholder({ name }: { name: string }) { return <div className="placeholder" data-page={name}>{name}</div>; }

function page(a: string, b: string): ReactNode {
  return a === "home" ? <Placeholder name="home" /> : a === "course" ? <Placeholder name={"course " + b} /> : a === "courses" ? <Placeholder name="courses" />
    : a === "lecture" ? <Placeholder name={"lecture " + b} /> : a === "s" ? <Placeholder name={"shared " + b} /> : a === "new" ? <Placeholder name="new" />
    : a === "live" ? <Placeholder name="live" /> : a === "pack" ? <Placeholder name={"pack " + b} /> : a === "settings" ? <Placeholder name="settings" />
    : a === "signin" ? <Placeholder name="signin" /> : a === "" ? <Placeholder name="landing" /> : <Placeholder name="not found" />;
}

export function App() {
  useStore();
  useLayoutEffect(() => {
    if (takeFullRedraw()) { const el = document.activeElement as HTMLElement | null, app = document.getElementById("app"); if (el && app && app.contains(el)) el.blur(); }
  });
  const { a, b } = R;
  let body: ReactNode = null;
  if (view.loader === "shell") body = <Placeholder name="loading (shell)" />;
  else if (view.loader === "center") body = <Placeholder name="loading" />;
  else if (view.loader === null) body = S.error ? <div><Placeholder name={"error: " + S.error} /><button className="btn primary" onClick={() => route()}>Try again</button></div> : page(a, b);
  const pill = view.loader === null && CONFIG.USE_MOCK && a !== "";
  void PUBLIC;
  return <>
    <Fragment key={(view.loader || "page") + "|" + a + "/" + b}>{body}</Fragment>
    {pill ? <div className="mock-pill">{t("Sample data")}</div> : null}
    {createPortal(t("You are offline. Recording still works and is sent when you are back online."), document.querySelector(".offline-bar")!)}
  </>;
}
