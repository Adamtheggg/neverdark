# Never Dark bot

Telegram ordering bot for @NeverDarkUKBot. Node, no dependencies, no database.

## Run

- Build: `npm install`
- Start: `node bot.js`
- Health check: GET / returns `ok`

## Environment variables

| Key | What it is |
| --- | --- |
| `BOT_TOKEN` | Bot token from BotFather |
| `ADMIN_IDS` | Telegram user id(s) who can use /admin. Comma separated. |
| `GROUP_ID` | Supergroup for order cards, e.g. `-1004455208789` |

## Commands

Boss only: `/admin`, `/setpay`, `/photos`, `/backup`, `/restore`, `/buyer`, `/boss`

Buyer: `/start`

## Deploying

Pushes do NOT auto deploy. Trigger the Render deploy hook instead.

## data.json

Orders, prices, payment details and photo ids live in `data.json` on the container and are wiped on every deploy. Run `/backup` and keep the line, then `/restore` after a deploy. The bot DMs a warning when it boots with no settings file.

## Layout

Single file, `bot.js`. Tiers are the `TIERS` array. Bot copy is inline HTML strings.
