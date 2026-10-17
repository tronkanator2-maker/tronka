FROM oven/bun:1.2
WORKDIR /app
COPY package.json bot.ts engine.ts ./
CMD ["bun","run","bot.ts"]