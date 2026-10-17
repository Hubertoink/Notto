// Real App navigation and production styles with local synthetic notes.
// Only the sign-in gate is bypassed inside this isolated fixture server.
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const output = resolve('test-results');
await mkdir(output, { recursive: true });
await writeFile(
  resolve(output, 'navigation.html'),
  '<html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/test-results/navigation.tsx"></script></html>',
);
await writeFile(
  resolve(output, 'navigation.tsx'),
  `
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import App from '../src/App';
import { NottoProvider } from '../src/state';
import { newNote } from '../src/domain';
import { repo } from '../src/repository';
import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '../src/styles.css';
import '../src/bauhaus.css';
localStorage.setItem('notto-cloud', JSON.stringify({url:'',key:''}));
localStorage.setItem('notto-theme', new URLSearchParams(location.search).get('theme') || 'dark');
for (let i=0;i<40;i++) {
  const note = {...newNote('local', 'Notiz '+(i+1)+': Jugendarbeit\\n\\nEin Gedanke mit Quellen und Aufgaben.\\n#jugendarbeit'),collections:['Sammlung '+String(i+1).padStart(2,'0')]};
  await repo.put(note,null);
}
for (const id of ['abc.pdf','def.pdf']) {
  const note={...newNote('local','[Konzeption](attachments/'+id+')'),document:{attachmentId:id,name:'Konzeption',mime:'application/pdf',version:1}};
  await repo.put(note,null);
}
createRoot(document.getElementById('root')).render(<MotionConfig reducedMotion="always"><NottoProvider><div className="desktop-frame"><header className="desktop-titlebar">NOTO</header><App /></div></NottoProvider></MotionConfig>);
`,
);
const server = await createServer({
  server: { port: 0, strictPort: false, open: false },
  plugins: [
    {
      name: 'navigation-fixture-signin',
      enforce: 'pre',
      resolveId(source, importer) {
        if (source === './Login' && importer?.replaceAll('\\', '/').endsWith('/src/App.tsx'))
          return '\0navigation-fixture-signin';
      },
      load(id) {
        if (id === '\0navigation-fixture-signin')
          return 'export function WebAccess({children}) { return children; }';
      },
    },
  ],
});
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  for (const [name, width, height, theme] of [
    ['desktop-dark', 1440, 900, 'dark'],
    ['small-dark', 1240, 600, 'dark'],
    ['short-light', 900, 480, 'light'],
    ['mobile-dark', 390, 700, 'dark'],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(
      new URL('/test-results/navigation.html?theme=' + theme, server.resolvedUrls.local[0]).href,
    );
    await page.locator('.note-list .note-card').first().waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.note-list .note-card').length === 40);
    assert.match(await page.locator('.list-heading p').innerText(), /40 Notizen · 2 Dokumente/);
    if (width <= 700) await page.getByRole('button', { name: 'Navigation öffnen' }).click();
    const result = await page.evaluate(() => {
      const sidebar = document.querySelector('.sidebar'),
        nav = document.querySelector('.sidebar-scroll');
      const account = document.querySelector('.account-avatar'),
        header = document.querySelector('.sidebar-fixed');
      const list = document.querySelector('.note-list'),
        before = account.getBoundingClientRect();
      const headerBefore = header.getBoundingClientRect().top;
      nav.scrollTop = nav.scrollHeight;
      list.scrollTop = 300;
      const after = account.getBoundingClientRect(),
        style = getComputedStyle(list);
      return {
        scrolls: nav.scrollTop > 0 && list.scrollTop > 0,
        accountFixed: before.top === after.top && before.bottom === after.bottom,
        accountVisible: after.top >= 0 && after.bottom <= innerHeight,
        headerFixed: header.getBoundingClientRect().top === headerBefore,
        outerDoesNotScroll: sidebar.scrollHeight <= sidebar.clientHeight + 1,
        thinScrollbar: style.scrollbarWidth === 'thin',
        transparentTrack: style.scrollbarColor.endsWith('rgba(0, 0, 0, 0)'),
        noPageOverflow: document.documentElement.scrollWidth <= innerWidth,
      };
    });
    await page.screenshot({ path: resolve(output, `navigation-${name}.png`) });
    console.log(JSON.stringify({ name, ...result }));
    assert.ok(
      Object.values(result).every(Boolean),
      'Navigation footer stays visible and list scrollbar matches the surface',
    );
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
