# syntax=docker/dockerfile:1
# pagepin — size-optimized multi-stage build (public registries only).
#
#   web     → builds the React console (Debian: painless esbuild/vite)
#   build   → bundles the server with tsup (Debian: painless native builds)
#   deps    → production node_modules ON ALPINE (musl libsql binary), then pruned
#   runtime → node:22-alpine + pruned node_modules + bundle + assets  (~194MB)
#
# Only the runtime base affects final image size, so web/build stay on Debian where
# native compiles never fail; deps + runtime are alpine so the libsql native binary
# matches musl. Multi-arch (amd64 + arm64) is preserved because buildx runs every
# stage per target arch, and pnpm resolves the matching @libsql/<arch>-musl prebuilt.

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
RUN pnpm install
# gen:assets inlines static/* + skills/pagepin/* into src/generated/edge-assets.ts, which
# serving.ts statically imports — so it must exist before tsup bundles index.ts (a clean
# checkout has no generated file). Hence we COPY the sources it reads and run it first.
# tsup.config.ts keeps the DB drivers (postgres/mysql2) external — without it tsup bundles
# mysql2's CJS into the ESM output and the image crashes with "Dynamic require of buffer".
COPY tsconfig.json tsup.config.ts ./
COPY scripts/ scripts/
COPY static/ static/
COPY skills/ skills/
COPY src/ src/
RUN pnpm gen:assets && npx tsup src/index.ts --format esm --target node22

# --------------------------------------------------------------- stage: deps
# Production node_modules on alpine so @libsql/* resolves the musl prebuilt binary.
# --ignore-scripts: libsql ships a prebuilt .node (no build step), and it stops the
# unused better-sqlite3 optional-peer from compiling node-gyp.
FROM node:22-alpine AS deps
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --ignore-scripts
# Drop what the Node runtime never imports: drizzle-orm's optional peer drivers
# (better-sqlite3, gel) + type-only packages that leak through --prod, and the glibc
# libsql binary (this is a musl image). src/ only imports drizzle-orm/libsql.
RUN cd node_modules/.pnpm 2>/dev/null && \
    rm -rf better-sqlite3@* @types+better-sqlite3@* @cloudflare+workers-types@* \
           gel@* @types+node@* @libsql+linux-*-gnu@* || true

# ------------------------------------------------------------ stage: runtime
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PAGEPIN_DATA_DIR=/data
WORKDIR /app
COPY --from=deps  /app/node_modules/ node_modules/
COPY --from=build /app/dist/         dist/
COPY --from=web   /web/dist/         console/dist/
COPY package.json ./
# index.ts reads skills/pagepin/SKILL.md + references/api.md at runtime (serves /skill.md
# and /references/api.md). comments/marked/favicon assets are already inlined into the bundle.
COPY skills/ skills/
# libSQL auto-applies migrations from ./drizzle relative to WORKDIR (/app).
COPY drizzle/ drizzle/

# Run as the unprivileged built-in `node` user; make the data volume writable by it.
# Named volumes (compose `pagepin-data`, `docker run -v pagepin-data:/data`) inherit this
# ownership on first use. For a host bind-mount, chown the host dir to uid 1000 first.
RUN mkdir -p /data && chown -R node:node /data
USER node

VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PAGEPIN_PORT:-8000}/healthz" >/dev/null 2>&1 || exit 1
CMD ["node", "dist/index.js"]
