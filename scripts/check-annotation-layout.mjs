// Browser geometry regression: the actual styles with the Editor/NoteAnnotations
// DOM structure and synthetic content. No account or user notebook is accessed.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const css = (
  await Promise.all(
    ['styles', 'tasks', 'note-commands', 'bauhaus'].map((name) =>
      readFile(new URL(`../src/${name}.css`, import.meta.url), 'utf8'),
    ),
  )
).join('\n');
const paragraph =
  '<p>Brooks unterscheidet essentielle und akzidentelle Komplexität. Diese synthetische Recherche dient ausschließlich der Layoutprüfung.</p>';
function fixture({ longNote = false, inline = false, closed = false } = {}) {
  return `<style>${css}
    :root { color-scheme: dark; }
    .fixture-rail { width: 75px; flex-shrink: 0; }
    .fixture-list { width: 350px; flex-shrink: 0; }
  </style><div class="notebook"><aside class="fixture-rail"></aside><main class="main">
    <div class="work-area"><aside class="fixture-list"></aside><section class="detail-panel">
      <div class="detail-actions">Notizaktionen</div>
      <section class="editor editor-reading editor-with-annotations">
        <div class="editor-heading"><div class="editor-top"><button>Bearbeiten</button></div><div class="note-meta">Erstellt 27. Sept., 12:49 · 2 Textversionen</div></div>
        <div class="editor-body"><div class="editor-content is-preview markdown"><h1>Essentielle Komplexität</h1><p>Frederick P. Brooks Gedanken zur Essentiellen Komplexität scheinen interessant.</p>${longNote ? paragraph.repeat(50) : ''}</div><div class="editor-tags">Sammlungen</div></div>
        <div class="note-annotations annotation-shell ${inline ? 'annotation-inline' : 'annotation-docked'} ${closed ? '' : 'annotation-open'}">
          <div class="annotation-heading"><button class="annotation-toggle">KI-Anmerkungen <span class="annotation-status">Geprüft · keine Hinweise</span></button><div class="annotation-heading-indicators"><button>1 Auftrag</button></div></div>
          <div class="annotation-content" ${closed ? 'hidden' : ''}>
            <div class="annotation-tabs"><button>Anmerkungen</button><button>Aufträge · 1</button></div>
            <div class="annotation-panel" role="tabpanel" hidden>Andere Anmerkungen</div>
            <div class="annotation-panel" role="tabpanel"><div class="markdown"><h2>Empfohlene Lesereihenfolge</h2>${paragraph.repeat(40)}<p id="research-end">Ende der Recherche</p></div></div>
          </div>
        </div>
        <div class="editor-controls"><div class="editor-footer"><button>Gespeichert</button></div></div>
      </section>
    </section></div></main></div>`;
}
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
try {
  for (const size of [
    { width: 1740, height: 1010 },
    { width: 1460, height: 800 },
    { width: 1425, height: 600 },
  ]) {
    for (const inline of [false, true]) {
      await page.setViewportSize(size);
      await page.setContent(fixture({ inline }));
      const geometry = await measure();
      console.log(JSON.stringify({ ...size, inline, ...geometry }));
      assert.equal(geometry.outerOverflow, 0, 'Short note must not scroll the detail panel');
      assert.equal(geometry.noteOverflow, 0, 'Short note must not scroll its body');
      assert.ok(geometry.researchOverflow > 0, 'Long research must have its own scrollbar');
      assert.ok(geometry.contained, 'Research viewport must fit inside the annotation shell and window');
      assert.equal(geometry.researchOverflowStyle, 'auto');
      await page.locator('.annotation-panel:not([hidden])').evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      assert.ok(
        await page
          .locator('#research-end')
          .evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight),
      );
    }
  }
  await page.setViewportSize({ width: 1740, height: 1010 });
  await page.setContent(fixture({ longNote: true }));
  assert.equal((await measure()).outerOverflow, 0);
  assert.ok((await measure()).noteOverflow > 0, 'Long notes must remain scrollable independently');
  await page.setContent(fixture({ closed: true }));
  assert.equal((await measure()).outerOverflow, 0, 'Closed annotations must not introduce outer scroll');

  // Resize across the breakpoint and back without rebuilding the DOM.
  await page.setContent(fixture({ inline: true }));
  for (const width of [1400, 1460, 1100, 1740]) {
    await page.setViewportSize({ width, height: 800 });
    if (width >= 1425) assert.equal((await measure()).outerOverflow, 0);
    else {
      const mode = await page.locator('.editor').evaluate((el) => getComputedStyle(el).display);
      assert.equal(mode, 'flex', 'Narrow layouts must put annotations below the note');
    }
  }
  await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
  await page.screenshot({
    path: new URL('../test-results/annotation-layout.png', import.meta.url).pathname.replace(
      /^\/(\w:)/,
      '$1',
    ),
  });
  console.log('Annotation layout checks passed.');
} finally {
  await browser.close();
}
async function measure() {
  return page.evaluate(() => {
    const outer = document.querySelector('.detail-panel');
    const note = document.querySelector('.editor-body');
    const panel = document.querySelector('.annotation-panel:not([hidden])');
    const shell = document.querySelector('.annotation-shell');
    const p = panel.getBoundingClientRect(),
      s = shell.getBoundingClientRect();
    return {
      outerOverflow: outer.scrollHeight - outer.clientHeight,
      noteOverflow: note.scrollHeight - note.clientHeight,
      researchOverflow: panel.scrollHeight - panel.clientHeight,
      researchOverflowStyle: getComputedStyle(panel).overflowY,
      contained: p.bottom <= s.bottom + 1 && s.bottom <= innerHeight + 1 && p.top >= s.top,
    };
  });
}
