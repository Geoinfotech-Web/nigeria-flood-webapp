FROM python:3.11-slim

# GDAL is required by rasterio (used for COG mosaic in SAR + GEE scripts)
RUN apt-get update && apt-get install -y --no-install-recommends \
        gdal-bin \
        libgdal-dev \
        gcc \
        g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "main.py"]
