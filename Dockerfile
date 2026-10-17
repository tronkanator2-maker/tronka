FROM oven/bun:1.2
WORKDIR /app
COPY package.json bot.ts engine.ts admin.ts feedback.ts ./
COPY tests ./tests
RUN bun test
CMD ["bun","run","bot.ts"]