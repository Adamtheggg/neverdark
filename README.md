
# Never Dark bot

Telegram ordering bot for @NeverDarkUKBot. Node, no dependencies.

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
| `STATE_CHAT` | Where settings are saved. Set to the owner’s numeric id. |

## Commands

Boss only: `/admin`, `/setpay`, `/photos`, `/backup`, `/restore`, `/buyer`, `/boss`

Buyer: `/start`

## Deploying

Pushes do NOT auto deploy. Trigger the Render deploy hook instead.

## How settings survive a redeploy

The container filesystem is wiped on every deploy, so `data.json` alone would lose prices, payment details, photos and open orders.

To get round it, the bot keeps a JSON snapshot in a **pinned message in the `STATE_CHAT` DM**. It reads that pin back at boot and rewrites it after any change. The pinned message starts with `ND_STATE:`.

- Do not delete or unpin that message, or the next deploy falls back to defaults.
- If it is lost the bot DMs a warning on the next boot and `/restore` plus a `/backup` line fixes it.
- A Render disk would be cleaner, but disks need a paid instance type.

## Layout

Single file, `bot.js`. Tiers are the `TIERS` array. Bot copy is inline HTML strings.
