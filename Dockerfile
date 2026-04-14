# API image — build from monorepo ROOT (Railway root directory = . or unset).
# Alternative: set service "Root Directory" to `backend` and use backend/Dockerfile instead.
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libxml2-dev libxslt1-dev zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

RUN mkdir -p data

ENV PYTHONUNBUFFERED=1
ENV SEED_FRIENDS_ON_STARTUP=true
ENV DEMO_USER_TOKEN=a1b2c3d4-e5f6-4789-a012-3456789abcde

EXPOSE 8000

CMD ["sh", "-c", "python -m uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
