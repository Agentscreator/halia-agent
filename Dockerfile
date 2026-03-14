# ── Stage 1: Build frontend ──────────────────────────────────
FROM node:20-slim AS frontend-build

WORKDIR /app/core/frontend
COPY core/frontend/package.json core/frontend/package-lock.json* ./
RUN npm ci --no-fund --no-audit
COPY core/frontend/ ./
RUN npm run build

# ── Stage 2: Python runtime ─────────────────────────────────
FROM python:3.11-slim AS runtime

# System deps for aiohttp native extensions
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc && \
    rm -rf /var/lib/apt/lists/*

# Install uv for fast dependency resolution
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# Copy project files needed for dependency resolution
COPY pyproject.toml uv.lock ./
COPY core/pyproject.toml core/uv.lock* core/
COPY tools/ tools/

# Install Python dependencies
RUN uv sync --project core --no-dev --frozen

# Copy framework source
COPY core/framework/ core/framework/

# Copy agent templates and examples
COPY examples/ examples/

# exports/ may not exist in the repo — create it so the server has a writable dir
RUN mkdir -p exports

# Copy built frontend from stage 1
COPY --from=frontend-build /app/core/frontend/dist/ core/frontend/dist/

# Create non-root user
RUN useradd -m -u 1001 appuser && \
    mkdir -p /home/appuser/.hive && \
    chown -R appuser:appuser /app /home/appuser/.hive
USER appuser

# Cloud Run injects PORT (default 8080); fall back to 8787 for local use
ENV PORT=8787
EXPOSE 8787

# Health check for local Docker usage (Cloud Run has its own)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://localhost:{os.environ.get(\"PORT\",8787)}/api/health')" || exit 1

# Start the server — bind to 0.0.0.0 so Cloud Run can route traffic in
CMD ["sh", "-c", "uv run --project core hive serve --host 0.0.0.0 --port $PORT"]
