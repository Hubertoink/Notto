import { mkdir, writeFile } from 'node:fs/promises';
import { CommandBrowser } from '../server/command-browser.js';
const browser = new CommandBrowser();
try {
  const source = await browser.read(process.argv[2] || 'https://www.shad-table.dev/animated-icons-table');
  console.log(
    JSON.stringify(
      {
        title: source.title,
        url: source.url,
        textLength: source.text.length,
        targets: source.targets.slice(0, 20),
        totalTargets: source.targets.length,
      },
      null,
      2,
    ),
  );
  const target =
    source.targets.find((item) => /^(trash|delete)$/i.test(item.text)) ||
    source.targets.find((item) => /trash/i.test(item.text));
  const image = await browser.capture(source.pageIndex, target?.id || null);
  await mkdir('output', { recursive: true });
  await writeFile('output/command-browser-smoke.jpg', image);
  console.log(`Screenshot: ${image.length} bytes`);
} finally {
  await browser.close();
}
