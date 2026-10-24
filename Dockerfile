FROM oven/bun:1.3
WORKDIR /app
COPY package.json bot.ts admin-ui.ts admin-data.ts admin-moderators.ts db-json.ts telegram-user.ts job-visibility.ts search-state.ts engine.ts admin.ts feedback.ts access.ts trial-reminders.ts documents.ts ai-parser.ts privacy.ts pricing.ts source-health.ts visibility.ts test-mode.ts profile-wizard.ts profile-draft.ts relay.ts telegram-dispatch.ts decision-notifications.ts job-wizard.ts guides.ts guide-editor.ts deep-links.ts navigation-state.ts resume-menu.ts pagination.ts demo-catalog.ts catalog-page.ts jobs-page.ts profile-refresh.ts profile-fanout.ts profile-delivery.ts quota-actions.ts quota-settings.ts daily-views.ts response-acceptance.ts invite-acceptance.ts invitation-delivery.ts ./
COPY tests ./tests
RUN bun build --target=bun bot.ts --outdir /tmp/compile-check
RUN bun test
CMD ["bun","run","bot.ts"]
