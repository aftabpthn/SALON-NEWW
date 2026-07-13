FROM rust:1.82-slim AS builder
WORKDIR /app

COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
WORKDIR /app
RUN useradd --system --no-create-home --uid 10001 appuser
COPY --from=builder /app/target/release/aura-shine-backend /usr/local/bin/aura-shine-backend
USER appuser
EXPOSE 8080
CMD ["aura-shine-backend"]
