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
const ogFile = path.join(root, "tools/og.html"), sum = () => createHash("sha256").update(readFileSync(ogFile)).digest("hex");
const before = sum();
await p.goto(pathToFileURL(ogFile).href);
// 文字（Google Fonts）が読めないまま写すと、ちがう字体の画像になる。読めなければ止める
const fonts = ['700 40px "Dela Gothic One"', '700 40px "M PLUS Rounded 1c"', '800 40px "M PLUS Rounded 1c"'];
const bad = await p.evaluate(async (fs) => { const out = []; for (const f of fs) { try { if (!(await document.fonts.load(f, document.body.textContent)).length) out.push(f); } catch (e) { out.push(f); } } await document.fonts.ready; return out; }, fonts);
if (bad.length) { await b.close(); throw new Error("文字が読み込めない：" + bad.join(", ")); }
await p.waitForTimeout(300);
await p.screenshot({ path: path.join(root, "og.png") }); await b.close();
// どの og.html から作ったかを残す（qa が見て、作り直し忘れを落とす）
// 写しているあいだに og.html が変わったら、指紋を残さずに止める（古い画像が qa を通らないように）
if (sum() !== before) throw new Error("写しているあいだに tools/og.html が変わった。もう一度実行する");
writeFileSync(path.join(root, "tools/og.sha256"), before + "\n");
console.log("og.png を作った");
