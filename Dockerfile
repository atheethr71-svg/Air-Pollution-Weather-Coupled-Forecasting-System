# Delhi NCR 72-hour PM2.5 forecast API
#
#   docker build -t delhi-aqi .
#   docker run --rm -p 8000:8000 -e FIRMS_MAP_KEY=<key> delhi-aqi
#
# Images: the coupled model is pure NumPy/SciPy, so a slim base is enough and
# only the API modules are copied (tests and caches are excluded via
# .dockerignore).  The simulation is CPU-bound and runs in a thread pool, so a
# single uvicorn worker is deliberate: scale out with more containers rather
# than more workers per container.
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HOST=0.0.0.0 \
    PORT=8000 \
    LOG_LEVEL=info

WORKDIR /app

RUN apt-get update \
 && apt-get install --no-install-recommends -y curl \
 && rm -rf /var/lib/apt/lists/*

# Dependencies first so application edits reuse the cached layer.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY engine/ ./engine/
COPY services/ ./services/
COPY routers/ ./routers/
COPY main.py ./

# Run unprivileged.
RUN useradd --create-home --shell /usr/sbin/nologin forecast \
 && chown -R forecast:forecast /app
USER forecast

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl --fail --silent --show-error http://127.0.0.1:${PORT}/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "info"]
