import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { browserProxy, publicUrl } from './browser-network.js';

export interface BrowserSource {
  pageIndex: number;
  title: string;
  url: string;
  text: string;
  targets: { id: string; text: string }[];
  links: { title: string; url: string }[];
}
export class CommandBrowser {
  private browser?: Browser;
  private context?: BrowserContext;
  private proxy?: Awaited<ReturnType<typeof browserProxy>>;
  private pages: Page[] = [];
  async start() {
    this.proxy = await browserProxy();
    this.browser = await chromium.launch({
      headless: true,
      proxy: { server: this.proxy.url },
      // Do not pass API keys or database credentials to the browser process.
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          ([key, value]) =>
            value &&
            /^(PATH|HOME|USERPROFILE|LOCALAPPDATA|SYSTEMROOT|TEMP|TMP|PLAYWRIGHT_BROWSERS_PATH)$/i.test(key),
        ),
      ) as Record<string, string>,
      args: [
        '--proxy-bypass-list=<-loopback>',
        '--disable-quic',
        '--disable-dev-shm-usage',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      ],
    });
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 2,
      locale: 'de-DE',
      acceptDownloads: false,
      serviceWorkers: 'block',
    });
    this.context.setDefaultTimeout(10000);
    await this.context.route('**/*', async (route) => {
      const request = route.request();
      try {
        publicUrl(request.url());
        if (
          !['GET', 'HEAD'].includes(request.method()) ||
          ['media', 'websocket'].includes(request.resourceType())
        )
          throw new Error('Blocked');
        await route.continue();
      } catch {
        await route.abort().catch(() => {});
      }
    });
    await this.context.routeWebSocket('**/*', (socket) => socket.close());
    this.context.on('page', (page) => {
      page.on('dialog', (dialog) => void dialog.dismiss());
      page.on('download', (download) => void download.cancel());
      page.on('popup', (popup) => void popup.close());
    });
  }
  async read(url: string): Promise<BrowserSource> {
    publicUrl(url);
    if (!this.context) await this.start();
    if (this.pages.length >= 3) throw new Error('Maximal drei Webseiten pro Auftrag.');
    const page = await this.context!.newPage();
    this.pages.push(page);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!response?.ok())
      throw new Error(`Webseite nicht erreichbar (HTTP ${response?.status() || 'unbekannt'}).`);
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
    await page.locator('body').waitFor();
    const snapshot = await page.evaluate(() => {
      const text = document.body.innerText.slice(0, 30000);
      const root = document.querySelector('main') || document.body;
      const elements = new Set<Element>(root.querySelectorAll('button,[role="button"]'));
      root
        .querySelectorAll(
          'tr,article,section,li,[role="row"],[class*="card"],[class*="Card"],main > div > div',
        )
        .forEach((el) => elements.add(el));
      root
        .querySelectorAll('h1,h2,h3,h4')
        .forEach((heading) => elements.add(heading.parentElement || heading));
      const targets: { id: string; text: string }[] = [];
      for (const el of elements) {
        const rect = el.getBoundingClientRect();
        const labels = [...el.querySelectorAll('[aria-label], [title]')]
          .map((child) => child.getAttribute('aria-label') || child.getAttribute('title'))
          .filter(Boolean);
        const label = [
          ...new Set(
            [
              (el as HTMLElement).innerText?.trim(),
              el.getAttribute('aria-label'),
              el.getAttribute('title'),
              ...labels,
            ].filter(Boolean),
          ),
        ].join('\n');
        if (rect.width < 16 || rect.height < 16 || rect.height > 2000 || !label || label.length > 1800)
          continue;
        if (targets.length >= 180) break;
        const id = `capture-${targets.length}`;
        el.setAttribute('data-noto-capture', id);
        targets.push({ id, text: label.slice(0, 900) });
      }
      const links = [...document.querySelectorAll('a[href]')]
        .map((a) => ({
          title: (a.textContent || '').trim().slice(0, 120),
          url: (a as HTMLAnchorElement).href,
        }))
        .filter((link) => /^https?:/.test(link.url) && link.title)
        .slice(0, 100);
      return { title: document.title, text, targets, links };
    });
    return { ...snapshot, url: page.url(), pageIndex: this.pages.indexOf(page) };
  }
  async capture(source: number, target: string | null) {
    const page = this.pages[source];
    if (!page || page.isClosed()) throw new Error('Webseite nicht mehr verfügbar.');
    if (!target) return page.screenshot({ type: 'jpeg', quality: 78, timeout: 10000 });
    if (!/^capture-\d+$/.test(target)) throw new Error('Ungültiger Bildausschnitt.');
    const element = page.locator(`[data-noto-capture="${target}"]`).first();
    await element.scrollIntoViewIfNeeded();
    await element.hover({ timeout: 3000 }).catch(() => {});
    // Capture a visible animation state, not a synthetic illustration.
    await page.waitForTimeout(250);
    const rect = await element.boundingBox();
    if (!rect || rect.width > 2200 || rect.height > 2000)
      throw new Error('Bildausschnitt ist zu groß oder nicht sichtbar.');
    return element.screenshot({ type: 'jpeg', quality: 82, timeout: 10000 });
  }
  async close() {
    await this.browser?.close().catch(() => {});
    await this.proxy?.close();
  }
}
