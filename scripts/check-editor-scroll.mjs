// Real Chromium layout with production styles and textarea measurement.
// The reduced viewport models keyboard space; this does not emulate Android's IME.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import ts from 'typescript';

const css = (
  await Promise.all(
    ['styles', 'bauhaus'].map((name) => readFile(new URL(`../src/${name}.css`, import.meta.url), 'utf8')),
  )
).join('\n');
const source = await readFile(new URL('../src/textarea-size.ts', import.meta.url), 'utf8');
const measureCode = ts
  .transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext })
  .replace('export function', 'function');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 412, height: 450 },
    isMobile: true,
    hasTouch: true,
  });
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style>
    <div class="notebook detail-open"><main class="main"><div class="work-area"><section class="detail-panel">
    <section class="editor"><div class="editor-heading">Notiz bearbeiten</div><div class="editor-body">
    <div class="editor-content"><div class="inline-note-editor"><textarea aria-label="Notiztext"></textarea></div></div>
    </div><div class="editor-footer">Gespeichert</div></section></section></div></main></div>`);
  await page.addScriptTag({ content: `${measureCode}\nwindow.resizeNoteTextarea = resizeNoteTextarea;` });
  const result = await page.evaluate(() => {
    const field = document.querySelector('textarea');
    const panel = document.querySelector('.detail-panel');
    field.value = Array.from(
      { length: 100 },
      (_, i) => `Absatz ${i}: Ein Gedanke zur offenen Jugendarbeit und zum selbstregulierten Lernen.`,
    ).join('\n\n');
    const resize = window.resizeNoteTextarea;
    resize(field);
    field.focus({ preventScroll: true });
    field.setSelectionRange(2500, 2500);
    panel.scrollTop = 2500;
    const before = panel.scrollTop;
    const originalHeight = field.offsetHeight;
    // Capture the old implementation's failure for comparison.
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight}px`;
    const oldAfter = panel.scrollTop;
    panel.scrollTop = before;
    for (let i = 0; i < 30; i++) {
      field.value += 'a';
      resize(field);
      if (Math.abs(panel.scrollTop - before) > 1) throw Error('Typing moved the note viewport');
    }
    const after = panel.scrollTop;
    const focusPreserved = document.activeElement === field;
    const noClipping = field.scrollHeight <= field.clientHeight + 1;
    field.value = 'Kurz';
    resize(field);
    return {
      before,
      oldAfter,
      after,
      focusPreserved,
      noClipping,
      shrinks: field.offsetHeight < originalHeight,
      mirrorsLeft: document.querySelectorAll('textarea').length - 1,
    };
  });
  console.log(JSON.stringify(result));
  assert.ok(result.before > 1000);
  assert.equal(result.after, result.before);
  assert.ok(result.focusPreserved && result.noClipping && result.shrinks);
  assert.equal(result.mirrorsLeft, 0);
  // Reflow when orientation changes must still measure the full text correctly.
  for (const size of [
    { width: 360, height: 380 },
    { width: 760, height: 412 },
    { width: 412, height: 850 },
  ]) {
    await page.setViewportSize(size);
    assert.ok(
      await page.evaluate(() => {
        const field = document.querySelector('textarea');
        field.value = 'Langer umgebrochener Text für eine mobile Notiz. '.repeat(100);
        window.resizeNoteTextarea(field);
        return field.scrollHeight <= field.clientHeight + 1;
      }),
    );
  }
  console.log('Editor scrolling, focus, shrinking, and width reflow checks passed.');
} finally {
  await browser.close();
}
