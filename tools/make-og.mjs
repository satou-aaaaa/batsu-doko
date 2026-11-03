// OGP 画像を作り直す：node tools/make-og.mjs（qa の Playwright を使う）
import { chromium } from "../qa/node_modules/playwright/index.mjs";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exe = process.env.CHROMIUM_PATH || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : "");
const b = await chromium.launch(exe ? { executablePath: exe } : {});
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.goto(pathToFileURL(path.join(root, "tools/og.html")).href);
// 文字（Google Fonts）が読めないまま写すと、ちがう字体の画像になる。読めなければ止める
const fonts = ['700 40px "Dela Gothic One"', '700 40px "M PLUS Rounded 1c"', '800 40px "M PLUS Rounded 1c"'];
const bad = await p.evaluate(async (fs) => { const out = []; for (const f of fs) { try { if (!(await document.fonts.load(f, "×はどこだ")).length) out.push(f); } catch (e) { out.push(f); } } await document.fonts.ready; return out; }, fonts);
if (bad.length) { await b.close(); throw new Error("文字が読み込めない：" + bad.join(", ")); }
await p.waitForTimeout(300);
await p.screenshot({ path: path.join(root, "og.png") }); await b.close();
// どの og.html から作ったかを残す（qa が見て、作り直し忘れを落とす）
writeFileSync(path.join(root, "tools/og.sha256"), createHash("sha256").update(readFileSync(path.join(root, "tools/og.html"))).digest("hex") + "\n");
console.log("og.png を作った");
