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
    check("記事が3本（レシピ→旅行→ニュース）", d.arts.map((a) => a.id).join() === "recipe,travel,news");
    check("先の記事ほど広告が多い", d.arts.every((a, i) => i === 0 || a.ads > d.arts[i - 1].ads), d.arts.map((a) => a.ads));
    check("広告の種類が16あり、どれにもヒントがある", d.types.length === 16 && d.types.every((t) => t.hint), d.types.length);
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
    for (let i = 0; i < 3; i++) for (let r = 0; r < 20; r++) {
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
  for (let i = 0; i < 3; i++) {
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
    check("広告の全16種類を、正しい手順で閉じられる", fails.length === 0, fails.join(","));
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
    const total = await p.evaluate(() => { localStorage.setItem("xdoko-best-recipe", "12.3"); localStorage.setItem("xdoko-best-travel", "20.0"); localStorage.setItem("xdoko-best-news", "30.4"); menu(); return document.querySelector("#stage .card").textContent; });
    check("3本読み切ると合計ベストが出る（12.3+20.0+30.4=62.7秒）", total.includes("合計ベスト 62.7秒"), total);
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
      const rot = [1, 2, 3, 4].map((d) => dailyArt(d).id).join();
      menu(); return { same, diff, bad, rot };
    });
    check("今日の1本は、同じ日なら100回作っても同じ広告の並び・置き場所", det.same);
    check("今日の1本は、日がちがえば並びが変わる（30日で25通り以上）", det.diff >= 25, det.diff);
    check("今日の1本を300日ぶん作っても、どの日も枚数・重なりなし・難しさが正しい", det.bad.length === 0, det.bad.slice(0, 5));
    check("今日の1本の記事は日ごとに 1→2→3→1 と回る", det.rot === "recipe,travel,news,recipe", det.rot);
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
    await p.goto(url + "?d=1&t=12.3"); await p.waitForTimeout(200);
    const card = await p.textContent("#stage .card"), search = await p.evaluate(() => location.search);
    check("挑戦状のリンク（?d=1&t=12.3）で開くと、相手のタイムつきで今日の1本 #1 が始められる", card.includes("今日の1本 #1") && card.includes("12.3秒") && (await p.isVisible("#go")), card);
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
      const ok = q === "?d=1&t=-5" ? txt.includes("今日の1本 #1") && !txt.includes("挑戦状") : !!(await p.$("#dailyBtn"));
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
      return { names: names.length === 16 && new Set(names).size === 16 && names.every(Boolean), bad, gold: ARTICLES.every((a) => a.gold > 0 && a.goldH > a.gold) };
    });
    check("広告の16種類それぞれに、図鑑に出す名前がある（重ならない）", shape.names);
    check("上級の広告の組み合わせを記事ごとに500回作って、どれも同じ枚数・重なりなし・★2以上だけ・★3が2枚以上", shape.bad.length === 0, shape.bad.join(" / "));
    check("どの記事にも金メダルの目安タイムがあり、上級のほうが長い", shape.gold);
    const gapsH = [];
    for (let i = 0; i < 3; i++) for (let r = 0; r < 20; r++) gapsH.push(await p.evaluate((i) => { A = ARTICLES[i]; MODE = { kind: "article", hard: true }; build(); const p2 = document.querySelector("#p2"); if (p2) p2.hidden = false;
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
    check("メニューの図鑑のボタンに、見つけた数（7/16）が出る", dx.btn.includes("7/16"), dx.btn);
    await p.click("#dexBtn");
    const dt = await p.evaluate(() => { const known = Object.keys(JSON.parse(localStorage.getItem("xdoko-dex"))); return { txt: document.querySelector("#stage .card").textContent, names: known.map((k) => TYPES[k].name), unknown: [...document.querySelectorAll(".dex .no")].length }; });
    check("図鑑の画面に、見つけた広告の名前と閉じ方が出て、まだの広告は「？？？」", dt.names.every((n) => dt.txt.includes(n)) && dt.unknown === 9 && dt.txt.includes("広告図鑑 7/16"), dt.unknown);
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

  // 6. スマホ幅で横にはみ出さない・音を切れる
  {
    const p = await open(); let sw = await p.evaluate(() => document.documentElement.scrollWidth);
    for (const i of [0, 1, 2]) { await startArt(p, i); sw = Math.max(sw, await p.evaluate(() => document.documentElement.scrollWidth)); await p.evaluate(() => menu()); }
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
