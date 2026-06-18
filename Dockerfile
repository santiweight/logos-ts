FROM node:22-bookworm-slim

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git openssh-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY logos-ts/package.json logos-ts/package-lock.json ./logos-ts/
COPY logos-ts/studio/package.json logos-ts/studio/package-lock.json ./logos-ts/studio/
COPY logos-ts/demos/hn-jobs/package.json logos-ts/demos/hn-jobs/package-lock.json ./logos-ts/demos/hn-jobs/

RUN npm ci --prefix logos-ts \
    && npm ci --prefix logos-ts/studio \
    && npm ci --prefix logos-ts/demos/hn-jobs \
    && npm install --global @anthropic-ai/claude-code@2.1.175 \
    && npx --prefix logos-ts playwright install --with-deps chromium

COPY --chown=node:node . .

ENV DISABLE_AUTOUPDATER=1 \
    LOGOS_DISABLE_HMR=1 \
    LOGOS_HOST=0.0.0.0 \
    LOGOS_PROJECT=/app/logos-ts/demos/hn-jobs \
    LOGOS_PUBLIC_PORT=443 \
    LOGOS_PUBLIC_PROTOCOL=wss \
    LOGOS_REQUIRE_AUTH=1 \
    LOGOS_VITE_CACHE_DIR=/tmp/logos-vite \
    NODE_ENV=production \
    PORT=8080

USER node

EXPOSE 8080

CMD ["node", "logos-ts/studio/bin/serve.mjs"]
