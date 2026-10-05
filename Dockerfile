# =============================================================================
# CAPSTONE Backend — Dockerfile (multi-stage)
# Build:  docker compose up --build -d
# Run:    docker compose logs -f backend
# =============================================================================

# ─── Stage 1: builder ────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Cài deps hệ thống cho native modules (bcrypt, etc.)
RUN apk add --no-cache python3 make g++

# Copy lockfile trước để tận dụng cache layer
COPY package.json package-lock.json ./
COPY workers/ai-transcription/package.json ./workers/ai-transcription/package.json
COPY workers/ai-transcription/package-lock.json ./workers/ai-transcription/package-lock.json

RUN npm ci
RUN npm ci --prefix workers/ai-transcription

# Copy toàn bộ source
COPY . .

# Build backend (nest build) + AI worker (tsc)
# Bỏ qua lỗi AI worker nếu thiếu python deps — backend vẫn build được
RUN npm run build || (echo "Build failed" && exit 1)

# ─── Stage 2: runner ───────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

# ffmpeg/ffprobe cho recording (REC-002/005) + curl cho healthcheck
RUN apk add --no-cache ffmpeg curl tini

# Chỉ cài production deps cho backend
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy dist đã build từ builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/workers ./workers
# Assets (fonts cho PDF export)
COPY --from=builder /app/src/assets ./dist/assets
# Nếu assets nằm ngoài dist, đảm bảo copy đúng vị trí
COPY src/assets ./src/assets

# Tạo thư mục runtime (storage, uploads) — mount volume sẽ ghi đè
RUN mkdir -p /app/storage/recordings /app/uploads && chown -R node:node /app

USER node
EXPOSE 3000

# tini làm init để handle SIGTERM đúng cách
ENTRYPOINT ["/sbin/tini", "--"]

# Healthcheck — dùng curl thay vì wget (đã cài)
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=5 \
  CMD curl -f http://localhost:3000/api/v1/health 2>/dev/null \
   || curl -f http://localhost:3000/api/v1 2>/dev/null \
   || curl -f http://localhost:3000/ 2>/dev/null \
   || exit 1

# Tự chạy migration còn thiếu trước khi start (tránh quên chạy tay khi deploy).
# Migration đã chạy thì TypeORM bỏ qua. Migration lỗi → container KHÔNG start (fail sớm, dễ thấy).
# `exec` để node thay thế sh → tini chuyển SIGTERM thẳng tới node.
CMD ["sh", "-c", "npx typeorm migration:run -d dist/database/data-source.js && exec node dist/main.js"]
