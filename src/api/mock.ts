/* SAMPLE DATA: used only by the mock branches of `api`. Times are seconds from the start of the recording.
   The literal below is lines 460-537 of sidenote.html, copied as they are. */
import type { Course, Detail, Lecture, Settings, Slide, Upcoming, Week } from "../types";
import { abortError, type UploadOptions } from "./http";

interface MockLecture extends Lecture { full?: boolean; unshared?: boolean }
interface MockUpcoming extends Omit<Upcoming, "date"> { day: string; mon: string; date?: string }
interface MockDetail extends Detail { slides: (Slide & { section?: number })[] }
export interface MockData {
  user: { name: string; minutesToday: number; minutesLimit: number };
  courses: Course[];
  lectures: MockLecture[];
  upcoming: MockUpcoming[];
  detail: MockDetail;
  /* filled in by mockDb.prep() */
  details: Record<string, Detail>;
  week: Week;
  settings: Settings;
  feed: number;
  packs: Record<string, string>;
}

const SAMPLE = {
  user: { name: "Jasper", minutesToday: 90, minutesLimit: 240 },
  courses: [
    { id: "econ1001", code: "ECON 1001", name: "Principles of Microeconomics" },
    { id: "math2011", code: "MATH 2011", name: "Multivariable Calculus" },
    { id: "comp1021", code: "COMP 1021", name: "Introduction to Computer Science" }
  ],
  lectures: [
    { id: "econ-w9", course: "econ1001", title: "Opportunity cost and comparative advantage", week: 9, date: "Tue 10 Nov", duration: 5400, full: true },
    { id: "econ-w8", course: "econ1001", title: "Consumer choice and budget constraints", week: 8, date: "Tue 3 Nov", duration: 5280 },
    { id: "econ-w7", course: "econ1001", title: "Elasticity and its applications", week: 7, date: "Tue 27 Oct", duration: 5340 },
    { id: "math-w9", course: "math2011", title: "Lagrange multipliers", week: 9, date: "Mon 9 Nov", duration: 4800 },
    { id: "comp-w9", course: "comp1021", title: "Recursion", week: 9, date: "Wed 4 Nov", duration: 3000 }
  ],
  upcoming: [
    { day: "16", mon: "Nov", kind: "Deadline", text: "Problem set 4 due 23:59 on Canvas", course: "ECON 1001", lecture: "econ-w9", t: 3120 },
    { day: "19", mon: "Nov", kind: "Quiz", text: "In-class quiz on constrained optimisation", course: "MATH 2011", lecture: "math-w9", t: 95 },
    { day: "26", mon: "Nov", kind: "Midterm", text: "Midterm, chapters 1 to 4, closed book", course: "ECON 1001", lecture: "econ-w9", t: 18 }
  ],
  detail: {
    alerts: [
      { t: 18, kind: "Midterm", text: "Midterm on Thu 26 Nov in LT-A, chapters 1 to 4. Closed book, one A4 page of notes allowed." },
      { t: 3120, kind: "Deadline", text: "Problem set 4 is due Mon 16 Nov at 23:59 on Canvas." },
      { t: 4388, kind: "Exam hint", text: "The lecturer said working out opportunity cost from a two-good table “will be on the midterm”." }
    ],
    sections: [
      { title: "Opportunity cost", slides: "Slides 3 to 6", start: 200, end: 640, points: [
        { t: 252, text: "The opportunity cost of a choice is the value of the best alternative you gave up. It is not the sum of every alternative.", zh: "机会成本是你放弃的“最好的那一个”选项的价值，不是所有选项加起来。" },
        { t: 408, off: true, text: "It includes costs you never pay in cash. The lecturer's example: a year at university costs the tuition plus the salary you did not earn.", zh: "包括隐性成本：读一年大学的成本 = 学费 + 没去工作少赚的工资。" },
        { t: 570, text: "A cost that is the same under every option does not affect the decision, so leave it out.", zh: "每个选项都一样的成本不影响决策，可以忽略。" } ] },
      { title: "Sunk costs and thinking at the margin", slides: "Slides 7 to 9", start: 640, end: 1380, points: [
        { t: 663, text: "A sunk cost cannot be recovered whatever you choose next, so a rational decision ignores it.", zh: "沉没成本无论怎么选都收不回来，理性决策不应考虑它。" },
        { t: 860, off: true, text: "Concert ticket example: you paid $400 and feel ill on the day. Compare only the enjoyment of going with the comfort of staying home. The $400 is gone either way.", zh: "演唱会门票例子：票钱已经花了，只比较“去”和“不去”哪个更好。" },
        { t: 1065, text: "Decide by comparing marginal benefit with marginal cost: do one more unit only while the extra benefit is at least the extra cost.", zh: "边际分析：多做一单位的额外收益 ≥ 额外成本时才做。" } ] },
      { title: "Production possibilities frontier", slides: "Slides 10 to 15", start: 1380, end: 2700, points: [
        { t: 1450, text: "The PPF shows the maximum combinations of two goods an economy can produce with its current resources and technology.", zh: "生产可能性边界：现有资源和技术下两种商品的最大产量组合。" },
        { t: 1652, text: "The slope of the PPF is the opportunity cost of the good on the horizontal axis, measured in units of the other good.", zh: "PPF 的斜率 = 横轴商品的机会成本。" },
        { t: 1865, text: "A bowed-out PPF means opportunity cost rises as you produce more of one good, because resources are not equally suited to both.", zh: "向外凸的 PPF 表示机会成本递增。" },
        { t: 2140, text: "Points inside the frontier are inefficient and points outside are unattainable. Growth shifts the whole frontier outward.", zh: "边界内：无效率；边界外：做不到；经济增长使边界外移。" } ] },
      { title: "Absolute and comparative advantage", slides: "Slides 16 to 22", start: 2700, end: 3900, points: [
        { t: 2775, text: "Absolute advantage means producing more with the same inputs. Comparative advantage means producing at a lower opportunity cost.", zh: "绝对优势：同样投入产出更多；比较优势：机会成本更低。" },
        { t: 3190, text: "Worked example. Country A makes 10 cloth or 5 wine per worker, so 1 wine costs 2 cloth. Country B makes 6 cloth or 2 wine, so 1 wine costs 3 cloth. A has the comparative advantage in wine and B in cloth.", zh: "例题：A 国 1 酒 = 2 布，B 国 1 酒 = 3 布，所以 A 在酒上有比较优势，B 在布上有比较优势。" },
        { t: 3510, off: true, text: "The lecturer stressed a common exam mistake: a country can have an absolute advantage in everything, but it can never have a comparative advantage in everything.", zh: "老师强调的常见错误：可以所有商品都有绝对优势，但不可能所有商品都有比较优势。" } ] },
      { title: "Gains from trade", slides: "Slides 23 to 27", start: 3900, end: 5400, points: [
        { t: 4000, text: "Both countries gain when the price of wine in trade lies between their two opportunity costs, here between 2 and 3 cloth per wine.", zh: "贸易条件落在两国机会成本之间（2 到 3 布换 1 酒）时，双方都获益。" },
        { t: 4388, off: true, text: "Exam hint: expect a table like the cloth and wine one and be ready to compute each country's opportunity cost and state who exports what.", zh: "考试提示：会考类似布和酒的表格题。" },
        { t: 4815, text: "Next week covers supply and demand. Read chapter 4 before class.", zh: "下周讲供给与需求，课前读第 4 章。" } ] }
    ],
    transcript: [
      { t: 18, text: "Before we start, a reminder that the midterm is on Thursday the twenty-sixth of November in LT-A. It covers chapters one to four, it's closed book, and you may bring one A4 page of notes." },
      { t: 252, text: "So the opportunity cost is the value of the best thing you gave up. Not everything you gave up. Just the best one." },
      { t: 408, text: "Think about being here this year. You pay tuition, yes, but you also could have been working. That salary you didn't earn is part of the cost, even though nobody sends you a bill for it." },
      { t: 663, text: "A sunk cost is money that's gone whatever you do next. And because it's gone either way, it shouldn't change your decision." },
      { t: 860, text: "Say you bought a concert ticket for four hundred dollars and you wake up feeling ill. The four hundred is gone whether you go or not. The only question is whether tonight is better at the concert or at home." },
      { t: 1652, text: "The slope here tells you how much of the good on the vertical axis you give up to get one more unit of the good on the horizontal axis. That's the opportunity cost." },
      { t: 2775, text: "Absolute advantage is about who makes more. Comparative advantage is about who gives up less. Keep those two apart." },
      { t: 3120, text: "Problem set four is on Canvas. It's due Monday the sixteenth at eleven fifty-nine p.m." },
      { t: 3510, text: "This is where people lose marks. A country can be better at everything. It cannot have the comparative advantage in everything, because the opportunity costs are reciprocals of each other." },
      { t: 4388, text: "A question like this table, two countries and two goods, will be on the midterm. Compute the opportunity costs and tell me who exports what." },
      { t: 4815, text: "Next week is supply and demand. Please read chapter four before you come." }
    ],
    flashcards: [
      { q: "What is the opportunity cost of a choice?", a: "The value of the best alternative you gave up." },
      { q: "Why should a sunk cost not affect a decision?", a: "It cannot be recovered whichever option you choose, so it is the same in every option." },
      { q: "What does the slope of the PPF measure?", a: "The opportunity cost of the good on the horizontal axis, in units of the good on the vertical axis." },
      { q: "What does a bowed-out PPF tell you?", a: "Opportunity cost increases as more of one good is produced." },
      { q: "Absolute advantage or comparative advantage: which one decides who should produce a good?", a: "Comparative advantage. The producer with the lower opportunity cost should make it." },
      { q: "When do both countries gain from trade?", a: "When the trading price lies between the two countries' opportunity costs." }
    ],
    quiz: [
      { q: "You paid $400 for a concert ticket and feel ill on the day. Which cost matters for deciding whether to go?", opts: ["The $400 you paid", "The enjoyment of going compared with staying home", "The $400 plus the travel cost", "Nothing, you should always go"], a: 1, why: "The $400 is sunk. Only what differs between going and staying matters.", t: 860 },
      { q: "What does the slope of the PPF show?", opts: ["Total output of the economy", "The opportunity cost of one good in terms of the other", "The price level", "The unemployment rate"], a: 1, why: "Moving along the frontier, the slope is how much of one good you give up for one more unit of the other.", t: 1652 },
      { q: "Country A: 10 cloth or 5 wine per worker. Country B: 6 cloth or 2 wine. Who has the comparative advantage in cloth?", opts: ["Country A", "Country B", "Both", "Neither"], a: 1, why: "One cloth costs A half a wine and costs B a third of a wine. B gives up less, so B has the comparative advantage in cloth.", t: 3190 },
      { q: "Can one country have a comparative advantage in both goods?", opts: ["Yes, if it is more productive in both", "Yes, if it has more workers", "No, never", "Only with trade barriers"], a: 2, why: "The two opportunity costs are reciprocals, so being lower in one good means being higher in the other.", t: 3510 },
      { q: "In the cloth and wine example, which price of wine lets both countries gain?", opts: ["1.5 cloth", "2.5 cloth", "3.5 cloth", "4 cloth"], a: 1, why: "The price must lie between the two opportunity costs, 2 and 3 cloth per wine.", t: 4000 }
    ]
  }
};
export const DATA = SAMPLE as unknown as MockData;

/* Sample build only: an upload of `size` bytes that takes `ms`, reports progress in ten steps and can be cancelled. */
export async function fakeUpload(size: number, ms: number, opts: UploadOptions) {
  for (let i = 1; i <= 10; i++) {
    if (opts.signal && opts.signal.aborted) throw abortError();
    await new Promise(r => setTimeout(r, ms / 10));
    if (opts.signal && opts.signal.aborted) throw abortError();
    if (opts.onProgress) opts.onProgress(Math.round(size * i / 10), size);
  }
}

export const mockDb = {
  ready: false,
  prep() {
    if (this.ready) return; this.ready = true;
    const d = DATA.detail; d.slides = []; d.audio = { url: null };   // no audio file in the sample build: see silentClock()
    /* Sample build only: give every sample explanation both forms. The table covers just the characters the sample text uses; a real backend sends zhHant and zhHans itself. */
    const T = "机機会會弃棄个個选選项項价價来來隐隱读讀学學费費没沒赚賺资資样樣响響决決无無论論么麼应應虑慮门門钱錢经經较較边邊际際单單额額时時产產现現术術两兩种種组組横橫轴軸递遞内內济濟长長绝絕对對优優势勢题題国國师師强強调調见見错錯误誤贸貿条條间間换換双雙获獲试試类類周週讲講给給与與课課“「”」";
    const toHant = (s: string) => s.replace(/[^\x00-\x7f]/g, ch => { const i = T.indexOf(ch); return i >= 0 && i % 2 === 0 ? T[i + 1] : ch; });
    d.sections.forEach(s => s.points.forEach(p => { if (p.zh) { p.zhHans = p.zh; p.zhHant = toHant(p.zh); delete p.zh; } }));
    d.sections.forEach((s, si) => { const m = s.slides!.match(/(\d+)\D+(\d+)/)!, a = +m[1], b = +m[2];
      for (let n = a; n <= b; n++) d.slides.push({ n, title: s.title, section: si, image: null });
      s.points.forEach((p, k) => { p.slide = a + Math.floor(k * (b - a + 1) / s.points.length); }); });
    DATA.upcoming.forEach(u => { u.date = "2026-11-" + u.day; });
    DATA.details = { "econ-w9": d };
    DATA.week = { lectures: 4, known: 23, quiz: 86, days: [1, 1, 1, 0, 0] };
    DATA.settings = { classLanguage: "en", zhDefault: false };
    DATA.feed = 0; DATA.packs = {};
  }
};

/* Slides in sample mode (added after the migration). Notes made for a lecture whose slides were never sent come without
   slides, as a real backend would make them; sending slides later files the existing points under them. Kept apart from
   DATA so the sample data itself stays as it was in sidenote.html. */
export const mockSlides = new Set<string>();   // lectures whose slides were sent in this session
export function withoutSlides(d: Detail): Detail {
  return { ...d, slides: [], sections: d.sections.map(s => { const c = { ...s, points: s.points.map(p => ({ ...p, slide: null, off: false })) }; delete c.slides; return c; }) };
}
/* Keeps the points as they are (text, edits, points the student added) and gives each one the slide it belongs to,
   found by its timestamp in the full sample notes. */
export function fileUnderSlides(d: Detail): Detail {
  const full = DATA.detail;
  return { ...d, slides: full.slides, sections: d.sections.map((s, i) => { const f = full.sections[i];
    return { ...s, ...(f && f.slides ? { slides: f.slides } : {}), points: s.points.map(p => { const fp = f && p.t != null ? f.points.find(x => x.t === p.t) : undefined; return fp ? { ...p, slide: fp.slide, off: fp.off } : p; }) }; }) };
}
