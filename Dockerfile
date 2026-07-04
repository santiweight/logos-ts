FROM node:22-bookworm-slim

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git openssh-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV PNPM_HOME=/usr/local/share/pnpm
ENV PATH=$PNPM_HOME/bin:$PNPM_HOME:$PATH

COPY package.json pnpm-lock.yaml ./
COPY pnpm-workspace.deploy.yaml ./pnpm-workspace.yaml
COPY logos-ts/package.json ./logos-ts/
COPY logos-ts/studio/package.json ./logos-ts/studio/

RUN mkdir -p "$PNPM_HOME" \
    && corepack enable \
    && pnpm install --frozen-lockfile \
    && pnpm add --global @anthropic-ai/claude-code@2.1.175 \
    && pnpm --dir logos-ts exec playwright install --with-deps chromium

COPY --chown=node:node . .

ENV DISABLE_AUTOUPDATER=1 \
    LOGOS_DISABLE_HMR=1 \
    LOGOS_HOST=0.0.0.0 \
    LOGOS_PUBLIC_PORT=443 \
    LOGOS_PUBLIC_PROTOCOL=wss \
    LOGOS_REQUIRE_AUTH=1 \
    LOGOS_VITE_CACHE_DIR=/tmp/logos-vite \
    NODE_ENV=production \
    PORT=8080

USER node

EXPOSE 8080

CMD ["node", "logos-ts/studio/bin/serve.mjs"]
