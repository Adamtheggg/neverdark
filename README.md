
# Never Dark bot

Telegram ordering bot for @NeverDarkUKBot. Node, no dependencies. Single file, `bot.js`.

## Run

- Build: `npm install`
- Start: `node bot.js`
- Health: GET / returns `ok` once polling starts, `booting` before

## Environment variables

| Key | What it is |
| --- | --- |
| `BOT_TOKEN` | Bot token from BotFather |
| `ADMIN_IDS` | Telegram id(s) allowed in the panel. Comma separated. First one receives saved state. |
| `GROUP_ID` | Supergroup for order cards, e.g. `-1004455208789` |

## Commands

Buyer: `/start`, `/orders`, send an order number to track it, send a photo as payment proof.

Owner: `/start` or `/admin` for the panel, `/buyer` for the buyer side, `/restore`, `/stats`.

## Buyer flow

ORDER NOW then tier with photo, name, address, payment method, order placed, details sent automatically, buyer sends a screenshot, card lands in the group.

The half-finished form is a persisted draft, so a restart mid-flow does not lose it. Drafts expire after 30 minutes.

## Order states

new to taken to sent to done, or gone. The group card rewrites its own buttons as the state moves and each tap messages the buyer automatically.

## Guardrails

- Per-update try/catch so one bad update cannot kill the loop.
- 15 second timeout and 3 retries on every Telegram call, honouring retry_after on 429.
- Outbound sends go through one paced queue.
- Watchdog restarts polling if no successful poll for 2 minutes.
- Order codes are sequential from `seq`, so they never collide.

## Automatic work (60 second scan)

- Nudges unpaid orders after 15 minutes.
- Asks for feedback 3 days after posting.
- Deletes stale drafts.
- Sends an end of day summary at 21:00.

## Storage

`data.json` on the container is wiped on every deploy. The real store is a JSON snapshot in a pinned message in the owner DM, rewritten on every change and read back at boot. Do not delete or unpin it.

If it is ever lost the bot warns the owner at boot and `/restore` with a backup line rebuilds it.

## Deploying

Pushes do NOT auto deploy. Trigger the Render deploy hook.
