import { chromium } from 'playwright';

// Verificação do spike: abre ?c3spike, coleta erros de console/página e tira print.
const url = process.argv[2] ?? 'http://127.0.0.1:1420/?c3spike';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(1500);
const shot = process.argv[3] ?? 'test-results/c3-spike.png';
await page.screenshot({ path: shot, fullPage: false });

const probe = await page.evaluate(() => ({
  title: document.title,
  appBar: Boolean(document.querySelector('.MuiAppBar-root')),
  composer: Boolean(document.querySelector('textarea')),
  bubbles: document.querySelectorAll('[class*="MuiBox-root"]').length,
  tailwindToken: getComputedStyle(document.documentElement).getPropertyValue('--color-n-slate-11').trim(),
  dataTheme: document.documentElement.dataset.theme ?? null,
  c3Mode: document.documentElement.dataset.c3Mode ?? null,
  bodyText: (document.body.innerText ?? '').slice(0, 300),
}));

console.log(JSON.stringify({ url, errors, probe, shot }, null, 2));
await browser.close();
process.exit(errors.length ? 1 : 0);
