FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npx tsc -p tsconfig.server.json
RUN npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data/attachments
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/build-server ./build-server
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node server/schema.sql ./server/schema.sql
RUN mkdir -p /data/attachments && chown -R node:node /data
USER node
EXPOSE 3000
CMD ["node","build-server/server/main.js"]
