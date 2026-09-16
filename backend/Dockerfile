FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /uvx /bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1 \
    SMARTSKU_BACKEND_CONFIG=config/config.docker.yaml

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY config ./config
COPY src ./src
RUN uv sync --frozen --no-dev

EXPOSE 8000
CMD ["/app/.venv/bin/python", "-m", "smartsku_backend"]
