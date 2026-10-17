// Real OpenUI/React rendering and production CSS, with deterministic result fixtures.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const output = resolve('.notto-dev/openui-qa');
await mkdir(output, { recursive: true });
await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'tsx',
    contents: `
      import { createRoot } from 'react-dom/client';
      import CommandPresentation from './src/CommandPresentation';
      import './src/styles.css';
      import './src/bauhaus.css';
      import './src/note-commands.css';
      const result = { summary: 'Beteiligung im Jugendhaus', sources: [], warnings: [], items: [
        { title: 'Offene Planung', detail: 'Jugendliche bringen eigene Ideen ein und entscheiden gemeinsam, welche Angebote entstehen.', kind: 'fact' },
        { title: 'Fester Rahmen', detail: 'Vorab vereinbarte Termine geben Orientierung. Innerhalb dieses Rahmens bleibt Raum für eigene Vorschläge.', kind: 'fact' },
        { title: 'Gemeinsamen Auftakt planen', detail: 'Beim nächsten Treffen Ideen sammeln und die ersten Schritte gemeinsam auswählen.', kind: 'proposal' },
        { title: 'Beteiligung braucht Rückmeldung', detail: 'Die Konzeption verbindet Mitbestimmung mit regelmäßiger gemeinsamer Reflexion.', kind: 'inference' }
      ], presentation: {version:1,source:'root = Answer([Comparison([0,1]),Plan([2]),SourceCards([3])])'} };
      createRoot(document.getElementById('root')).render(<main style={{maxWidth:760,margin:'24px auto',padding:'0 16px'}}>
        <h2>Beteiligung im Jugendhaus</h2><p>Vergleich, nächste Schritte und Quellen aus der Konzeption.</p>
        <section className="note-commands"><CommandPresentation result={result}
          fallback={<p>Normale Antwort</p>} onInsert={text => {window.exported=text;}}
          renderItem={(i,layout) => <section className="command-card"><div>
            <small>{result.items[i].kind === 'proposal' ? 'Vorschlag' : result.items[i].kind === 'fact' ? 'Aus den Quellen' : 'Schlussfolgerung'}</small>
            {layout !== 'comparison' && <h3>{result.items[i].title}</h3>}<p>{result.items[i].detail}</p>
            <details><summary>Konzeption · Seite 7</summary><blockquote>Jugendliche bestimmen das Programm gemeinsam.</blockquote></details>
          </div></section>} />
        </section>
      </main>);`,
  },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  outfile: resolve(output, 'fixture.js'),
  logLevel: 'silent',
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false' },
});
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const [name, width, theme] of [
    ['desktop', 900, 'light'],
    ['mobile', 360, 'dark'],
  ]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.setContent(`<html style="color-scheme:${theme}"><body><div id="root"></div></body></html>`);
    await page.addStyleTag({ content: await readFile(resolve(output, 'fixture.css'), 'utf8') });
    await page.addScriptTag({ path: resolve(output, 'fixture.js') });
    await page.getByRole('table').waitFor();
    assert.equal(await page.getByRole('table').count(), 1);
    assert.equal(await page.getByRole('heading', { name: 'Ablaufplan' }).count(), 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
    await page.getByRole('button', { name: 'In Notiz übernehmen', exact: true }).click();
    assert.match(await page.evaluate(() => window.exported), /\| Offene Planung \|/);
    await page.getByRole('button', { name: 'Textansicht', exact: true }).click();
    await page.getByText('Normale Antwort').waitFor();
    assert.equal(await page.getByRole('table').count(), 0);
  }
  assert.deepEqual(errors, []);
  console.log(`Desktop/mobile layout, text fallback, Markdown export passed. Screenshots: ${output}`);
} finally {
  await browser.close();
}
