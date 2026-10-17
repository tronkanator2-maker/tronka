FROM oven/bun:1.2
WORKDIR /app
COPY package.json bot.ts engine.ts admin.ts feedback.ts access.ts documents.ts ai-parser.ts privacy.ts pricing.ts source-health.ts visibility.ts test-mode.ts profile-wizard.ts profile-draft.ts relay.ts job-wizard.ts ./
COPY tests ./tests
RUN bun build --target=bun bot.ts --outdir /tmp/compile-check
RUN bun test
CMD ["bun","run","bot.ts"]