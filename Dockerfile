FROM oven/bun:1.2
WORKDIR /app
COPY package.json bot.ts engine.ts admin.ts feedback.ts access.ts documents.ts ai-parser.ts privacy.ts pricing.ts source-health.ts ./
COPY tests ./tests
RUN bun build --target=bun bot.ts --outdir /tmp/compile-check
RUN bun test
CMD ["bun","run","bot.ts"]