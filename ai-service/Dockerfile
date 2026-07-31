FROM python:3.12-slim
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends poppler-utils tesseract-ocr \
 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN useradd --system --no-create-home --uid 10001 appuser
USER appuser
EXPOSE 8081
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8081"]
