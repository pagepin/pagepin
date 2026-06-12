# syntax=docker/dockerfile:1
# pagepin — multi-stage build (public registries only).
#
#   web     → builds the React console (console/dist)
#   build   → bundles the server with tsup (dist/index.js)
#   runtime → slim image: prod node_modules + dist + static assets

# ---------------------------------------------------------------- stage: web
FROM node:22-slim AS web
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /web
# Manifests first so the dependency layer is cached across source edits.
COPY console/package.json console/pnpm-lock.yaml* ./
RUN pnpm install
COPY console/ ./
RUN pnpm build

# -------------------------------------------------------------- stage: build
FROM node:22-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
# better-sqlite3 is a native module: trust prebuild-install to fetch a
# prebuilt binary; fall back to compiling from source if that fails.
RUN pnpm install \
  || (apt-get update \
      && apt-get install -y --no-install-recommends python3 make g++ \
      && rm -rf /var/lib/apt/lists/* \
      && pnpm install)
COPY tsconfig.json ./
COPY src/ src/
RUN npx tsup src/index.ts --format esm --target node20

# ------------------------------------------------------------ stage: runtime
FROM node:22-slim AS runtime
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NODE_ENV=production \
    PAGEPIN_DATA_DIR=/data
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
# Same native-module strategy as the build stage, prod deps only
# (pnpm 10 build-script allowlist lives in package.json onlyBuiltDependencies).
RUN pnpm install --prod \
  || (apt-get update \
      && apt-get install -y --no-install-recommends python3 make g++ \
      && rm -rf /var/lib/apt/lists/* \
      && pnpm install --prod)
COPY --from=build /app/dist/ dist/
COPY --from=web /web/dist/ console/dist/
COPY static/ static/
COPY skill.md ./

VOLUME /data
EXPOSE 8000
CMD ["node", "dist/index.js"]
