# Book-worms Bot

This project is a Telegram bot for tracking daily reading tasks. It uses
Express.js, Telegraf, TypeScript and Prisma with a PostgreSQL database.

## Setup

Install dependencies with:

```bash
npm install
```

Environment variables required:

- `BOT_TOKEN` – Telegram bot token.
- `DATABASE_URL` – PostgreSQL connection string.

Generate the Prisma client after installing packages:

```bash
npx prisma generate
```

## Development

Run the bot in development mode:

```bash
npm run dev
```

Build TypeScript sources:

```bash
npm run build
```

### Note about this environment

The environment used for this repository does not allow network access,
therefore `npm install` will fail here. Dependencies must be installed in an
environment with internet access or using a prepared setup script.
