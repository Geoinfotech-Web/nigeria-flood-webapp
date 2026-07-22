FROM python:3.11-slim

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends gcc g++ \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY service.py train.py ./

# Pre-trained models baked at image build time (from local BentoML store export)
ENV BENTOML_HOME=/root/bentoml
COPY bentoml_store/ /root/bentoml/

ENV PORT=3000
EXPOSE 3000

# Cloud Run injects PORT; local/docker-compose defaults to 3000
CMD ["sh", "-c", "bentoml serve service:svc --host 0.0.0.0 --port ${PORT:-3000}"]
