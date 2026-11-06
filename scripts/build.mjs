// Renders cv.yaml to an HTML page, then prints that same page to a PDF.
//   npm run build          -> dist/            (public: no phone number)
//   npm run build:private  -> private-build/   (adds the phone from private.yaml; gitignored)
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import nunjucks from 'nunjucks';
import { parse } from 'yaml';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isPrivate = process.argv.includes('--private');
const outDir = path.join(root, isPrivate ? 'private-build' : 'dist');
const pdfName = 'Ujjwol-Kayastha-CV.pdf';
const EXPECTED_PAGES = 2;

const cv = parse(await readFile(path.join(root, 'cv.yaml'), 'utf8'));

// The public source must never carry private details.
if (cv.phone || /\+977|\b98\d{8}\b/.test(JSON.stringify(cv))) {
  throw new Error('cv.yaml contains a phone number. Move it to private.yaml.');
}
if (isPrivate) {
  const file = path.join(root, 'private.yaml');
  if (!existsSync(file)) throw new Error('private.yaml not found.');
  Object.assign(cv, parse(await readFile(file, 'utf8')));
}

const now = new Date();
const [startYear, startMonth] = String(cv.career_start).split('-').map(Number);
const years = Math.floor((now.getFullYear() - startYear) + (now.getMonth() + 1 - startMonth) / 12);
cv.summary = cv.summary.replace('{years}', years);

const env = nunjucks.configure(path.join(root, 'template'), { autoescape: true });
env.addFilter('domain', (u) => new URL(u).hostname.replace(/^www\./, ''));
const html = env.render('index.njk', {
  ...cv,
  pdfName,
});

await rm(outDir, { recursive: true, force: true });
await mkdir(path.join(outDir, 'fonts'), { recursive: true });
await writeFile(path.join(outDir, 'index.html'), html);
await copyFile(path.join(root, 'template/style.css'), path.join(outDir, 'style.css'));
for (const icon of ['favicon.ico', 'apple-touch-icon.png']) await copyFile(path.join(root, 'template/icons', icon), path.join(outDir, icon));

const nm = (p) => path.join(root, 'node_modules', p);
const fonts = Object.fromEntries(['400-normal', '400-italic', '600-normal', '700-normal'].map((v) => [
  `source-sans-${v.replace('-normal', '')}.woff2`,
  nm(`@fontsource/source-sans-3/files/source-sans-3-latin-${v}.woff2`),
]));
for (const [name, src] of Object.entries(fonts)) await copyFile(src, path.join(outDir, 'fonts', name));

// CI uses Playwright's Chromium; locally, use the installed Chrome.
const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome' });
const page = await browser.newPage();
await page.emulateMedia({ media: 'print' });
await page.goto(pathToFileURL(path.join(outDir, 'index.html')).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
const pdfPath = path.join(outDir, pdfName);
await page.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true, tagged: true, outline: true });
await browser.close();

const pages = (await readFile(pdfPath)).toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0;
if (pages !== EXPECTED_PAGES) throw new Error(`PDF has ${pages} pages, expected ${EXPECTED_PAGES}. Trim cv.yaml or adjust the layout.`);
const box = (await readFile(pdfPath)).toString('latin1').match(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)/);
if (!box || Math.abs(box[1] - 595.28) > 1 || Math.abs(box[2] - 841.89) > 1) throw new Error(`PDF is not A4: ${box?.[1]} x ${box?.[2]} pt`);
console.log(`Built ${path.relative(root, outDir)}/ (${pages}-page PDF, ${years}+ years)`);
