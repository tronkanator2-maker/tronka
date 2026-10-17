# Optional MTProto source collector

This is a **separate service** from the customer-facing Telegram bot. Do not deploy before the owner provides an authorized account session. It uses actively maintained `teleproto`.

Required environment: `DATABASE_URL` (same PostgreSQL as bot), `TG_API_ID`, `TG_API_HASH`, `TG_STRING_SESSION` (authorized via an interactive owner login OFFLINE). Optional `COLLECTOR_SEARCH_TERMS` pipe-separated search terms. Never commit credentials or session strings.

Build with `Dockerfile.collector` and do not enable the bot's `/health` check for this worker. It auto-samples candidate sources over a rolling thirty-day window, checks 3 unique jobs / last 14 days / under 50% stop-word spam / no underage sexual requests, auto-adds public qualified channels, and puts messages into `mm_collector_inbox`. The bot consumes the durable inbox every 5 seconds.

Known limitations: discovery is rotating bounded searches; Telegram may refuse some public or private chat histories. Only accessible chats can be processed; do not bypass Telegram permissions. Telegram accounts may be rate-limited; inspect logs, adjust polling and keywords. Private channels require lawful membership. Automatic source qualification and account session use require live end-to-end testing before enabling production.

The collector will exit with an error if any of the four required variables are absent. It is not presently deployed.
