# EstimationX

A simple planning poker app built with Next.js and deployed on Vercel.

- Rooms for up to **20** active participants. Share the invite link to let people join.
- Fibonacci deck: `0 1 2 3 5 8 13 21`, plus `?` and `☕`. These two don't count toward the average.
- The host clicks **Start voting** to unlock the cards and start a shared countdown, defaulting to **45 seconds** (adjustable from 1 to 3600 seconds).
- Time running out only shows the host an inline reminder to end voting. It never forces a reveal or blocks input; **Keep voting** dismisses the reminder.
- Voting ends automatically when every active participant has voted, or when the room host clicks **End voting & reveal**.
- When voting ends, the app shows the **average** and the **closest Fibonacci card**. Ties round up.
- Anyone can still change their vote after the reveal, and the results update live for everyone.
- The host can click **Reset for next round** to clear votes and return to waiting for **Start voting**.
- If the host goes inactive, any participant can end voting or reset. A participant becomes inactive after about 60 seconds without a heartbeat.

## How it works

Room state lives in one Upstash Redis hash per room, so each poll costs a single Redis command. Clients poll every 2 seconds, or every 10 seconds when the tab is hidden. They also send a heartbeat every 20 seconds. Rooms expire 24 hours after their last change.

## Local development

```bash
npm install
npm run dev
```

Without Redis credentials, local development uses an in-memory store. To test against Redis, set `KV_REST_API_URL` and `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`) in `.env.local`. You can run `vercel env pull` to fetch them.

```bash
npm test       # scoring and Redis adapter regression tests (node:test)
npm run lint
npm run build
```

## Deploying

1. Import the repository into Vercel.
2. In the project's **Storage** tab, add **Upstash for Redis** from the Marketplace on the free plan. This sets the `KV_REST_API_*` environment variables.
3. Redeploy.
