// Real reading view, local synthetic images, and production styles.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const output = resolve('test-results');
await mkdir(output, { recursive: true });
await writeFile(
  resolve(output, 'thumbnails.html'),
  '<html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/test-results/thumbnails.tsx"></script></html>',
);
await writeFile(
  resolve(output, 'thumbnails.tsx'),
  `
import { createRoot } from 'react-dom/client';
import { NottoProvider } from '../src/state';
import { Editor } from '../src/Editor';
import { newNote } from '../src/domain';
import { repo } from '../src/repository';
import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '../src/styles.css';
import '../src/bauhaus.css';
localStorage.setItem('notto-cloud', JSON.stringify({url:'',key:''}));
const params = new URLSearchParams(location.search);
document.documentElement.style.colorScheme = params.get('theme') || 'dark';
const count = Number(params.get('count') || 10);
const images = [];
for (let i = 0; i < count; i++) {
  const canvas = document.createElement('canvas');
  canvas.width = 140; canvas.height = 160;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = ['#ef3826', '#0d45ff', '#f8ce00', '#3ba890'][i % 4];
  ctx.fillRect(0, 0, 140, 160);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 64px sans-serif';
  ctx.textAlign = 'center'; ctx.fillText(String(i + 1), 70, 100);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  const id = i.toString(16) + '.png';
  await repo.putAttachment({scope:'local',id,name:id,mime:'image/png',bytes:Array.from(new Uint8Array(await blob.arrayBuffer()))});
  images.push('![Bild '+(i+1)+'](attachments/'+id+' "noto:width=50;mode=thumbnail")');
}
const note = newNote('local', '# Cocktails-Ideensammlung\\n\\n'+images.join('\\n')+'\\n\\nRezepte für später.');
await repo.put(note,null);
createRoot(document.getElementById('root')).render(<NottoProvider>
<div className="notebook detail-open"><main className="main"><div className="work-area"><section className="detail-panel"><Editor note={note} onSaved={() => {}} /></section></div></main></div>
</NottoProvider>);
`,
);
const server = await createServer({ server: { port: 0, strictPort: false, open: false } });
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  for (const [name, width, count, theme] of [
    ['single', 390, 1, 'dark'],
    ['four', 390, 4, 'dark'],
    ['eight-desktop', 1440, 8, 'dark'],
    ['ten-mobile', 390, 10, 'dark'],
    ['eight-narrow', 320, 8, 'light'],
  ]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(
      new URL(
        '/test-results/thumbnails.html?count=' + count + '&theme=' + theme,
        server.resolvedUrls.local[0],
      ).href,
    );
    await page.waitForFunction((count) => {
      const images = [...document.querySelectorAll('.image-fan-card img')];
      return images.length === count && images.every((image) => image.complete && image.naturalWidth > 0);
    }, count);
    const checkCompact = async () => {
      const result = await page.locator('.image-fan').evaluate((fan) => {
        const bounds = fan.getBoundingClientRect();
        const cards = [...fan.querySelectorAll('.image-fan-card')].filter(
          (card) => getComputedStyle(card).opacity === '1',
        );
        return {
          visible: cards.length,
          contained: cards.every((card) => {
            const rect = card.getBoundingClientRect();
            return (
              rect.left >= bounds.left &&
              rect.right <= bounds.right &&
              rect.top >= bounds.top &&
              rect.bottom <= bounds.bottom
            );
          }),
          positions: cards.map((card) => card.getBoundingClientRect().left),
        };
      });
      assert.equal(result.visible, Math.min(count, 8), 'Compact fan shows at most eight thumbnails');
      assert.ok(result.contained, 'Rotated thumbnail corners stay inside the reading area');
      assert.equal(new Set(result.positions).size, result.visible, 'Every preview has a distinct position');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    };
    await checkCompact();
    await page.screenshot({ path: resolve(output, `thumbnails-${name}.png`) });
    await page.getByRole('button', { name: 'Bilder auffächern' }).last().click();
    assert.equal(await page.getByRole('button', { name: /^Bild \d+ vergrößern$/ }).count(), count);
    await page.getByRole('button', { name: `Bild ${count} vergrößern`, exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await checkCompact();
    await page.getByRole('button', { name: 'Bilder auffächern' }).last().click();
    await page.getByRole('button', { name: 'Bilder einklappen' }).click();
    await checkCompact();
    if (count === 8) {
      await page.setViewportSize({ width: 280, height: 1000 });
      await checkCompact();
    }
    assert.deepEqual(errors, []);
    console.log(`${name}: compact thumbnails contained; full gallery and lightbox work.`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
