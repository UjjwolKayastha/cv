// Renders cv.yaml to an HTML page, then prints that same page to a PDF.
//   npm run build -> dist/
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import nunjucks from 'nunjucks';
import { parse } from 'yaml';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist');
const pdfName = 'Ujjwol-Kayastha-CV.pdf';
const EXPECTED_PAGES = 2;

const cv = parse(await readFile(path.join(root, 'cv.yaml'), 'utf8'));

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
const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
await page.goto(pathToFileURL(path.join(outDir, 'index.html')).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);

// Split the content into A4 sheets once, so the web page and the PDF break in the same place.
await page.evaluate(() => {
  const LIMIT = 1033 - 4; // A4 height minus 12mm margins, with a small safety allowance
  const staysWithNext = (el) => el.matches('h2, h4, .intro');
  const flatten = (sheet) => [...sheet.children].flatMap((c) => (c.tagName === 'SECTION' ? [...c.children] : [c]));
  for (let guard = 0; guard < 10; guard++) {
    const sheet = document.querySelector('.pages').lastElementChild;
    const top = sheet.getBoundingClientRect().top + parseFloat(getComputedStyle(sheet).paddingTop);
    const blocks = flatten(sheet);
    const over = blocks.findIndex((b) => b.getBoundingClientRect().bottom - top > LIMIT);
    if (over === -1) return;
    let start = over;
    while (start > 0 && staysWithNext(blocks[start - 1])) start--;
    if (start === 0) throw new Error('A single block is taller than one A4 page.');
    const first = blocks[start];
    const next = document.createElement('div');
    next.className = 'sheet';
    const section = first.parentElement;
    let tail = section.nextElementSibling;
    if (section.tagName === 'SECTION' && first.previousElementSibling) {
      const cont = document.createElement('section');
      cont.className = 'cont';
      let el = first;
      while (el) { const n = el.nextElementSibling; cont.append(el); el = n; }
      next.append(cont);
    } else if (section.tagName === 'SECTION') {
      next.append(section);
    } else {
      tail = first;
    }
    while (tail) { const n = tail.nextElementSibling; next.append(tail); tail = n; }
    sheet.after(next);
  }
  throw new Error('Pagination did not finish.');
});
await writeFile(path.join(outDir, 'index.html'), '<!doctype html>\n' + await page.evaluate(() => document.documentElement.outerHTML));
await page.emulateMedia({ media: 'print' });
const pdfPath = path.join(outDir, pdfName);
await page.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true, tagged: true, outline: true });
await browser.close();

const pages = (await readFile(pdfPath)).toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0;
if (pages !== EXPECTED_PAGES) throw new Error(`PDF has ${pages} pages, expected ${EXPECTED_PAGES}. Trim cv.yaml or adjust the layout.`);
const sheets = (await readFile(path.join(outDir, 'index.html'), 'utf8')).match(/class="sheet"/g).length;
if (sheets !== pages) throw new Error(`Web page has ${sheets} sheets but the PDF has ${pages} pages.`);
const box = (await readFile(pdfPath)).toString('latin1').match(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)/);
if (!box || Math.abs(box[1] - 595.28) > 1 || Math.abs(box[2] - 841.89) > 1) throw new Error(`PDF is not A4: ${box?.[1]} x ${box?.[2]} pt`);
console.log(`Built ${path.relative(root, outDir)}/ (${pages}-page PDF, ${years}+ years)`);
