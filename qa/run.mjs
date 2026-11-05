// ×はどこだ の検査。index.html をブラウザで開き、自動で遊んで確かめる（Claude は使わない）。
// 使い方: node qa/run.mjs [通しで遊ぶ回数（既定 3）]   失敗があれば終了コード 1。結果は qa-report/report.md。
// 乱数で組む部分（広告の組み合わせ・関所の位置）は、遊ぶのとは別に何百回も作って毎回の結果を確かめる。
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = "file://" + path.join(root, "index.html");
const RUNS = Number(process.argv[2] || 3);
const W = 390, H = 780;
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail: String(detail) }); console.log(ok ? "✓" : "✗", name, ok ? "" : detail); };

// ブラウザ：CHROMIUM_PATH、無ければクラウドの決まった場所、無ければ Playwright の既定
const exe = process.env.CHROMIUM_PATH || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : "");
let browser = null;
try { browser = await chromium.launch(exe ? { executablePath: exe } : {}); }
catch (e) { check("Chromium を起動できる（bash scripts/setup.sh を見る）", false, e.message); }
const errors = [];
// 外へ出た通信（file:// とデータの読み込みは除く）。記事を遊ぶあいだも全部記録する
const ALLOW = ["127.0.0.1", "fonts.googleapis.com", "fonts.gstatic.com"];
const outsideAll = [];
const recordOutside = (r) => { const u = new URL(r.url()); if (!["file:", "data:", "blob:"].includes(u.protocol) && !ALLOW.includes(u.hostname)) outsideAll.push(r.url()); };
const watchNet = (p) => p.on("request", recordOutside);
async function open({ unlock = true } = {}) {
  const p = await browser.newPage({ viewport: { width: W, height: H } });
  p.on("pageerror", (e) => errors.push(e.message)); watchNet(p);
  await p.goto(url);
  if (unlock) await p.evaluate(() => { ARTICLES.forEach((a) => localStorage.setItem("xdoko-best-" + a.id, "99.0")); menu(); });
  return p;
}
const startArt = async (p, i) => { await p.click(`.lv[data-i="${i}"]`); await p.click("#go"); };
const scroll = (p) => p.evaluate(() => document.querySelector("#page").scrollBy(0, 60));
const adOpen = async (p) => (await p.locator("#stage > :first-child[data-type]").count()) > 0;

// 広告の種類ごとの正しい閉じ方
async function solve(p) {
  const type = await p.getAttribute("#stage > :first-child", "data-type");
  const c = (s) => p.click("#stage " + s);
  switch (type) {
    case "shift": for (let i = 0; i < 4; i++) { await c(".run"); await p.waitForTimeout(280); } break;
    case "confirm": case "chain": await c(".nest"); await c(".cf .real"); break;
    case "swipe": { const b = await p.locator("#stage .drag").boundingBox(); await p.mouse.move(b.x + 20, b.y + 40); await p.mouse.down(); await p.mouse.move(b.x + 20, b.y - 260, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(300); break; }
    case "video": await p.waitForSelector("#stage .skip.real", { timeout: 9000 }); await c(".skip.real"); break;
    case "countdown": await p.waitForSelector("#stage .real:not([hidden])", { timeout: 9000 }); await c(".real:not([hidden])"); break;
    default: await c(".real");
  }
  return type;
}
async function play(p, i) { await startArt(p, i); return playOn(p, `記事${i + 1}`); }
// 始めたあと、最後まで読む（広告は正しく閉じる）
async function playOn(p, name) {
  const seen = [];
  for (let k = 0; k < 3000; k++) {
    if (await p.isVisible("#stage .card")) break;
    if (await p.isVisible("#virus")) throw new Error(`${name} 途中でゲームオーバー（${seen.join(",")}）`);
    if (await adOpen(p)) { seen.push(await solve(p)); await p.waitForTimeout(60); continue; }
    const turn = await p.evaluate(() => { const nb = document.querySelector("#nextBtn"); return !!nb && !nb.hidden && document.querySelector("#stage").hidden && nb.getBoundingClientRect().top < innerHeight - 120; });
    if (turn) await p.evaluate(() => document.querySelector("#nextBtn").click());
    await scroll(p); await p.waitForTimeout(15);
  }
  if (!(await p.textContent("#stage")).includes("読み切った")) throw new Error(`${name} ゴールしない`);
  return seen;
}

if (browser) try {
  // 1. 形：記事3本・広告の種類・中身が架空であること
  {
    const p = await open();
    const d = await p.evaluate(() => ({ arts: ARTICLES.map((a) => ({ id: a.id, ads: a.ads, lv: a.lv, v: a.vignette })), types: Object.entries(TYPES).map(([k, t]) => ({ k, lv: t.lv, hint: !!t.hint })) }));
    check("記事が5本（レシピ→旅行→ニュース→家電レビュー→家計）", d.arts.map((a) => a.id).join() === "recipe,travel,news,review,money");
    check("先の記事ほど広告が多い", d.arts.every((a, i) => i === 0 || a.ads > d.arts[i - 1].ads), d.arts.map((a) => a.ads));
    check("広告の種類が19あり、どれにもヒントがある", d.types.length === 19 && d.types.every((t) => t.hint), d.types.length);
    for (const lv of [1, 2, 3]) {
      const pool = d.types.filter((t) => t.lv <= lv).length, need = d.arts.find((a) => a.lv === lv).ads;
      check(`難しさ${lv}の記事は、選べる種類（${pool}）が広告の数（${need}）以上`, pool >= need);
    }
    await p.close();
  }

  // 2. 乱数の部分を何百回も作る：広告の組み合わせ（重ならない・難しさの範囲・いちばん難しい段を1つは入れる）
  {
    const p = await open();
    const bad = await p.evaluate(() => {
      const out = [];
      for (const a of ARTICLES) for (let r = 0; r < 500; r++) {
        const o = pickOrder(a);
        if (o.length !== a.ads) out.push(`${a.id}:枚数${o.length}`);
        if (new Set(o).size !== o.length) out.push(`${a.id}:重なり${o}`);
        if (o.some((t) => !TYPES[t] || TYPES[t].lv > a.lv)) out.push(`${a.id}:難しすぎ${o}`);
        if (!o.some((t) => TYPES[t].lv === a.lv)) out.push(`${a.id}:その段が無い${o}`);
      }
      return out.slice(0, 5);
    });
    check("広告の組み合わせを記事ごとに500回作って、どれも正しい", bad.length === 0, bad.join(" / "));
    // 関所の位置（記事を作り直すたびに、広告の間が1画面の0.75以上あく）
    const gaps = [];
    for (let i = 0; i < 5; i++) for (let r = 0; r < 20; r++) {
      const g = await p.evaluate((i) => { A = ARTICLES[i]; build(); const p2 = document.querySelector("#p2"); if (p2) p2.hidden = false;
        const top = document.querySelector("#art").getBoundingClientRect().top; const ys = [...document.querySelectorAll(".gate")].map((x) => x.getBoundingClientRect().top - top);
        const ids = [...document.querySelectorAll(".gate")].map((x) => +x.dataset.i);
        return { min: Math.min(...ys.map((y, k) => (k ? y - ys[k - 1] : y))), n: ys.length, want: A.ads - (A.vignette ? 1 : 0), ids, V };
      }, i);
      gaps.push({ i, ...g });
    }
    const tight = gaps.filter((g) => g.min < H * 0.75);
    check("関所を記事ごとに20回置き直して、広告の間はいつも0.75画面以上", tight.length === 0, tight.map((g) => `記事${g.i + 1}:${Math.round(g.min)}px`).join(","));
    const wrong = gaps.filter((g) => g.n !== g.want || new Set(g.ids).size !== g.n || (g.V >= 0 && g.ids.includes(g.V)));
    check("関所の数と番号がそろう（全画面の広告の番号とは重ならない）", wrong.length === 0, JSON.stringify(wrong[0] || ""));
    await p.close();
  }

  // 3. 通しで遊ぶ（毎回ちがう組み合わせ）
  const used = new Set();
  for (let i = 0; i < 5; i++) {
    let okRuns = 0, detail = "";
    for (let r = 0; r < RUNS; r++) {
      const p = await open();
      try { const seen = await play(p, i); seen.forEach((s) => used.add(s)); okRuns++; } catch (e) { detail = e.message; }
      await p.close();
    }
    check(`記事${i + 1} を ${RUNS} 回とも最後まで読めた`, RUNS > 0 && okRuns === RUNS, detail || (RUNS > 0 ? "" : "回数が0"));
  }
  {
    // 出なかった種類は1枚ずつ開いて閉じられるか確かめる（全種類を毎回見る）
    const p = await open(); await startArt(p, 2);
    const all = await p.evaluate(() => Object.keys(TYPES)); const fails = [];
    for (const t of all.filter((t) => !used.has(t))) {
      await p.evaluate((t) => { ORDER[n] = t; openAd(); }, t);
      try { await solve(p); if (await adOpen(p)) fails.push(t); } catch (e) { fails.push(t + ":" + e.message); }
    }
    check("広告の全19種類を、正しい手順で閉じられる", fails.length === 0, fails.join(","));
    // 新しく足した広告は、わなを押すと感染する
    const traps = { faint: "#stage .big", cookie: "#stage .prim", survey: "#stage .x.fake" }, trapNg = [];
    for (const [t, sel] of Object.entries(traps)) {
      await p.evaluate((t) => { start(ARTICLES[2]); document.querySelector("#go").click(); ORDER[n] = t; openAd(); }, t);
      await p.click(sel); await p.waitForTimeout(80);
      if (!(await p.isVisible("#virus"))) trapNg.push(t);
    }
    check("うすい「閉じる」・クッキーの同意・アンケートは、わな（大きなボタン・すべて同意・右上の×）を押すと感染する", trapNg.length === 0, trapNg.join(","));
    await p.close();
  }

  {
    const p = await open(); await startArt(p, 2);
    await p.evaluate(() => { ORDER[n] = "swipe"; openAd(); }); await p.keyboard.press("ArrowUp"); await p.waitForTimeout(100);
    check("スワイプで閉じる広告は、キーボード（矢印キー）でも閉じられる", !(await adOpen(p)));
    await p.setViewportSize({ width: 640, height: 300 });
    let reach = true; for (const t of ["corner", "outside", "three", "picx", "countdown"]) {
      await p.evaluate((t) => { ORDER[n] = t; openAd(); }, t); if (t === "countdown") await p.waitForSelector("#stage .real:not([hidden])", { timeout: 9000 });
      await p.locator("#stage .real:not([hidden])").first().scrollIntoViewIfNeeded(); const b = await p.locator("#stage .real:not([hidden])").first().boundingBox();
      if (!b || b.y < 0 || b.y + b.height > 300) reach = false; await solve(p).catch(() => { reach = false; });
    }
    check("背の低い画面（横向きのスマホ）でも、上のほうの×に届く", reach);
    await p.close();
  }

  // 4. 押してはいけない所・押してよい所
  for (const [art, sel, bad, name] of [[0, ".inad", 1, "記事の中の広告"], [0, "#anchor span", 1, "下に貼りつく広告"], [0, "#fold", 0, "下の広告の×"], [2, "#appbar .open", 1, "上のアプリ誘導"], [2, "#appbar .shut", 0, "上のアプリ誘導の×"]]) {
    const p = await open(); await startArt(p, art); await p.click(sel); await p.waitForTimeout(2500);
    const over = await p.isVisible("#virus .over");
    check(`${name}を押すと${bad ? "ゲームオーバー" : "閉じる（ゲームオーバーにならない）"}`, !!bad === over);
    await p.close();
  }
  {
    const p = await open(); await startArt(p, 0);
    for (let k = 0; k < 400 && !(await adOpen(p)); k++) { await scroll(p); await p.waitForTimeout(15); }
    await p.locator("#stage .fake:visible, #stage .big:visible, #stage .buy:visible").first().click(); await p.waitForTimeout(2500);
    check("ふさぐ広告のまちがったボタンでウイルス画面→GAME OVER", await p.isVisible("#virus .over"));
    await p.click("#againBtn"); check("GAME OVER から「もう一度」で同じ記事を始められる", await p.isVisible("#go"));
    await p.close();
  }

  // 5. 時間・ヒント・記録・解放
  {
    const p = await open({ unlock: false });
    check("最初は記事1だけ開いている", !(await p.isDisabled('.lv[data-i="0"]')) && (await p.isDisabled('.lv[data-i="1"]')) && (await p.isDisabled('.lv[data-i="2"]')));
    await p.evaluate(() => localStorage.setItem("xdoko-stats", JSON.stringify({ clear: 0, closed: 1, virus: 0 })));
    await startArt(p, 0);
    for (let k = 0; k < 400 && !(await adOpen(p)); k++) { await scroll(p); await p.waitForTimeout(15); }
    const before = await p.evaluate(() => pen); await p.click("#hintBtn"); const after = await p.evaluate(() => pen);
    check("ヒントを見ると5秒足される", after - before === 5 && (await p.isVisible("#hintTxt")));
    await p.evaluate(() => menu());
    await play(p, 0);
    const share = await p.textContent("#shareTxt"), shown = await p.textContent("#clock");
    check("結果の文に記事名・広告ごとの印（4つ）・タイム・挑戦状のリンクが入る", share.includes("記事1") && share.includes("✅✅✅✅") && share.includes(shown) && share.includes("#×はどこだ") && share.includes("batsu-doko/?a=recipe&t=" + parseFloat(shown).toFixed(1)), share);
    const links = await p.evaluate(() => ({ x: document.querySelector("#xBtn").href, line: document.querySelector("#lineBtn").href, share: !!navigator.share, btn: !!document.querySelector("#shareBtn") }));
    check("X と LINE の共有ボタンが、結果の文を入れた公式の共有リンクになっている", links.x.startsWith("https://x.com/intent/post?text=") && decodeURIComponent(links.x).includes("記事1") && new URL(links.x).searchParams.get("url")?.includes("?a=recipe&t=" + parseFloat(shown).toFixed(1)) && links.line.startsWith("https://line.me/R/share?text=") && new URL(links.line).searchParams.get("text")?.includes("?a=recipe&t=" + parseFloat(shown).toFixed(1)), JSON.stringify(links));
    const sd = await p.evaluate(() => MODE.seed);
    check("記事の共有リンクに広告の並びの番号（&s=）が入る", Number.isInteger(sd) && share.includes("&s=" + sd), share);
    check("端末の共有（Web Share）があるときだけ「結果を送る」が出る", links.share === links.btn);
    check("結果のタイムは0秒より大きい", parseFloat(shown) > 0, shown);
    await p.context().grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
    await p.click("#copyBtn"); await p.waitForTimeout(200);
    const copied = await p.evaluate(() => navigator.clipboard.readText().catch(() => getSelection().toString()));
    check("「結果をコピー」で結果の文がそのままコピーされる（だめなら選ばれる）", copied.trim() === share.trim(), copied);
    const order = await p.evaluate(() => { const all = [...document.querySelectorAll("#stage .card button, #stage .card a")].map((x) => x.id); return { again: all.indexOf("againRun"), x: all.indexOf("xBtn"), inBox: !!document.querySelector("#sendBox #shareTxt") }; });
    check("結果の画面は、次へ・もう一度・メニューが共有より先に来て、送る文はたたんだ中にある", order.again >= 0 && order.again < order.x && order.inBox, JSON.stringify(order));
    const wb = await p.evaluate(() => { return getComputedStyle(document.querySelector(".article h2")).wordBreak; });
    check("記事の見出しは文節の切れ目で折り返す（word-break: auto-phrase）", wb === "auto-phrase", wb);
    await p.click("#toMenu");
    check("記事1を読み切ると記事2が開き、ベストが残る", !(await p.isDisabled('.lv[data-i="1"]')) && /秒/.test(await p.textContent('.lv[data-i="0"] .bt')));
    const total = await p.evaluate(() => { localStorage.setItem("xdoko-best-recipe", "12.3"); localStorage.setItem("xdoko-best-travel", "20.0"); localStorage.setItem("xdoko-best-news", "30.4"); localStorage.setItem("xdoko-best-review", "40.0"); localStorage.setItem("xdoko-best-money", "50.0"); menu(); return document.querySelector("#stage .card").textContent; });
    check("5本読み切ると合計ベストが出る（12.3+20.0+30.4+40.0+50.0=152.7秒）", total.includes("5本の合計ベスト 152.7秒"), total);
    await p.close();
  }

  // 5b. 今日の1本（日の番号で同じ並び）・連続記録・挑戦状・共有・押しやすさ・失敗の説明
  {
    const p = await open();
    const det = await p.evaluate(() => {
      const snap = (d) => { start(dailyArt(d), { kind: "daily", day: d }); const p2 = document.querySelector("#p2"); if (p2) p2.hidden = false;
        const spots = [...document.querySelectorAll("#art .spot")]; const g = [...document.querySelectorAll(".gate")].map((x) => x.dataset.i + "@" + spots.indexOf(x.previousElementSibling)).join(); if (p2) p2.hidden = true; return ORDER.join() + "|" + g + "|" + document.querySelector("#anchorTxt").textContent; };
      const a = snap(5), same = Array.from({ length: 100 }, () => snap(5)).every((x) => x === a);
      const diff = new Set(Array.from({ length: 30 }, (_, i) => snap(i + 1))).size;
      let bad = [];
      for (let d = 1; d <= 300; d++) { const A = dailyArt(d); start(A, { kind: "daily", day: d }); const top = Math.max(...ORDER.map((t) => TYPES[t].lv));
        if (ORDER.length !== A.ads || new Set(ORDER).size !== ORDER.length || top !== A.lv || ORDER.some((t) => TYPES[t].lv > A.lv)) bad.push(d); }
      const rot = [1, 2, 3, 4, 5, 6].map((d) => dailyArt(d).id).join();
      menu(); return { same, diff, bad, rot };
    });
    check("今日の1本は、同じ日なら100回作っても同じ広告の並び・置き場所", det.same);
    check("今日の1本は、日がちがえば並びが変わる（30日で25通り以上）", det.diff >= 25, det.diff);
    check("今日の1本を300日ぶん作っても、どの日も枚数・重なりなし・難しさが正しい", det.bad.length === 0, det.bad.slice(0, 5));
    check("今日の1本の記事は日ごとに 1→2→3→4→5→1 と回る", det.rot === "recipe,travel,news,review,money,recipe", det.rot);
    // 連続記録：前の日に読み切っていれば +1、1日あくと 1 から
    const sk = await p.evaluate(() => {
      const fin = (d) => { window.__XDOKO_DAY = d; start(dailyArt(d), { kind: "daily", day: d }); running = true; t0 = performance.now() - 3000; finish(); return JSON.parse(localStorage.getItem("xdoko-streak")); };
      localStorage.removeItem("xdoko-streak"); const a = fin(10).count, b = fin(11).count, b2 = fin(11).count; menu(); const m1 = document.querySelector("#dailyBtn").textContent; const c = fin(13).count;
      window.__XDOKO_DAY = 13; menu(); const m = document.querySelector("#dailyBtn").textContent;
      window.__XDOKO_DAY = 15; menu(); const m2 = document.querySelector("#dailyBtn").textContent; delete window.__XDOKO_DAY; return { a, b, b2, c, m, m1, m2 };
    });
    check("連続記録：続けて読むと増え、同じ日は増えず、1日あくと1に戻る", sk.a === 1 && sk.b === 2 && sk.b2 === 2 && sk.c === 1, JSON.stringify(sk));
    check("メニューに今日の1本のベストと「🔥2日連続」が出て、1日だけ・途切れた連続は出さない", /秒/.test(sk.m) && sk.m1.includes("🔥2日連続") && !sk.m.includes("連続") && !sk.m2.includes("連続"), [sk.m1, sk.m, sk.m2].join(" / "));
    // 今日の1本を通しで遊ぶ
    await p.evaluate(() => { window.__XDOKO_DAY = 2; localStorage.removeItem("xdoko-streak"); menu(); });
    await p.click("#dailyBtn"); await p.click("#go");
    let okDaily = true; try { await playOn(p, "今日の1本"); } catch (e) { okDaily = false; }
    const dshare = okDaily ? await p.textContent("#shareTxt") : "";
    check("今日の1本を最後まで読め、結果の文に番号・連続・リンクが入る", okDaily && dshare.includes("今日の1本 #2") && dshare.includes("?d=2&t="), dshare);
    // 2日続けたあとの共有文に「🔥2日連続」が入る。ベストがある日に遊び直しても連続は数える
    const sk2 = await p.evaluate(() => {
      const fin = (d) => { window.__XDOKO_DAY = d; start(dailyArt(d), { kind: "daily", day: d }); running = true; t0 = performance.now() - 3000; finish(); return document.querySelector("#shareTxt").textContent; };
      localStorage.removeItem("xdoko-streak"); fin(30); const txt = fin(31);
      localStorage.removeItem("xdoko-streak"); localStorage.setItem("xdoko-daily-40", "9.9"); fin(40); const c = JSON.parse(localStorage.getItem("xdoko-streak") || "{}").count;
      delete window.__XDOKO_DAY; menu(); return { txt, c };
    });
    check("2日続けて読み切ると、共有文に「🔥2日連続」が入る", sk2.txt.includes("🔥2日連続"), sk2.txt);
    check("その日のベストがすでにあっても、読み切れば連続に数える", sk2.c === 1, sk2.c);
    // 記事の挑戦状：同じ番号（s）なら、何度作っても同じ広告の並び。もう一度はふつうなら新しい並び
    const sv = await p.evaluate(() => {
      // 並び・関所の置き場所・記事の中の広告・下の広告をまとめて比べる
      const snap = (s) => { start(ARTICLES[2], { kind: "article", seed: s }); const p2 = document.querySelector("#p2"); if (p2) p2.hidden = false;
        const spots = [...document.querySelectorAll("#art .spot")]; const g = [...document.querySelectorAll(".gate")].map((x) => x.dataset.i + "@" + spots.indexOf(x.previousElementSibling)).join(); if (p2) p2.hidden = true;
        const ads = [...document.querySelectorAll("#art .inad span")].map((x) => x.textContent).join();
        return ORDER.join() + "|" + g + "|" + ads + "|" + document.querySelector("#anchorTxt").textContent; };
      const a = snap(12345), same = Array.from({ length: 100 }, () => snap(12345)).every((x) => x === a);
      const diff = new Set(Array.from({ length: 30 }, (_, i) => snap(i + 1))).size;
      start(ARTICLES[0]); const s1 = MODE.seed; start(ARTICLES[0], again()); const s2 = MODE.seed;
      start(ARTICLES[0], { kind: "article", seed: 77, rival: 20 }); start(ARTICLES[0], again()); const s3 = MODE.seed;
      menu(); return { same, diff, s1, s2, s3 };
    });
    check("記事の挑戦状は、同じ番号なら100回作っても同じ広告の並び", sv.same);
    check("記事の並びは、番号がちがえば変わる（30通りで5通り以上）", sv.diff >= 5, sv.diff);
    check("もう一度：ふつうの記事は新しい並び、挑戦状は同じ並び", sv.s1 !== sv.s2 && sv.s3 === 77, JSON.stringify(sv));
    await p.close();
  }
  {
    // 挑戦状のリンク：開くとその場で挑戦でき、勝ち負けが出る。リンクの印はアドレスから消す
    const p = await open({ unlock: false });
    await p.addInitScript(() => { window.__XDOKO_DAY = 5; }); // 実行する日に左右されないよう日を決める（#1 が過去7日に入る日。2026-11-05 CodeRabbit）
    await p.goto(url + "?d=1&t=12.3"); await p.waitForTimeout(200);
    const card = await p.textContent("#stage .card"), search = await p.evaluate(() => location.search);
    check("挑戦状のリンク（?d=1&t=12.3）で開くと、相手のタイムつきで #1 が始められる（過去の日はあとからとして）", card.includes("#1") && card.includes("あとから") && card.includes("12.3秒") && (await p.isVisible("#go")), card);
    check("挑戦状の印はアドレスから消える（読み込み直しでふつうに戻る）", search === "", search);
    await p.click("#go"); const vs = await p.evaluate(() => { t0 = performance.now() - 4000; pen = 0; finish(); return document.querySelector("#stage .card").textContent; });
    check("挑戦状の相手より速ければ「勝ち」が出る", vs.includes("勝ち") && vs.includes("12.3秒"), vs);
    // 相手は0.1秒に丸めてある。同じ表示（12.3秒）なら負けにせず「同タイム」
    // 時計を止めて決まった値を返させ、CI の重さで揺れないようにする。12.35 は toFixed(1) で 12.3（時計の表示）になる境目
    const tie = await p.evaluate(() => { const real = performance.now; try { return [12.34, 12.26, 12.36, 12.35].map((x) => { start(A, MODE); running = true; performance.now = () => x * 1000; t0 = 0; pen = 0; finish(); return document.querySelector("#stage .card").textContent; }); } finally { performance.now = real; } });
    check("挑戦状：表示が同じタイムなら「同タイム」、0.1秒でも遅ければ「あと 0.1秒」", tie[0].includes("同タイム") && tie[1].includes("同タイム") && tie[2].includes("あと 0.1秒") && tie[3].includes("同タイム") === ((12.35).toFixed(1) === "12.3"), tie.map((x) => x.slice(-30)).join(" / "));
    await p.goto(url + "?a=travel&t=30&s=4242"); await p.waitForTimeout(200);
    const lk = await p.evaluate(() => { const a = ORDER.join(); start(A, { kind: "article", seed: 4242 }); return { seed: MODE.seed, same: a === ORDER.join() }; });
    check("記事の挑戦状のリンク（&s=4242）を開くと、送った人と同じ並びになる", lk.same && lk.seed === 4242, JSON.stringify(lk));
    await p.goto(url + "?a=news&t=50"); await p.waitForTimeout(200);
    check("記事の挑戦状（?a=news）は、まだ開いていない記事でもその場で遊べる", (await p.textContent("#stage .card")).includes("みなと市ニュース"));
    for (const q of ["?d=999999&t=1", "?d=abc", "?a=nope&t=3", "?d=1&t=-5"]) {
      await p.goto(url + q); await p.waitForTimeout(150);
      const txt = await p.textContent("#stage .card");
      const ok = q === "?d=1&t=-5" ? txt.includes("1本") && txt.includes("#1") && !txt.includes("挑戦状") : !!(await p.$("#dailyBtn"));
      check(`おかしな挑戦状のリンク（${q}）でも壊れない`, ok, txt.slice(0, 40));
    }
    await p.close();
  }
  {
    // 押せる所の大きさ（44px 以上。Apple HIG）と、読んだ量のバー・残りの数・失敗の説明
    const p = await open();
    await p.waitForTimeout(300); const sz = await p.evaluate(() => [...document.querySelectorAll("#dailyBtn,.lv,#menuSound,#soundBtn")].map((b) => { const r = b.getBoundingClientRect(); return [b.id || b.className, Math.round(r.height), Math.round(r.width)]; }));
    await startArt(p, 0);
    for (let k = 0; k < 400 && !(await adOpen(p)); k++) { await scroll(p); await p.waitForTimeout(15); }
    const hb = await p.evaluate(() => { const r = document.querySelector("#hintBtn").getBoundingClientRect(); return Math.round(r.height); });
    const smalls = sz.filter(([, h]) => h < 44).concat(hb < 44 ? [["hintBtn", hb]] : []);
    check("メニュー・音・ヒントのボタンは高さ44px以上", smalls.length === 0, JSON.stringify(smalls));
    const h = await p.evaluate(() => ({ bar: parseFloat(document.querySelector("#progBar").style.width), cnt: document.querySelector("#cnt").textContent }));
    check("読んだ量のバーが進み、上に「広告 0/4」と出る", h.bar > 0 && h.cnt === "広告 0/4", JSON.stringify(h));
    await p.locator("#stage .fake:visible, #stage .big:visible, #stage .buy:visible").first().click(); await p.waitForTimeout(2500);
    const how = await p.textContent("#vhow");
    check("ふさぐ広告で失敗すると、正しい閉じ方とどこまで読めたかが出る", how.includes("正しくは") && /記事の \d+% まで読めた/.test(how) && how.includes("残りの広告 4枚"), how);
    await p.click("#againBtn"); await p.click("#go"); await p.click(".inad"); await p.waitForTimeout(2500);
    check("記事の中の広告で失敗すると、読み飛ばせばよいと出る", (await p.textContent("#vhow")).includes("読み飛ばす"));
    await p.close();
  }
  {
    // SNS に貼ったときの画像（OGP）
    const p = await open();
    const m = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll("meta[property^='og:'],meta[name^='twitter:']")].map((x) => [x.getAttribute("property") || x.getAttribute("name"), x.content])));
    const png = existsSync(path.join(root, "og.png")) ? readFileSync(path.join(root, "og.png")) : null;
    const wh = png ? [png.readUInt32BE(16), png.readUInt32BE(20)] : [0, 0];
    check("OGP：題・説明・画像（https の絶対アドレス）・大きい画像のカードがある", m["og:title"] && m["og:description"] && /^https:\/\/.+\/og\.png$/.test(m["og:image"] || "") && m["twitter:card"] === "summary_large_image", JSON.stringify(m));
    check("OGP の画像 og.png が 1200×630", wh[0] === 1200 && wh[1] === 630, wh.join("x"));
    // tools/og.html を直したのに og.png を作り直していないと落とす（make-og.mjs が作ったときの og.html の指紋と比べる）
    const ogSum = createHash("sha256").update(readFileSync(path.join(root, "tools/og.html"))).digest("hex");
    const ogRec = existsSync(path.join(root, "tools/og.sha256")) ? readFileSync(path.join(root, "tools/og.sha256"), "utf8").trim() : "";
    check("og.png は今の tools/og.html から作ったもの（直したら node tools/make-og.mjs）", ogRec === ogSum, ogRec.slice(0, 12) + " / " + ogSum.slice(0, 12));
    await p.close();
  }

  // 5c. やり込み：上級・メダル・広告図鑑・記録
  {
    const p = await open({ unlock: false });
    const shape = await p.evaluate(() => {
      const names = Object.values(TYPES).map((t) => t.name);
      let bad = [];
      for (const a of ARTICLES) { const h = hardOf(a); MODE = { kind: "article", hard: true }; A = a;
        for (let r = 0; r < 500; r++) { R = Math.random; const o = pickOrder(h); if (o.length !== a.ads || new Set(o).size !== o.length || o.some((t) => TYPES[t].lv < 2) || o.filter((t) => TYPES[t].lv === 3).length < 2) { bad.push(a.id + ":" + o.join()); break; } } }
      MODE = { kind: "article" };
      return { names: names.length === 19 && new Set(names).size === 19 && names.every(Boolean), bad, gold: ARTICLES.every((a) => a.gold > 0 && a.goldH > a.gold) };
    });
    check("広告の19種類それぞれに、図鑑に出す名前がある（重ならない）", shape.names);
    check("上級の広告の組み合わせを記事ごとに500回作って、どれも同じ枚数・重なりなし・★2以上だけ・★3が2枚以上", shape.bad.length === 0, shape.bad.join(" / "));
    check("どの記事にも金メダルの目安タイムがあり、上級のほうが長い", shape.gold);
    const gapsH = [];
    for (let i = 0; i < 5; i++) for (let r = 0; r < 20; r++) gapsH.push(await p.evaluate((i) => { A = ARTICLES[i]; MODE = { kind: "article", hard: true }; build(); const p2 = document.querySelector("#p2"); if (p2) p2.hidden = false;
      const top = document.querySelector("#art").getBoundingClientRect().top; const ys = [...document.querySelectorAll(".gate")].map((x) => x.getBoundingClientRect().top - top); if (p2) p2.hidden = true; MODE = { kind: "article" };
      return { i, min: Math.min(...ys.map((y, k) => (k ? y - ys[k - 1] : y))), n: ys.length, want: hardOf(A).ads - (A.vignette ? 1 : 0) }; }, i));
    const tightH = gapsH.filter((g) => g.min < H * 0.75 || g.n !== g.want);
    check("上級でも、関所を20回置き直して広告の間はいつも0.75画面以上・数がそろう", tightH.length === 0, tightH.map((g) => `記事${g.i + 1}:${Math.round(g.min)}px n=${g.n}/${g.want}`).join(","));
    // まだどれも読み切っていないときは、鍵のかかった上級を並べず1行の案内だけ
    await p.evaluate(() => { localStorage.clear(); menu(); });
    check("まだ読み切った記事が無いとき、上級は1行の案内だけ（鍵のかかった6つを並べない）", (await p.isVisible("#hardNote")) && !(await p.isVisible('.lv[data-h="0"]')));
    await p.evaluate(() => { localStorage.setItem("xdoko-dex", JSON.stringify({ corner: { n: 1, clean: true } })); fail("検査"); showDex(); });
    check("感染の画面のあとに図鑑を開いても、感染の画面が残らない", await p.evaluate(() => document.querySelector("#virus").hidden) && (await p.isVisible(".dex")));
    // 解放：ふつうで読み切った記事だけ上級が開く
    await p.evaluate(() => { localStorage.clear(); localStorage.setItem("xdoko-best-recipe", "25.0"); menu(); });
    check("上級は、ふつうで読み切った記事だけ開く", !(await p.isDisabled('.lv[data-h="0"]')) && (await p.isDisabled('.lv[data-h="1"]')) && (await p.isDisabled('.lv[data-h="2"]')));
    // メダル
    const md = await p.evaluate(() => { const a = ARTICLES[0]; return [medal(a.gold, a, false), medal(a.gold * 1.4, a, false), medal(a.gold * 1.4 + 0.1, a, false), medal(a.goldH, a, true), medal(0, a, false), nextMedal(a.gold + 1, a, false), nextMedal(a.gold * 2, a, false)]; });
    check("メダル：金は目安以内・銀は1.4倍以内・それより遅ければ銅、上級は上級の目安で決まる", md.slice(0, 5).join() === "🥇,🥈,🥉,🥇,", md.join());
    const rd = await p.evaluate(() => { const real = performance.now; try { start(ARTICLES[0]); running = true; performance.now = () => 20040; t0 = 0; pen = 0; finish(); return { txt: document.querySelector("#stage .card").textContent, saved: localStorage.getItem("xdoko-best-recipe") }; } finally { performance.now = real; localStorage.setItem("xdoko-best-recipe", "25.0"); localStorage.removeItem("xdoko-stats"); menu(); } });
    check("結果のメダルは表示と同じ0.1秒の丸めで決まる（20.04秒→20.0秒で金、保存も20.0）", rd.txt.includes("🥇 金メダル") && rd.saved === "20.0", rd.saved);
    check("メダルの次の目標（金まで・銀まで あと何秒）が出る", md[5] === "金まで あと 1.0秒" && md[6].startsWith("銀まで あと"), md.slice(5).join(" / "));
    check("メニューの記事に、ベストのメダルが出る", (await p.textContent('.lv[data-i="0"]')).includes("🥈"), await p.textContent('.lv[data-i="0"]'));
    // 上級を通しで遊ぶ（いちばん難しい記事）：ヒントのボタンは出ない・記録は別に残る
    await p.evaluate(() => { ARTICLES.forEach((a) => localStorage.setItem("xdoko-best-" + a.id, "99.0")); menu(); });
    await p.click('.lv[data-h="2"]');
    const card = await p.textContent("#stage .card");
    check("上級の始めのカードに「上級」と広告の枚数・ヒントなしが出る", card.includes("記事3 上級") && card.includes("広告は7枚") && card.includes("ヒントは使えない"), card);
    await p.click("#go");
    let hintSeen = false, okH = true;
    try {
      for (let k = 0; k < 3000; k++) {
        if (await p.isVisible("#stage .card")) break;
        if (await p.isVisible("#virus")) throw new Error("上級でゲームオーバー");
        if (await adOpen(p)) { if (await p.isVisible("#hintBtn")) hintSeen = true; await solve(p); await p.waitForTimeout(60); continue; }
        const turn = await p.evaluate(() => { const nb = document.querySelector("#nextBtn"); return !!nb && !nb.hidden && document.querySelector("#stage").hidden && nb.getBoundingClientRect().top < innerHeight - 120; });
        if (turn) await p.evaluate(() => document.querySelector("#nextBtn").click());
        await scroll(p); await p.waitForTimeout(15);
      }
      if (!(await p.textContent("#stage")).includes("読み切った")) throw new Error("上級でゴールしない");
    } catch (e) { okH = false; }
    check("上級（記事3・広告7枚）を最後まで読める", okH);
    check("上級では、広告が出てもヒントのボタンが出ない", !hintSeen);
    const res = await p.evaluate(() => ({ txt: document.querySelector("#stage .card").textContent, h: localStorage.getItem("xdoko-best-news-h"), n: localStorage.getItem("xdoko-best-news") }));
    check("上級の結果にメダルが出て、記録はふつうと別に残る", /[🥇🥈🥉] (金|銀|銅)メダル/.test(res.txt) && Number(res.h) > 0 && res.n === "99.0", JSON.stringify({ h: res.h, n: res.n }));
    check("上級の共有の文と挑戦状のリンクに「上級」と &h=1 が入る", res.txt.includes("記事3 上級") && res.txt.includes("&h=1"), res.txt.slice(0, 120));
    // 図鑑と記録
    const dx = await p.evaluate(() => { const d = JSON.parse(localStorage.getItem("xdoko-dex") || "{}"), st = JSON.parse(localStorage.getItem("xdoko-stats") || "{}"); menu(); return { types: Object.keys(d).length, clean: Object.values(d).every((e) => e.clean && e.n >= 1), st, btn: document.querySelector("#dexBtn").textContent }; });
    check("閉じた広告が図鑑に入り（7種類）、ヒントなしの印が付く", dx.types === 7 && dx.clean, JSON.stringify(dx));
    check("記録：読み切った回数と閉じた広告の枚数が増える", dx.st.clear === 1 && dx.st.closed === 7, JSON.stringify(dx.st));
    check("メニューの図鑑のボタンに、見つけた数（7/19）が出る", dx.btn.includes("7/19"), dx.btn);
    await p.click("#dexBtn");
    const dt = await p.evaluate(() => { const known = Object.keys(JSON.parse(localStorage.getItem("xdoko-dex"))); return { txt: document.querySelector("#stage .card").textContent, names: known.map((k) => TYPES[k].name), unknown: [...document.querySelectorAll(".dex:not(.ach) .no")].length }; });
    check("図鑑の画面に、見つけた広告の名前と閉じ方が出て、まだの広告は「？？？」", dt.names.every((n) => dt.txt.includes(n)) && dt.unknown === 12 && dt.txt.includes("広告図鑑 7/19"), dt.unknown);
    check("図鑑の画面に記録（読み切った・閉じた広告・感染・連続・メダル）が出る", ["読み切った1回", "閉じた広告7枚", "感染した0回", "連続の最高", "メダル"].every((w) => dt.txt.includes(w)), dt.txt.slice(-80));
    await p.click("#dexBack");
    check("図鑑からメニューへ戻れる", !!(await p.$("#dailyBtn")));
    // 感染した回数と、上級の挑戦状のリンク
    await p.evaluate(() => { start(ARTICLES[0]); }); await p.click("#go");
    await p.evaluate(() => document.querySelector("#anchor").click()); await p.waitForTimeout(100);
    check("記録：感染した回数が増える", (await p.evaluate(() => JSON.parse(localStorage.getItem("xdoko-stats")).virus)) === 1);
    await p.goto(url + "?a=travel&t=40&s=99&h=1"); await p.waitForTimeout(200);
    check("上級の挑戦状のリンク（&h=1）を開くと、上級で始まる", (await p.textContent("#stage .card")).includes("記事2 上級") && (await p.evaluate(() => MODE.hard === true && MODE.seed === 99 && ORDER.length === 6 && ORDER.every((t) => TYPES[t].lv >= 2))));
    await p.close();
  }

  // 5d. ベストとの差（区間タイム）と、図鑑からの練習
  {
    const p = await open();
    const u = await p.evaluate(() => {
      A = ARTICLES[0]; MODE = { kind: "article", seed: 1 }; ORDER = ["corner", "label", "three", "rate"];
      localStorage.setItem("xdoko-split-recipe", JSON.stringify([10, 20, 30, 40]));
      const r = [splitTxt(0, 9.5), splitTxt(1, 20.3), splitTxt(2, 30)];
      localStorage.setItem("xdoko-split-recipe", JSON.stringify([1, 2])); r.push(splitTxt(0, 5));
      localStorage.setItem("xdoko-split-recipe", "こわれた"); r.push(splitTxt(0, 5));
      MODE = { kind: "daily", day: 1 }; r.push(spKey());
      localStorage.removeItem("xdoko-split-recipe"); MODE = { kind: "article" }; menu(); return r;
    });
    check("ベストとの差：速い・おそい・同じを0.1秒で言い分ける", u[0] === "ベストより 0.5秒 速い" && u[1] === "ベストより 0.3秒 おそい" && u[2] === "ベストと同じ", u.slice(0, 3).join(" / "));
    check("ベストとの差：覚えた数が広告の数と合わない・こわれているときは比べない、今日の1本は比べない", u[3] === "" && u[4] === "" && u[5] === "", JSON.stringify(u.slice(3)));
    await p.evaluate(() => { window.__T = []; const o = toast; toast = (t, ms) => { __T.push(t); o(t, ms); }; });
    await play(p, 0);
    const first = await p.evaluate(() => ({ t: __T.filter((x) => x.startsWith("閉じた")), sp: JSON.parse(localStorage.getItem("xdoko-split-recipe") || "null") }));
    check("1回目（区間の記録なし）は「閉じた」だけ、自己ベストで広告を閉じた時刻を覚える（4つ・増えていく）",
      first.t.length === 4 && first.t.every((x) => x === "閉じた") && Array.isArray(first.sp) && first.sp.length === 4 && first.sp.every((x, i) => i === 0 || x >= first.sp[i - 1]), JSON.stringify(first));
    await p.evaluate(() => { __T.length = 0; menu(); });
    await play(p, 0);
    const second = await p.evaluate(() => __T.filter((x) => x.startsWith("閉じた")));
    check("2回目は、広告を閉じるたびにベストとの差が出る", second.length === 4 && second.every((x) => /^閉じた　ベスト(より [0-9.]+秒 (速い|おそい)|と同じ)$/.test(x)), second.join(" / "));
    // 練習
    await p.evaluate(() => { localStorage.setItem("xdoko-dex", JSON.stringify({ corner: { n: 1, clean: true }, swipe: { n: 1, clean: false } })); localStorage.removeItem("xdoko-stats"); showDex(); });
    const prs = await p.evaluate(() => [...document.querySelectorAll(".dex .pr")].map((b) => [b.dataset.pr, b.offsetHeight]));
    check("図鑑の見つけた広告にだけ「練習」のボタンがある（高さ44px以上）", prs.length === 2 && prs.every(([, h]) => h >= 44), JSON.stringify(prs));
    await p.click('[data-pr="swipe"]');
    const po = await p.evaluate(() => ({ type: document.querySelector("#stage > :first-child")?.dataset.type, tag: document.querySelector("#stage .practice")?.textContent || "" }));
    check("練習を押すと、その広告が1枚だけ出る", po.type === "swipe" && po.tag.includes("練習：×の無い広告"), JSON.stringify(po));
    await solve(p); await p.waitForSelector("#prAgain");
    const pw = await p.evaluate(() => ({ txt: document.querySelector("#stage .card").textContent, st: localStorage.getItem("xdoko-stats"), d: JSON.parse(localStorage.getItem("xdoko-dex")).swipe.n }));
    check("練習で閉じると「閉じられた！」が出て、記録も図鑑の回数も増えない", pw.txt.includes("閉じられた！") && pw.st === null && pw.d === 1, JSON.stringify(pw));
    await p.click("#prAgain"); await p.click("#stage .big.fake");
    const pf = await p.evaluate(() => ({ v: document.querySelector("#virus").hidden, txt: document.querySelector("#stage .card")?.textContent || "", st: localStorage.getItem("xdoko-stats") }));
    check("練習でまちがえても感染の画面は出ず、閉じ方を見せる（感染の回数も増えない）", pf.v && pf.txt.includes("それは広告の一部でした") && pf.txt.includes("閉じ方：") && pf.st === null, JSON.stringify(pf));
    await p.click("#prBack");
    check("練習から図鑑へ戻れる", await p.isVisible(".dex"));
    await p.close();
  }

  // 5e. 感想を送るリンク：メニューと結果に出る。押したときに GitHub の感想フォームが開くだけ
  {
    const p = await open();
    const FB = "https://github.com/satou-aaaaa/batsu-doko/issues/new?template=feedback.yml";
    const look = (id) => p.evaluate((id) => { const a = document.getElementById(id); return a && { href: a.href, target: a.target, rel: a.rel, h: a.offsetHeight }; }, id);
    const m = await look("fbMenu");
    check("メニューに「感想を送る」があり、感想フォームを新しいタブで開く（高さ44px以上）", m && m.href === FB && m.target === "_blank" && m.rel.includes("noopener") && m.h >= 44, JSON.stringify(m));
    await play(p, 0);
    const r = await look("fbRes");
    check("結果の画面にも「感想を送る」がある", r && r.href === FB && r.target === "_blank" && r.h >= 44, JSON.stringify(r));
    const yml = readFileSync(path.join(root, ".github/ISSUE_TEMPLATE/feedback.yml"), "utf8");
    const ids = [...yml.matchAll(/^\s+id: (\S+)/gm)].map((x) => x[1]);
    check("感想フォームの項目は楽しさ・よかった所・直してほしい所だけ（名前・メールを聞かない）、ラベルは「感想」", ids.join() === "fun,good,fix" && /labels: \["感想"\]/.test(yml) && !/(email|メールアドレス|お名前)/i.test(yml.replace(/名前・メール[^\n]*/g, "")), ids.join());
    await p.close();
  }

  // 5f. Ko-fi の応援：自己ベストを出した結果の画面にだけ1行。遊ぶ前・途中・感染・ベストでない結果には出さない
  {
    const p = await open();
    const has = () => p.evaluate(() => !!document.getElementById("kofi"));
    const where = [];
    if (await has()) where.push("メニュー");
    await startArt(p, 0); if (await has()) where.push("遊ぶ前");
    await p.waitForTimeout(50); if (await has()) where.push("途中");
    await p.evaluate(() => document.querySelector("#anchor").click()); await p.waitForTimeout(100);
    if (await has()) where.push("感染");
    check("Ko-fi のひとことは、メニュー・遊ぶ前・途中・感染の画面に出ない", where.length === 0, where.join(","));
    await p.evaluate(() => menu());
    await play(p, 0);
    const k = await p.evaluate(() => { const e = document.getElementById("kofi"), a = e && e.querySelector("a"); return e && { n: document.querySelectorAll("#kofi").length, href: a.href, target: a.target, rel: a.rel, inAd: !!e.closest(".ad"), txt: e.textContent }; });
    check("自己ベストの結果の画面に Ko-fi のひとことが1行だけ、ただのリンクで出る（広告の枠に入れない）", k && k.n === 1 && k.href === "https://ko-fi.com/satouaaaaa" && k.target === "_blank" && k.rel.includes("noopener") && !k.inAd && k.txt.includes("任意・遊ぶのはずっと無料"), JSON.stringify(k));
    await p.evaluate(() => { localStorage.setItem("xdoko-best-recipe", "0.1"); menu(); });
    await play(p, 0);
    check("自己ベストでない結果の画面には Ko-fi のひとことを出さない（くり返し見る画面に出し続けない）", !(await has()));
    await p.close();
  }

  // 5g. ロング：3本つなぎ・広告12枚・先ほど難しい。3本とも読み切ると開く
  {
    const p = await open({ unlock: false });
    check("ロングは、記事1〜3を読み切るまで開かない", await p.isDisabled("#longBtn"));
    await p.evaluate(() => { ARTICLES.forEach((a) => localStorage.setItem("xdoko-best-" + a.id, "99.0")); menu(); });
    check("3本とも読み切るとロングが開く", !(await p.isDisabled("#longBtn")));
    const lo = await p.evaluate(() => { const bad = []; for (let r = 0; r < 500; r++) { R = Math.random; const o = pickOrder(LONG); const lv = o.map((t) => TYPES[t].lv).join("");
      if (o.length !== 12 || new Set(o).size !== 12 || lv !== "111122223333") { bad.push(o.join()); break; } } return bad; });
    check("ロングの広告の並びを500回作って、どれも12枚・重なりなし・★1→★2→★3を4枚ずつ", lo.length === 0, lo.join(" / "));
    const gl = [];
    for (let r = 0; r < 20; r++) gl.push(await p.evaluate(() => { A = LONG; MODE = { kind: "article" }; build();
      const top = document.querySelector("#art").getBoundingClientRect().top; const ys = [...document.querySelectorAll(".gate")].map((x) => x.getBoundingClientRect().top - top);
      return { min: Math.min(...ys.map((y, k) => (k ? y - ys[k - 1] : y))), n: ys.length }; }));
    const tl = gl.filter((g) => g.min < H * 0.75 || g.n !== 12);
    check("ロングの関所を20回置き直して、いつも12か所・広告の間は0.75画面以上", tl.length === 0, tl.map((g) => `${Math.round(g.min)}px n=${g.n}`).join(","));
    await p.evaluate(() => menu());
    await p.click("#longBtn");
    check("ロングの始めのカードに「ロング」と広告12枚が出る", (await p.textContent("#stage .card")).includes("ロング（3本つなぎ）") && (await p.textContent("#stage .card")).includes("広告は12枚"));
    await p.click("#go");
    let okL = true; try { await playOn(p, "ロング"); } catch (e) { okL = false; console.log(e.message); }
    check("ロング（広告12枚）を最後まで読める", okL);
    const lr = await p.evaluate(() => ({ n: localStorage.getItem("xdoko-long-n"), b: localStorage.getItem("xdoko-best-long"), next: !!document.querySelector("#nextArt"), txt: document.querySelector("#shareTxt")?.textContent || "" }));
    check("ロングを読み切ると、最高12枚とタイムが残り、「次の記事へ」は出ない・共有に「ロング」と a=long", lr.n === "12" && Number(lr.b) > 0 && !lr.next && lr.txt.includes("ロング「よみもの広場」") && lr.txt.includes("?a=long&"), JSON.stringify(lr));
    await p.evaluate(() => { localStorage.setItem("xdoko-long-n", "3"); start(LONG); }); await p.click("#go");
    for (let k = 0; k < 400 && !(await adOpen(p)); k++) { await scroll(p); await p.waitForTimeout(15); }
    await solve(p); await p.waitForTimeout(60);
    for (let k = 0; k < 400 && !(await adOpen(p)); k++) { await scroll(p); await p.waitForTimeout(15); }
    await p.evaluate(() => document.querySelector("#anchor").click()); await p.waitForTimeout(150);
    const lf = await p.evaluate(() => ({ how: document.querySelector("#vhow").textContent, n: localStorage.getItem("xdoko-long-n") }));
    check("ロングでまちがえると、何枚まで閉じたかとベストの枚数が出る（ベストは下がらない）", lf.how.includes("広告 1/12枚まで閉じた") && lf.how.includes("ベスト 3枚") && lf.n === "3", JSON.stringify(lf));
    await p.goto(url + "?a=long&t=120&s=77&h=1"); await p.waitForTimeout(200);
    check("ロングの挑戦状のリンクで、同じ並び（s）のロングが始まる（上級にはならない）", (await p.textContent("#stage .card")).includes("ロング") && (await p.evaluate(() => A === LONG && MODE.seed === 77 && !MODE.hard)));
    await p.close();
  }

  // 5h. 実績：記録から数える。新しく取れた実績は結果に出る。図鑑の画面に一覧（まだのものも条件を見せる）
  {
    const p = await open({ unlock: false });
    const a0 = await p.evaluate(() => ({ got: achGot(), n: ACH.length, ids: new Set(ACH.map((x) => x[0])).size }));
    check("実績は17個あり（名前が重ならない）、まだ遊んでいなければ1つも取れていない", a0.n === 17 && a0.ids === 17 && a0.got.length === 0, JSON.stringify(a0));
    await p.click('.lv[data-i="0"]'); await p.click("#go"); await playOn(p, "記事1");
    const r1 = await p.evaluate(() => document.querySelector("#achNew")?.textContent || "");
    check("はじめて読み切ると、結果に新しい実績（はじめて読み切った）が出る。はじめての1枚はヒントが自動で出るので「ヒントなし」は出ない", r1.includes("はじめて読み切った") && !r1.includes("ヒントなし"), r1);
    await p.click("#againRun"); await p.click("#go"); await playOn(p, "記事1");
    check("同じ実績は2回目には出ない", !(await p.evaluate(() => document.querySelector("#achNew")?.textContent || "").then((t) => t.includes("はじめて読み切った"))));
    const st = await p.evaluate(() => { localStorage.setItem("xdoko-streak", JSON.stringify({ last: 1, count: 7, max: 7 })); localStorage.setItem("xdoko-long-n", "12"); return achGot(); });
    check("7日連続・ロング完走などは、今の記録から数える", ["streak3", "streak7", "long6", "long12"].every((k) => st.includes(k)), st.join());
    await p.evaluate(() => menu());
    check("メニューの実績のボタンに、実績の数が出る", (await p.textContent("#achBtn")).includes("実績 " + st.length + "/17"), await p.textContent("#achBtn"));
    await p.click("#achBtn");
    const dv = await p.evaluate(() => ({ got: document.querySelectorAll(".ach > div:not(.no)").length, no: document.querySelectorAll(".ach > .no").length, txt: document.querySelector(".ach").textContent }));
    check("実績の画面に一覧があり、まだのものも条件が見える", dv.got === st.length && dv.no === 17 - st.length && dv.txt.includes("上級で金メダル"), JSON.stringify(dv).slice(0, 200));
    await p.goto(url + "?a=recipe&t=999&s=5"); await p.waitForTimeout(200); await p.click("#go"); await playOn(p, "挑戦状");
    check("挑戦状の相手に勝つと、実績「挑戦状に勝つ」が取れる", await p.evaluate(() => achGot().includes("rival")));
    await p.close();
  }

  // 5i. 日曜（#6・#13…）の今日の1本は「上級の日」
  {
    const p = await open();
    const hd = await p.evaluate(() => { const out = []; for (const d of [5, 6, 7, 13, 20]) { window.__XDOKO_DAY = d; menu(); document.querySelector("#dailyBtn").click();
      out.push({ d, hard: !!MODE.hard, card: document.querySelector("#stage .card").textContent.includes("上級の日"), lv2: ORDER.every((t) => TYPES[t].lv >= 2) }); }
      delete window.__XDOKO_DAY; menu(); return out; });
    const want = { 5: false, 6: true, 7: false, 13: true, 20: true };
    check("今日の1本は日曜（#6・#13・#20）だけ上級の日になり、難しい広告だけが出る", hd.every((x) => x.hard === want[x.d] && x.card === want[x.d] && (!want[x.d] || x.lv2)), JSON.stringify(hd));
    const sameH = await p.evaluate(() => { const o = []; for (let k = 0; k < 20; k++) { start(dailyArt(6), dailyMode(6)); o.push(ORDER.join()); } menu(); return new Set(o).size; });
    check("上級の日も、同じ日ならだれでも同じ並び", sameH === 1, sameH);
    await p.addInitScript(() => { window.__XDOKO_DAY = 10; });
    await p.goto(url + "?d=6&t=50"); await p.waitForTimeout(200);
    const h6 = await p.evaluate(() => ({ hard: !!MODE.hard, late: !!MODE.late, day: MODE.day }));
    check("上級の日の挑戦状のリンク（過去の日）を開くと、上級のまま「あとから」で始まる", h6.hard && h6.late && h6.day === 6, JSON.stringify(h6));
    await p.evaluate(() => { localStorage.setItem("xdoko-daily-6", "40.0"); }); await p.goto(url + "?d=6&t=50"); await p.waitForTimeout(200);
    check("その日をもう読み切っていれば、過去の日の挑戦状はあとからにしない（記録は今日の1本のほう）", await p.evaluate(() => MODE.day === 6 && !MODE.late));
    await p.close();
  }

  // 5j. 次の目標のボタン：つづき → 金 → 上級 → ロング の順に1つだけ
  {
    const p = await open({ unlock: false });
    const g = async (setup) => p.evaluate((setup) => { localStorage.clear(); for (const [k, v] of Object.entries(setup)) localStorage.setItem(k, v); menu(); const b = document.querySelector("#goalBtn"); return b ? { t: b.textContent, h: b.offsetHeight, sh: b.querySelector("span").offsetHeight } : null; }, setup);
    const all = (v) => ({ "xdoko-best-recipe": v, "xdoko-best-travel": v, "xdoko-best-news": v, "xdoko-best-review": v, "xdoko-best-money": v });
    const r0 = await g({}), r1 = await g({ "xdoko-best-recipe": "25.0" }), r2 = await g(all("99.0")), r3 = await g(all("10.0")),
      r4 = await g({ ...all("10.0"), "xdoko-best-recipe-h": "20.0", "xdoko-best-travel-h": "20.0", "xdoko-best-news-h": "20.0", "xdoko-best-review-h": "20.0", "xdoko-best-money-h": "20.0" });
    check("次の目標：ボタンの大きな文字はスマホ幅でも1行（変なところで折り返さない）", [r1, r2, r3, r4].every((x) => x && x.sh <= 26), JSON.stringify([r1, r2, r3, r4].map((x) => x?.sh)));
    check("次の目標：まだ1本も読み切っていなければ出ない", r0 === null, JSON.stringify(r0));
    check("次の目標：読み切っていない記事 → 金がまだの記事 → 上級 → ロング の順に出る（高さ44px以上）",
      r1?.t.includes("つづき：記事2") && r2?.t.includes("金をねらう：記事1") && r3?.t.includes("上級に挑む：記事1") && r4?.t.includes("ロングを読み切る") && [r1, r2, r3, r4].every((x) => x.h >= 44), JSON.stringify([r1, r2, r3, r4]));
    await g({ "xdoko-best-recipe": "25.0" }); await p.click("#goalBtn");
    check("次の目標のボタンを押すと、その記事がすぐ始まる", (await p.textContent("#stage .card")).includes("記事2"));
    await p.close();
  }

  // 5k. はじめての1枚はヒントを時間なしで先に見せる（2枚目からは出さない）
  {
    const p = await open({ unlock: false });
    await p.click('.lv[data-i="0"]'); await p.click("#go");
    for (let k = 0; k < 400 && !(await adOpen(p)); k++) { await scroll(p); await p.waitForTimeout(15); }
    const f1 = await p.evaluate(() => ({ shown: !document.querySelector("#hintTxt").hidden, txt: document.querySelector("#hintTxt").textContent, pen }));
    check("はじめての1枚は、ヒントが時間なし（+0秒）で先に出る", f1.shown && f1.txt.includes("はじめての1枚") && f1.pen === 0, JSON.stringify(f1));
    await solve(p); await p.waitForTimeout(60);
    for (let k = 0; k < 400 && !(await adOpen(p)); k++) { await scroll(p); await p.waitForTimeout(15); }
    check("2枚目からは、ヒントは押したときだけ出る", await p.evaluate(() => document.querySelector("#hintTxt").hidden));
    await p.close();
  }

  // 5l. 見切り：出てすぐ（待つ広告は閉じられるようになってから）閉じると ⚡見切り。ヒントを見た広告は数えない
  {
    const p = await open({ unlock: false });
    const q = await p.evaluate(() => {
      const lim = Object.keys(TYPES).map((k) => [k, quickLim(k), TYPES[k].lv]);
      // はじめての1枚はヒントが自動で出る＝ヒントを見た広告なので、見切りに数えない
      localStorage.clear(); start(ARTICLES[0]); running = true; t0 = performance.now() - 15000;
      ORDER[n] = "corner"; openAd(true); adT = performance.now() - 300; win(); const firstAuto = QK[0], autoHints = hints;
      localStorage.clear(); localStorage.setItem("xdoko-stats", JSON.stringify({ clear: 0, closed: 1, virus: 0 })); start(ARTICLES[0]); running = true; t0 = performance.now() - 15000;
      const close = (type, ago, hint) => { ORDER[n] = type; openAd(true); adT = performance.now() - ago * 1000; if (hint) { $("#hintBtn").click(); } win(); };
      close("corner", 1.0); const pop = document.querySelector("#pop").classList.contains("on") && document.querySelector("#pop").textContent;
      close("corner", 3.0); close("countdown", 7.5); close("corner", 0.5, true);
      const qk = QK.slice(); finish();
      const line = document.querySelector("#quickLine")?.textContent || "", all1 = localStorage.getItem("xdoko-quickall");
      start(ARTICLES[0]); running = true; t0 = performance.now() - 15000; for (let i = 0; i < 4; i++) close("corner", 0.4); finish();
      return { firstAuto, autoHints, lim, pop, qk, line, all1, all2: localStorage.getItem("xdoko-quickall"), line2: document.querySelector("#quickLine")?.textContent || "", got: achGot().includes("quickAll"), ach: document.querySelector("#achNew")?.textContent || "" };
    });
    check("見切りの目安は★1が2.5秒・★2が3秒・★3が3.5秒、待つ広告（待たされる×・動画）は待つ5秒を足す", q.lim.every(([k, v, lv]) => v === ({ 1: 2.5, 2: 3, 3: 3.5 })[lv] + (["countdown", "video"].includes(k) ? 5 : 0)), JSON.stringify(q.lim));
    check("すばやく閉じると ⚡見切り が一瞬出て、おそい・ヒントを見た広告は見切りにならない（待つ広告は出てからの時間を、待ちの5秒を足した目安と比べる）", q.pop === "⚡ 見切り" && q.qk.join() === "true,false,true,false", JSON.stringify({ pop: q.pop, qk: q.qk }));
    check("はじめての1枚（ヒントが自動で出る）は、すばやく閉じても見切りに数えない", q.firstAuto === false, String(q.firstAuto));
    check("はじめての1枚の自動のヒントもヒントの回数に数える（「ヒントなしで読み切る」の実績にしない）", q.autoHints === 1, String(q.autoHints));
    check("結果に「⚡ 見切り 2/4枚」が出て、全部でなければ実績の印は残さない", q.line.includes("⚡ 見切り 2/4枚") && !q.line.includes("全部") && q.all1 === null, JSON.stringify(q));
    check("全部見切ると「全部見切った！」と実績「ぜんぶ見切り」が取れ、結果に出る", q.line2.includes("4/4枚") && q.line2.includes("全部見切った") && q.all2 === "1" && q.got && q.ach.includes("ぜんぶ見切り"), JSON.stringify(q).slice(0, 300));
    await p.waitForTimeout(800);
    check("見切りの知らせは少しで消える（押す所をふさがない）", await p.evaluate(() => !document.querySelector("#pop").classList.contains("on") && getComputedStyle(document.querySelector("#pop")).pointerEvents === "none"));
    const pr = await p.evaluate(() => { localStorage.clear(); localStorage.setItem("xdoko-dex", JSON.stringify({ corner: { n: 1, clean: true } })); practice("corner"); adT = performance.now() - 1200; win(); const a = document.querySelector("#prTime")?.textContent || ""; practice("corner"); adT = performance.now() - 6000; win(); const b = document.querySelector("#prTime")?.textContent || ""; return { a, b, st: localStorage.getItem("xdoko-stats") }; });
    check("練習で閉じると、閉じるまでの秒数と見切りの目安が出る（記録は増えない）", pr.a.includes("閉じるまで 1.2秒") && pr.a.includes("見切り！") && pr.b.includes("見切りは 2.5秒 以内") && pr.st === null, JSON.stringify(pr));
    await p.close();
  }
  // 5l2. 0時をまたいで読み切った今日の1本は、その日に記録が無ければ「あとから」に入れる（★・連続に数えない）
  {
    const p = await open({ unlock: false });
    const r = await p.evaluate(() => {
      localStorage.clear(); localStorage.setItem("xdoko-stats", JSON.stringify({ clear: 0, closed: 1, virus: 0 }));
      const d = today(); window.__XDOKO_DAY = d; start(dailyArt(d), dailyMode(d)); running = true; t0 = performance.now() - 20000; window.__XDOKO_DAY = d + 1; finish(); delete window.__XDOKO_DAY; // 今日で始め、読み切る前に日付だけ進める
      return { late: localStorage.getItem("xdoko-late-" + d), daily: localStorage.getItem("xdoko-daily-" + d), streak: localStorage.getItem("xdoko-streak") };
    });
    check("0時をまたいで読み切った今日の1本は xdoko-late- に入り、xdoko-daily-・連続には入らない", !!r.late && r.daily === null && r.streak === null, JSON.stringify(r));
  }

  // 5l3. 7日より前の日の挑戦状（?d=）は遊べるが、今日の記録にも「あとから」にも入れない（2026-11-05 CodeRabbit）
  {
    const p = await open({ unlock: false });
    const r = await p.evaluate(() => {
      localStorage.clear(); localStorage.setItem("xdoko-stats", JSON.stringify({ clear: 0, closed: 1, virus: 0 }));
      const T = 30; window.__XDOKO_DAY = T; const d = T - 8, k = T - 7; history.replaceState(null, "", location.pathname + "?d=" + d + "&t=50");
      localStorage.setItem("xdoko-dex", JSON.stringify({ corner: { n: 1, clean: true } }));
      fromLink(); const m1 = { late: MODE.late, old: MODE.old, card: document.querySelector("#stage .card").textContent };
      running = true; t0 = performance.now() - 20000; const all = ORDER.length; for (let i = 0; i < all; i++) { ORDER[n] = "corner"; openAd(true); adT = performance.now() - 400; win(); } // 全部すばやく閉じて（全部見切り・ヒントなし・相手に勝つ）から読み切る
      const qk = QK.filter(Boolean).length === all; finish(); const out = document.querySelector("#stage .card").textContent; const st1 = JSON.parse(localStorage.getItem("xdoko-stats")); const ach1 = { qk, nohint: localStorage.getItem("xdoko-nohint"), quick: localStorage.getItem("xdoko-quickall"), won: localStorage.getItem("xdoko-won"), clear: st1.clear, closed: st1.closed, dex: JSON.parse(localStorage.getItem("xdoko-dex")).corner.n };
      // 8日前の挑戦状で押してはいけない所を押しても、感染の数を増やさない
      const v0 = JSON.parse(localStorage.getItem("xdoko-stats")).virus; history.replaceState(null, "", location.pathname + "?d=" + d + "&t=50"); fromLink(); const mOld = MODE.old; running = true; try { fail("qa"); } catch (e) {} // 感染の画面はこの検査のページに無い部品もあるので、数だけ見る
      ach1.virusOld = mOld && JSON.parse(localStorage.getItem("xdoko-stats")).virus === v0;
      history.replaceState(null, "", location.pathname + "?d=" + k + "&t=50"); fromLink(); const m2 = { late: MODE.late, old: MODE.old };
      const keys = Object.keys(localStorage).filter((x) => /^xdoko-(late|daily)-/.test(x));
      // 7日前に始め、読み切る前に日付が進んで8日前になった：あとからにも入れない
      window.__XDOKO_DAY = T; history.replaceState(null, "", location.pathname + "?d=" + k); fromLink(); const m3 = MODE.late; window.__XDOKO_DAY = T + 1; running = true; t0 = performance.now() - 20000; finish(); const k3 = localStorage.getItem("xdoko-late-" + k);
      // 8日前で記録がある日も上書きしない
      localStorage.setItem("xdoko-daily-" + d, "99.0"); window.__XDOKO_DAY = T; history.replaceState(null, "", location.pathname + "?d=" + d); fromLink(); const m4 = MODE.old; running = true; t0 = performance.now() - 20000; finish(); const k4 = localStorage.getItem("xdoko-daily-" + d);
      // 記録がある過去の日（7日以内）の結果に「今日の1本」と連続を出さない
      localStorage.setItem("xdoko-daily-" + (T - 2), "99.0"); localStorage.setItem("xdoko-streak", JSON.stringify({ count: 5, last: T, max: 5 })); history.replaceState(null, "", location.pathname + "?d=" + (T - 2)); fromLink(); running = true; t0 = performance.now() - 20000; finish(); const sh = document.querySelector("#shareTxt").textContent;
      delete window.__XDOKO_DAY;
      return { m1, m2, keys, ach1, out: out.includes("記録には残りません"), m3, k3, m4, k4, sh: !sh.includes("今日の1本") && !sh.includes("連続") };
    });
    check("8日前の挑戦状は遊べるが記録に残さず、7日前まではあとから", r.m1.old && !r.m1.late && r.m1.card.includes("記録に残りません") && r.out && r.keys.length === 0 && r.m2.late && !r.m2.old, JSON.stringify(r));
    check("7日前に始めて8日前になってから読み切っても「あとから」に入れず、8日前の記録も上書きしない（2026-11-05 CodeRabbit）", r.m3 === true && r.k3 === null && r.m4 === true && r.k4 === "99.0", JSON.stringify(r));
    check("記録がある過去の日の挑戦状の結果に「今日の1本」と連続を出さない（2026-11-05 CodeRabbit）", r.sh, JSON.stringify(r));
    check("8日前の挑戦状は全部見切って相手に勝っても、実績（ヒントなし・ぜんぶ見切り・挑戦状に勝つ）・図鑑・閉じた数・読み切った数・感染の数を増やさない（2026-11-05 CodeRabbit）", r.ach1.qk && r.ach1.nohint === null && r.ach1.quick === null && r.ach1.won === null && r.ach1.clear === 0 && r.ach1.closed === 1 && r.ach1.dex === 1 && r.ach1.virusOld === true, JSON.stringify(r.ach1));
    await p.close();
  }

  // 5m. 実績の画面：まだのものは「いま/目標」と進み具合のバー。合計の日数（あとからも数える）
  {
    const p = await open({ unlock: false });
    const a = await p.evaluate(() => {
      localStorage.clear(); window.__XDOKO_DAY = 20;
      [3, 5, 9].forEach((d) => localStorage.setItem("xdoko-daily-" + d, "30.0")); localStorage.setItem("xdoko-late-15", "40.0");
      localStorage.setItem("xdoko-stats", JSON.stringify({ clear: 4, closed: 40, virus: 0 }));
      const n4 = playedDays(), g4 = achGot().includes("days7");
      [11, 12, 13].forEach((d) => localStorage.setItem("xdoko-late-" + d, "40.0"));
      const n7 = playedDays(), g7 = achGot().includes("days7");
      [11, 12, 13].forEach((d) => localStorage.removeItem("xdoko-late-" + d)); menu(); document.querySelector("#achBtn").click();
      const row = (id) => document.querySelector(`[data-ach="${id}"]`);
      return { n4, g4, n7, g7, days: row("days7").textContent, closed: row("closed100").textContent, bar: row("closed100").querySelector(".bar u").style.width, first: row("first").textContent, firstNo: row("first").classList.contains("no") };
    });
    check("読み切った日の合計は、今日の1本とあとからの両方を数え、7日で実績「7日読んだ」", a.n4 === 4 && !a.g4 && a.n7 === 7 && a.g7, JSON.stringify(a));
    check("まだの実績は「いま/目標」とバーで進み具合が出る（4/7・40/100）、取れた実績には ✓", a.days.includes("4/7") && a.closed.includes("40/100") && a.bar === "40%" && !a.firstNo && a.first.includes("✓"), JSON.stringify(a));
    await p.click("#achBack"); check("実績の画面からメニューへ戻れる", !!(await p.$("#dailyBtn")));
    await p.close();
  }

  // 5n. カレンダーと、取りこぼした日をあとから遊ぶ
  // 日をずらす数は環境変数で変えられる（QA_CAL_TODAY=今日の番号・QA_LATE_BACK=何日前を遊ぶか）。月をまたぐ組（#30＝12月2日から4日前）も毎回通す
  {
    const CAL_T = Number(process.env.QA_CAL_TODAY || 20), LATE_BACK = Number(process.env.QA_LATE_BACK || 3);
    const p = await open({ unlock: false });
    // 何百日ぶんも：取りこぼした日の一覧は、過去7日・#1以降・まだ読んでいない日だけ
    const ld = await p.evaluate(() => {
      const bad = []; localStorage.clear();
      for (let d = 1; d <= 400; d++) { if (d % 3 === 0) localStorage.setItem("xdoko-daily-" + d, "30.0"); if (d % 5 === 0) localStorage.setItem("xdoko-late-" + d, "30.0"); }
      for (let t = 1; t <= 400; t++) {
        const got = lateDays(t), want = []; for (let d = t - 1; d >= Math.max(1, t - 7); d--) if (d % 3 && d % 5) want.push(d);
        if (got.join() !== want.join()) bad.push(t);
      }
      localStorage.clear(); return bad;
    });
    check("取りこぼした日の一覧を400日ぶん作って、どれも過去7日・#1以降・まだ読んでいない日だけ", ld.length === 0, ld.slice(0, 5).join(","));
    // あとからの問題は、その日の今日の1本と同じ（300日ぶん）
    const same = await p.evaluate(() => {
      const bad = [];
      for (let d = 1; d <= 300; d++) {
        start(dailyArt(d), dailyMode(d)); const a = [ORDER.join(), $("#art").innerHTML, MODE.hard];
        start(dailyArt(d), { ...dailyMode(d), late: true }); const b = [ORDER.join(), $("#art").innerHTML, MODE.hard];
        if (a.join("|") !== b.join("|")) bad.push(d);
      }
      menu(); return bad;
    });
    check("あとから遊ぶ1本は、300日ぶんどれもその日の今日の1本と同じ広告の並び・置き場所・上級の日", same.length === 0, same.slice(0, 5).join(","));
    // 結果：今日の記録・連続・Ko-fi に数えない。記録は xdoko-late-<日> に分けて残る
    const lr = await p.evaluate(() => {
      localStorage.clear(); window.__XDOKO_DAY = 20; const sk = JSON.stringify({ last: 19, count: 2, max: 2 }); localStorage.setItem("xdoko-streak", sk);
      start(dailyArt(15), { ...dailyMode(15), late: true }); const card = document.querySelector("#stage .card").textContent;
      running = true; t0 = performance.now() - 30000; finish();
      const r = { card, daily: localStorage.getItem("xdoko-daily-15"), late: localStorage.getItem("xdoko-late-15"), sk: localStorage.getItem("xdoko-streak") === sk, kofi: !!document.querySelector("#kofi"), txt: document.querySelector("#shareTxt").textContent, res: document.querySelector("#stage .card").textContent };
      menu(); r.menu = document.querySelector("#dailyBtn").textContent; return r;
    });
    check("あとからの始めのカードに「あとから」と日付・連続に数えないことが出る", lr.card.includes("11月17日の1本（あとから）") && lr.card.includes("#15") && lr.card.includes("連続には数えません"), lr.card);
    check("あとから読み切っても、今日の記録・連続は増えず、記録は別（xdoko-late）に残る", lr.daily === null && Number(lr.late) > 0 && lr.sk, JSON.stringify(lr).slice(0, 200));
    check("あとからの結果に Ko-fi のひとこと・連続は出ず、共有の文は「（あとから）」で連続を入れない", !lr.kofi && lr.txt.includes("（あとから）") && !lr.txt.includes("連続") && !lr.res.includes("連続"), lr.txt);
    check("あとから読んでも、メニューの今日の1本は遊ぶ前のまま", lr.menu.includes("遊ぶ") && lr.menu.includes("🔥2日連続"), lr.menu);
    // カレンダー：印・前の月・連続の言葉（1以上だけ）・責める言葉を書かない
    const cal = async (setup) => p.evaluate((setup) => { localStorage.clear(); window.__XDOKO_DAY = setup.t; for (const [k, v] of Object.entries(setup.ls || {})) localStorage.setItem(k, v); menu(); document.querySelector("#calBtn").click(); return document.querySelector("#stage .card").textContent; }, setup);
    const openTo = async (d) => { for (let k = 0; k < 24 && !(await p.$(`.cal [data-d="${d}"]`)); k++) { if (await p.isDisabled("#calPrev")) break; await p.click("#calPrev"); } return p.$(`.cal [data-d="${d}"]`); };
    const t1 = await cal({ t: 20, ls: { "xdoko-daily-18": "30.0", "xdoko-daily-10": "30.0", "xdoko-late-15": "40.0", "xdoko-streak": JSON.stringify({ last: 18, count: 1, max: 1 }) } });
    const marks = await p.evaluate(() => { const c = (d) => document.querySelector(`.cal [data-d="${d}"]`); return { pl: c(18).className, pl2: c(10).className, late: c(15).className, miss: [...document.querySelectorAll(".cal .miss")].map((b) => +b.dataset.d).sort((a, b) => a - b).join(), td: document.querySelector(".cal .td")?.textContent, month: document.querySelector("#calMonth").textContent, menuSmall: "" }; });
    check("カレンダー：今日の1本の日は ★（濃い色）、あとからの日は ↺（薄い色）、今日に枠", marks.pl.includes("pl") && marks.pl2.includes("pl") && marks.late.includes("late") && marks.month === "2026年11月" && marks.td?.startsWith("22"), JSON.stringify(marks));
    check("カレンダー：過去7日のまだの日だけ押せる（#13・14・16・17・19）", marks.miss === "13,14,16,17,19", marks.miss);
    check("カレンダー：連続は1以上のときだけ出し、0のときは出さない・休んだ日を責める言葉は書かない", !t1.includes("連続") && t1.includes("合わせて 3日") && !/(休|サボ|途切|さぼ|残念|忘れ)/.test(t1), t1);
    const t2 = await cal({ t: 20, ls: { "xdoko-daily-19": "30.0", "xdoko-streak": JSON.stringify({ last: 19, count: 1, max: 1 }) } });
    check("カレンダー：連続が1日でも小さく出る", t2.includes("🔥 1日連続"), t2.slice(-80));
    const mb = await p.evaluate(() => { window.__XDOKO_DAY = 20; localStorage.clear(); menu(); return document.querySelector("#calBtn").textContent; });
    check("メニューのカレンダーのボタンに、あとから読める日数が出る", mb.includes("あとから 7日"), mb);
    // 月をまたぐ：12月から前の月へ戻って押す。#1 の月より前には戻れない
    for (const [T, back] of [[CAL_T, LATE_BACK], [30, 4]]) {
      await cal({ t: T, ls: {} });
      const d = T - back, cell = await openTo(d);
      const ok = !!cell && (await cell.evaluate((e) => e.matches("button.miss")));
      if (ok) await cell.click();
      const card = ok ? await p.textContent("#stage .card") : "";
      const m = await p.evaluate(() => ({ late: !!MODE.late, day: MODE.day }));
      check(`カレンダーの日（今日 #${T} の ${back}日前）を、その月まで戻って押すと、あとから始まる`, ok && card.includes("あとから") && m.late && m.day === d, JSON.stringify({ ok, m, card: card.slice(0, 40) }));
    }
    await cal({ t: 30, ls: {} });
    const nav = await p.evaluate(() => { const a = [document.querySelector("#calMonth").textContent, document.querySelector("#calPrev").disabled, document.querySelector("#calNext").disabled]; document.querySelector("#calPrev").click(); return a.concat([document.querySelector("#calMonth").textContent, document.querySelector("#calPrev").disabled, document.querySelector("#calNext").disabled]); });
    check("カレンダー：前の月へ戻れて、#1（2026年11月）より前・今月より先へは行けない", nav.join() === "2026年12月,false,true,2026年11月,true,false", nav.join());
    // 古いタブ：もう読み切った日を押しても始めない
    const stale = await p.evaluate(() => { localStorage.clear(); window.__XDOKO_DAY = 20; menu(); document.querySelector("#calBtn").click(); localStorage.setItem("xdoko-daily-17", "30.0"); document.querySelector('.cal [data-d="17"]').click(); return { cal: !!document.querySelector("#cal"), late: !!MODE.late, say: document.querySelector("#say").textContent }; });
    check("古いタブで、もう読み切った日を押しても始めず、知らせてカレンダーに戻る", stale.cal && !stale.late && stale.say.includes("もう読み切って"), JSON.stringify(stale));
    // スマホ幅 320px：実績・カレンダーが横にはみ出さない・押せる所は44px以上・キーで選ぶと枠が見える
    await p.setViewportSize({ width: 320, height: 640 });
    const fit = [];
    for (const scr of ["showAch()", "showCal()", "menu()"]) {
      await p.evaluate((scr) => { window.__XDOKO_DAY = 20; localStorage.clear(); localStorage.setItem("xdoko-daily-18", "30.0"); eval(scr); }, scr);
      await p.waitForTimeout(400); // 出てくるときの動き（少し小さく出る）が終わってから測る
      const r = await p.evaluate(() => {
        const card = document.querySelector("#stage .card").getBoundingClientRect(), btns = [...document.querySelectorAll("#stage button")].filter((b) => b.offsetParent).map((b) => [b.id || b.className, Math.round(b.getBoundingClientRect().height)]);
        return { sw: document.documentElement.scrollWidth, sw2: document.querySelector("#stage").scrollWidth, right: card.right, small: btns.filter(([, h]) => h < 44) }; });
      fit.push([scr, r]);
    }
    check("幅320pxで、実績・カレンダー・メニューが横にはみ出さず、押せる所は高さ44px以上", fit.every(([, r]) => r.sw <= 320 && r.sw2 <= 320 && r.right <= 320 && r.small.length === 0), JSON.stringify(fit));
    await p.evaluate(() => showCal()); await p.keyboard.press("Tab");
    const fv = await p.evaluate(() => [...document.querySelectorAll("#stage button:not([disabled]), #stage a")].map((b) => { b.focus(); const cs = getComputedStyle(b); return [b.id || b.className, b.matches(":focus-visible"), parseFloat(cs.outlineWidth), cs.outlineStyle]; }));
    check("カレンダーの押せる所は、キーで選ぶと2px以上の枠が見える", fv.length > 0 && fv.every(([, v, w, s]) => v && w >= 2 && s !== "none"), JSON.stringify(fv));
    await p.evaluate(() => { delete window.__XDOKO_DAY; });
    await p.close();
  }

  // 6. スマホ幅で横にはみ出さない・音を切れる
  {
    const p = await open(); let sw = await p.evaluate(() => document.documentElement.scrollWidth);
    for (const i of [0, 1, 2, 3, 4]) { await startArt(p, i); sw = Math.max(sw, await p.evaluate(() => document.documentElement.scrollWidth)); await p.evaluate(() => menu()); }
    check("スマホ幅（390px）で横にはみ出さない", sw <= W, sw);
    await p.click("#menuSound"); check("記事を選ぶ画面の音ボタンで切り替わり、覚えている", (await p.evaluate(() => localStorage.getItem("xdoko-sound"))) === "off");
    await p.close();
  }

  // 7. 外へ通信しない（Google Fonts の文字だけ）・PWA で電波が無くても開ける
  {
    let fail5xx = false, served5xx = 0;
    const server = http.createServer((req, res) => {
      if (fail5xx) { served5xx++; res.writeHead(503); return res.end(); }
      const f = path.join(root, decodeURIComponent(req.url.split("?")[0]).replace(/\/$/, "/index.html"));
      if (!f.startsWith(root) || !existsSync(f)) { res.writeHead(404); return res.end(); }
      const type = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".webmanifest": "application/manifest+json" }[path.extname(f)] || "application/octet-stream";
      res.writeHead(200, { "content-type": type }); res.end(readFileSync(f));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${server.address().port}/`;
    const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    ctx.on("request", recordOutside); // context で聞くと、sw.js が出す通信も入る
    try {
      const p = await ctx.newPage();
      await p.goto(base); await p.evaluate(() => navigator.serviceWorker.ready); await p.reload(); await p.waitForTimeout(500);
      check("外へ通信しない（遊んでいるあいだも、文字の Google Fonts だけ）", outsideAll.length === 0, outsideAll.slice(0, 3).join(" "));
      fail5xx = true; await p.reload(); await p.waitForTimeout(300);
      check("サーバーが 5xx を返しても保存した画面が出る（PWA）", served5xx > 0 && await p.isVisible(".lv"), "503 を返した回数 " + served5xx);
      fail5xx = false;
      await ctx.setOffline(true); await p.reload();
      check("一度開けば電波が無くても開ける（PWA）", await p.isVisible(".lv"));
      const shell = readFileSync(path.join(root, "sw.js"), "utf8");
      const files = ["index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png"];
      check("sw.js の SHELL に画面のファイルがそろう", files.every((f) => shell.includes("./" + f) && existsSync(path.join(root, f))));
    } finally { await ctx.close(); server.close(); }
  }

  check("ページのエラーが出ない", errors.length === 0, [...new Set(errors)].join(" / "));
} catch (e) {
  check("検査が最後まで動く", false, e.stack || e.message);
} finally { await browser?.close(); }
if (!results.length) check("検査が1つも動いた", false);

const ng = results.filter((r) => !r.ok);
const md = [`# ×はどこだ 検査の結果`, ``, ng.length ? `**${ng.length} 件の失敗**` : `すべて合格（${results.length} 件）`, ``,
  ...results.map((r) => `- ${r.ok ? "✅" : "❌"} ${r.name}${r.ok || !r.detail ? "" : "：" + r.detail.replace(/\n/g, " ")}`)].join("\n");
mkdirSync(path.join(root, "qa-report"), { recursive: true });
writeFileSync(path.join(root, "qa-report", "report.md"), md + "\n");
console.log(ng.length ? `NG ${ng.length}件` : `OK ${results.length}件`);
process.exit(ng.length ? 1 : 0);
