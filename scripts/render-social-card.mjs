// Rebuild the static share card with the site's own font and vector branding.
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { stripMetadata } from "../lib/strip-metadata.ts";

const font = await readFile(new URL("../public/fonts/space-grotesk-latin.woff2", import.meta.url));
const icon = await readFile(new URL("../public/favicon.svg", import.meta.url), "utf8");
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
try {
 const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
 await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
 @font-face{font-family:Space;src:url(data:font/woff2;base64,${font.toString("base64")}) format("woff2");font-weight:300 700}
 *{box-sizing:border-box}html,body{margin:0;width:1200px;height:630px;background:#000;color:#f3fff6;font-family:Space,sans-serif}
 main{height:100%;padding:54px 64px;display:flex;flex-direction:column;position:relative;overflow:hidden}
 header{display:flex;align-items:center;gap:18px;font-size:30px;font-weight:600;letter-spacing:-1px}header svg{width:60px;height:60px}
 h1{font-size:106px;line-height:1.03;letter-spacing:-6px;font-weight:600;margin:54px 0 0;z-index:1}h1 span{color:#54ff81}
 footer{margin-top:auto;display:flex;align-items:center;justify-content:space-between;border-top:1px solid #21412a;padding-top:23px;font-size:23px;color:#a2b8a9;z-index:1}
 .slash{position:absolute;right:64px;top:143px;font-size:230px;font-weight:400;letter-spacing:-28px;color:#163c20;line-height:1;transform:rotate(-8deg)}
 </style></head><body><main><header>${icon}<span>10xCatDad</span></header><div class="slash">//</div><h1>ART<br><span>&amp; STUFF</span></h1><footer><span>art.10xcatdad.xyz</span><span>//</span></footer></main></body></html>`);
 await page.evaluate(() => document.fonts.ready);
 const png = stripMetadata(await page.screenshot({ type: "png" }), "image/png");
 await writeFile(new URL("../public/social-card-v1.png", import.meta.url), png);
 console.log("Created public/social-card-v1.png (1200 x 630).");
} finally { await browser.close(); }
