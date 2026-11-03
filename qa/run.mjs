// ×はどこだ の検査。index.html をブラウザで開き、自動で遊んで確かめる（Claude は使わない）。
// 使い方: node qa/run.mjs [通しで遊ぶ回数（既定 3）]   失敗があれば終了コード 1。結果は qa-report/report.md。
// 乱数で組む部分（広告の組み合わせ・関所の位置）は、遊ぶのとは別に何百回も作って毎回の結果を確かめる。
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = "file://" + path.join(root, "index.html");
const RUNS = Number(process.argv[2] || 3);
const W = 390, H = 780;
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail: String(detail) }); console.log(ok ? "✓" : "✗", name, ok ? "" : detail); };

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
async function open({ unlock = true } = {}) {
  const p = await browser.newPage({ viewport: { width: W, height: H } });
  p.on("pageerror", (e) => errors.push(e.message));
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
async function play(p, i) {
  const seen = []; await startArt(p, i);
  for (let k = 0; k < 3000; k++) {
    if (await p.isVisible("#stage .card")) break;
    if (await p.isVisible("#virus")) throw new Error(`記事${i + 1} 途中でゲームオーバー（${seen.join(",")}）`);
    if (await adOpen(p)) { seen.push(await solve(p)); await p.waitForTimeout(60); continue; }
    const turn = await p.evaluate(() => { const nb = document.querySelector("#nextBtn"); return !!nb && !nb.hidden && document.querySelector("#stage").hidden && nb.getBoundingClientRect().top < innerHeight - 120; });
    if (turn) await p.evaluate(() => document.querySelector("#nextBtn").click());
    await scroll(p); await p.waitForTimeout(15);
  }
  if (!(await p.textContent("#stage")).includes("読み切った")) throw new Error(`記事${i + 1} ゴールしない`);
  return seen;
}

try {
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
    check(`記事${i + 1} を ${RUNS} 回とも最後まで読めた`, okRuns === RUNS, detail);
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
    await play(p, 0); await p.click("#toMenu");
    check("記事1を読み切ると記事2が開き、ベストが残る", !(await p.isDisabled('.lv[data-i="1"]')) && /秒/.test(await p.textContent('.lv[data-i="0"] .bt')));
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
    const server = http.createServer((req, res) => {
      const f = path.join(root, decodeURIComponent(req.url.split("?")[0]).replace(/\/$/, "/index.html"));
      if (!f.startsWith(root) || !existsSync(f)) { res.writeHead(404); return res.end(); }
      const type = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".webmanifest": "application/manifest+json" }[path.extname(f)] || "application/octet-stream";
      res.writeHead(200, { "content-type": type }); res.end(readFileSync(f));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${server.address().port}/`;
    const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    try {
      const p = await ctx.newPage(); const outside = [];
      p.on("request", (r) => { const h = new URL(r.url()).hostname; if (!["127.0.0.1", "fonts.googleapis.com", "fonts.gstatic.com"].includes(h)) outside.push(r.url()); });
      await p.goto(base); await p.evaluate(() => navigator.serviceWorker.ready); await p.reload(); await p.waitForTimeout(500);
      check("外へ通信しない（文字の Google Fonts だけ）", outside.length === 0, outside.slice(0, 3).join(" "));
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
} finally { await browser.close(); }

const ng = results.filter((r) => !r.ok);
const md = [`# ×はどこだ 検査の結果`, ``, ng.length ? `**${ng.length} 件の失敗**` : `すべて合格（${results.length} 件）`, ``,
  ...results.map((r) => `- ${r.ok ? "✅" : "❌"} ${r.name}${r.ok || !r.detail ? "" : "：" + r.detail.replace(/\n/g, " ")}`)].join("\n");
mkdirSync(path.join(root, "qa-report"), { recursive: true });
writeFileSync(path.join(root, "qa-report", "report.md"), md + "\n");
console.log(ng.length ? `NG ${ng.length}件` : `OK ${results.length}件`);
process.exit(ng.length ? 1 : 0);
