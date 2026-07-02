# Build stage
FROM oven/bun:latest AS builder

WORKDIR /app

# Copy package.json and bun.lockb (if exists)
COPY package*.json bun.lockb* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source files
COPY . .

# Build the application (if you have a build step)
# RUN bun run build

# Production stage
FROM oven/bun:1.0.30-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3-pip \
    && pip3 install --no-cache-dir --break-system-packages streamlink \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only necessary files from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/config.json ./config.json
COPY --from=builder /app/src ./src

# Run the application
CMD ["bun", "run", "src/index.ts"]
