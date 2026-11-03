// OGP 画像を作り直す：node tools/make-og.mjs（qa の Playwright を使う）
import { chromium } from "../qa/node_modules/playwright/index.mjs";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exe = process.env.CHROMIUM_PATH || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : "");
const b = await chromium.launch(exe ? { executablePath: exe } : {});
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.goto("file://" + path.join(root, "tools/og.html")); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(300);
await p.screenshot({ path: path.join(root, "og.png") }); await b.close(); console.log("og.png を作った");
