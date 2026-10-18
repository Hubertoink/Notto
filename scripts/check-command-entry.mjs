// Render the real editor with a synthetic local note; no account or network model calls.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const output = resolve('test-results');
await mkdir(output, { recursive: true });
await writeFile(
  resolve(output, 'editor-entry.html'),
  '<html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/test-results/editor-entry.tsx"></script></html>',
);
await writeFile(
  resolve(output, 'editor-entry.tsx'),
  `
import { createRoot } from 'react-dom/client';
import { Theme } from '@astryxdesign/core/theme';
import { MotionConfig } from 'motion/react';
import { bauhausTheme } from '../src/bauhaus-theme';
import { NottoProvider } from '../src/state';
import { Editor } from '../src/Editor';
import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '../src/styles.css';
import '../src/documents.css';
import '../src/bauhaus.css';
localStorage.setItem('notto-cloud', JSON.stringify({url:'',key:''}));
createRoot(document.getElementById('root')).render(<Theme theme={bauhausTheme}><MotionConfig reducedMotion="always"><NottoProvider>
<div className="notebook detail-open"><main className="main"><div className="work-area"><section className="detail-panel"><Editor onSaved={() => {}} /></section></div></main></div>
</NottoProvider></MotionConfig></Theme>);
`,
);
const server = await createServer({ server: { port: 0, strictPort: false, open: false } });
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const [name, width, theme] of [
    ['desktop', 1440, 'dark'],
    ['mobile', 360, 'light'],
  ]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(new URL('/test-results/editor-entry.html', server.resolvedUrls.local[0]).href);
    await page.evaluate((theme) => (document.documentElement.style.colorScheme = theme), theme);
    const field = page.getByRole('textbox', { name: 'Notiztext', exact: true });
    await field.fill(
      'Variantenvergleich\n\nVariante A: 80 Euro, drinnen.\nVariante B: 40 Euro, draußen.\n\n#jugendarbeit',
    );
    const context = page.getByRole('button', { name: 'KI-Kontext', exact: true });
    await context.click();
    const popup = page.getByRole('dialog', { name: 'KI-Kontext', exact: true });
    await popup.waitFor({ state: 'visible' });
    const bounds = await popup.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 1000);
    await page.getByLabel('Webrecherche für diese Notiz ausschalten').check();
    assert.equal(await page.getByLabel('Webrecherche an', { exact: true }).count(), 0);
    await page.screenshot({ path: resolve(output, `context-${name}.png`), fullPage: true });
    await page.keyboard.press('Escape');
    await popup.waitFor({ state: 'hidden' });
    assert.equal(await context.evaluate((el) => el === document.activeElement), true);
    await context.click();
    await page.getByLabel('Webrecherche für diese Notiz ausschalten').uncheck();
    await page.getByRole('button', { name: 'KI-Kontext schließen' }).click();
    await popup.waitFor({ state: 'hidden' });
    assert.equal(await page.getByLabel('Webrecherche an', { exact: true }).count(), 1);
    await context.click();
    await field.click();
    await popup.waitFor({ state: 'hidden' });
    await field.fill('Ein **kurzer** Text mit [Link](https://example.org/langer/pfad).');
    assert.equal(await page.getByLabel('5 Wörter', { exact: true }).count(), 1);
    if (!(await page.getByRole('button', { name: 'Neuer KI-Auftrag', exact: true }).isVisible()))
      await page.getByRole('button', { name: /KI-Anmerkungen/ }).click();
    await page.getByRole('button', { name: 'Neuer KI-Auftrag', exact: true }).click();
    const command = page.getByRole('textbox', { name: 'Deine Frage oder dein Auftrag' });
    await command.fill('Vergleiche beide Varianten und nenne offene Fragen.');
    assert.equal(await command.evaluate((el) => el === document.activeElement), true);
    await page.screenshot({ path: resolve(output, `command-entry-${name}.png`), fullPage: true });
    assert.equal(await page.getByRole('button', { name: 'KI fragen', exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.equal(
      await page.locator('.annotation-shell').evaluate((el) => el.scrollWidth > el.clientWidth + 1),
      false,
      'No horizontal overflow in commands',
    );
    await page.getByRole('tab', { name: 'Anmerkungen', exact: true }).click();
    await page.getByRole('button', { name: 'Neuer KI-Auftrag', exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA');
    assert.equal(await command.inputValue(), 'Vergleiche beide Varianten und nenne offene Fragen.');
    await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    await field.fill('Langer Absatz mit Zutaten und Anweisungen.\n'.repeat(70) + '\n#kochen');
    assert.equal(
      await page.evaluate(() => {
        const field = document.querySelector('.inline-note-editor textarea');
        const tags = document.querySelector('.editor-tags');
        return tags.getBoundingClientRect().top >= field.getBoundingClientRect().bottom - 1;
      }),
      true,
      'Tags remain below the complete note',
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    'Real editor: desktop/mobile command entry, focus, retained draft, cancellation and long-note layout passed.',
  );
} finally {
  await browser.close();
  await server.close();
}
