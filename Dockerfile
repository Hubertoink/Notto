# Minimum patched Node runtime. The verified fallback covers the delay between
# Node security downloads and official Docker tags. Other architectures fail
# closed until their official base image contains this security release.
FROM node:24-bookworm-slim AS node-security-base
RUN set -eu; \
    if node -e "const a=process.versions.node.split('.').map(Number),b='24.22.3'.split('.').map(Number);if(a[0]!==b[0]||a[1]<b[1]||(a[1]===b[1]&&a[2]<b[2]))process.exit(1)"; then exit 0; fi; \
    case "$(uname -m)" in \
      x86_64) archive="node-v24.22.3-linux-x64.tar.gz"; checksum="061ec3e3062115705b56b51fa9cc330ab50d34b6969387d4e4b1a50c6809acc2" ;; \
      aarch64) archive="node-v24.22.3-linux-arm64.tar.gz"; checksum="261af2af250dfd7e9f25cf151d1b2713a0adf8f10a9ad116c4947f68627affe8" ;; \
      *) echo "Patched Node 24.22.3 base image required for this architecture" >&2; exit 1 ;; \
    esac; \
    apt-get update && apt-get install -y --no-install-recommends ca-certificates curl; \
    curl --fail --location --retry 3 -o /tmp/node-security.tar.gz "https://nodejs.org/dist/v24.22.3/$archive"; \
    echo "$checksum  /tmp/node-security.tar.gz" | sha256sum -c -; \
    tar -xzf /tmp/node-security.tar.gz --strip-components=2 -C /usr/local/bin "${archive%.tar.gz}/bin/node"; \
    rm /tmp/node-security.tar.gz; \
    node -e "const a=process.versions.node.split('.').map(Number),b='24.22.3'.split('.').map(Number);if(a[0]!==b[0]||a[1]<b[1]||(a[1]===b[1]&&a[2]<b[2]))process.exit(1)"

FROM node-security-base AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npx tsc -p tsconfig.server.json
RUN npm prune --omit=dev

FROM node-security-base
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data/attachments PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
RUN npx playwright install --with-deps --only-shell chromium && chmod -R a+rX /opt/playwright && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app/build-server ./build-server
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node server/schema.sql ./server/schema.sql
RUN mkdir -p /data/attachments && chown -R node:node /data
USER node
RUN node --input-type=module -e "import { chromium } from 'playwright'; const browser = await chromium.launch({headless: true}); const page = await browser.newPage(); await page.setContent('<h1>Noto Browser bereit</h1>'); if (!(await page.screenshot()).length || (await page.pdf()).subarray(0, 5).toString() !== '%PDF-') throw new Error('Browser smoke test failed'); await browser.close();"
EXPOSE 3000
CMD ["node","build-server/server/main.js"]
