# Build stage — compile the Go binary.
FROM golang:1.25-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/server ./cmd/server

# Runtime stage — Debian ships a Stockfish package, which is far simpler than
# vendoring a platform-specific binary; the engine talks generic UCI (see
# engine.Engine.handshake), so the exact packaged version doesn't matter.
FROM debian:bookworm-slim
RUN apt-get update && \
    apt-get install -y --no-install-recommends stockfish ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /out/server ./server
# Runtime data only — opening-source PDFs and the chunk-validation script are
# authoring-time inputs, not read by the server (see .dockerignore).
COPY data ./data

ENV STOCKFISH_PATH=/usr/games/stockfish
EXPOSE 8080
CMD ["./server"]
