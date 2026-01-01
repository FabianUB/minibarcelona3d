FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Default paths for mounted tmb_data volume
CMD ["python", "scripts/poll_metro.py", \
     "--stations-geojson", "/app/tmb_data/metro/stations.geojson", \
     "--lines-dir", "/app/tmb_data/metro/lines"]
