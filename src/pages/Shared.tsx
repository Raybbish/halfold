/* ---------- shared page: #/s/:id, readable without signing in ---------- */
import { S, setCur } from "../state/app";
import { t } from "../i18n";
import { Logo, Hal } from "../ui/icons";
import { LangBtn } from "../ui/Shell";
import { css } from "../ui/css";
import { LectureBody } from "./Lecture";
import { saveShared } from "./lecture/actions";

export function Shared({ id }: { id: string }) {
  const sh = S.shared[id]; setCur({ l: sh.lecture, c: sh.course, d: sh.detail, shared: true });
  return <><div className="shared-bar"><div className="wrap"><Hal size={22} mood="smile" color="#fff" /><span>{t(sh.sharedBy + " shared these notes with you. Read only.")}</span></div></div>
    <div className="pub" style={css("background:var(--bg)")}><nav className="pub-nav"><Logo href="#/" /><span className="sp"></span><LangBtn />{S.token ? <button className="btn sm" onClick={saveShared}>{t("Save to my lectures")}</button> : null}<a className="btn primary sm desk" href="#/new">{t("Record your own lecture")}</a></nav>
      <div className="wrap" style={css("max-width:900px;padding-top:12px")}><LectureBody /></div>
      <div className="sticky-cta"><div className="wrap" style={css("max-width:900px")}><span><b style={css("color:var(--ink)")}>{t("Is your course missing?")}</b>{t(" Record one class and the notes are ready when it ends.")}</span><a className="btn primary" href="#/new">{t("Record your own lecture")}</a></div></div></div></>;
}
