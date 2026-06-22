FROM node:22-bookworm-slim

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git openssh-client \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable pnpm \
    && corepack prepare pnpm@11.8.0 --activate

WORKDIR /app

COPY logos-ts/package.json logos-ts/pnpm-lock.yaml logos-ts/pnpm-workspace.yaml ./logos-ts/
COPY logos-ts/studio/package.json logos-ts/studio/pnpm-lock.yaml logos-ts/studio/pnpm-workspace.yaml ./logos-ts/studio/
COPY investment-portfolio/frontend/package.json investment-portfolio/frontend/pnpm-lock.yaml investment-portfolio/frontend/pnpm-workspace.yaml ./investment-portfolio/frontend/

RUN pnpm --dir logos-ts install --frozen-lockfile \
    && pnpm --dir logos-ts/studio install --frozen-lockfile \
    && pnpm --dir investment-portfolio/frontend install --frozen-lockfile \
    && pnpm add --global @anthropic-ai/claude-code@2.1.175 \
    && pnpm --dir logos-ts exec playwright install --with-deps chromium

COPY --chown=node:node . .

ENV DISABLE_AUTOUPDATER=1 \
    LOGOS_DISABLE_HMR=1 \
    LOGOS_HOST=0.0.0.0 \
    LOGOS_PROJECT=/app/investment-portfolio \
    LOGOS_PUBLIC_PORT=443 \
    LOGOS_PUBLIC_PROTOCOL=wss \
    LOGOS_REQUIRE_AUTH=1 \
    LOGOS_VITE_CACHE_DIR=/tmp/logos-vite \
    NODE_ENV=production \
    PORT=8080

USER node

EXPOSE 8080

CMD ["node", "logos-ts/studio/bin/serve.mjs"]
