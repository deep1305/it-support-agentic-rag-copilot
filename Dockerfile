# Matches the local .venv interpreter (CPython 3.12.10)
FROM python:3.12.10-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8080

WORKDIR /app

# Install dependencies first to take advantage of layer caching
COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# Copy application code
COPY app/ ./app/
COPY static/ ./static/
COPY templates/ ./templates/
COPY data/sample_kb/ ./data/sample_kb/
COPY ingest_sample_kb.py run.py ./

# Run as a non-root user; data/ and uploads/ must be writable (audit.db, file uploads)
RUN useradd --create-home --uid 1000 appuser \
    && mkdir -p /app/data /app/uploads \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8080\")}/')" || exit 1

# Bind to 0.0.0.0 so the app is reachable from outside the container (run.py uses 127.0.0.1 + reload for local dev).
# Cloud hosts (Cloud Run, Render, Railway) inject $PORT; fall back to 8080 locally.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1"]
