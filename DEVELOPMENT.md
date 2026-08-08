# Development setup

How to get Highground running locally on any device: frontend + Worker in
two separate terminals, with real Steam OAuth working end-to-end against
localhost.

## New device / fresh clone

1. Clone the repo, then install Worker deps:
   ```
   cd worker
   npm install
   ```

2. Recreate `worker/.dev.vars` — it's gitignored (it holds real secrets, so
   it never comes through `git pull`) and must be recreated by hand on
   every device. Copy the template and fill it in:
   ```
   cp .dev.vars.example .dev.vars
   ```
   Then set:

   | Key | Value | Needs to match across devices? |
   |---|---|---|
   | `STEAM_API_KEY` | Your real Steam Web API key ([steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey)) | Yes — same real key everywhere. Keep it in a password manager so it's easy to paste in on a new device instead of re-deriving it. |
   | `JWT_SECRET` | Any long random string | No — this only signs/verifies session tokens for *that device's* local Worker instance. Generate a fresh one per device, no need to sync it: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `FRONTEND_ORIGIN` | `http://localhost:3000` | Same value everywhere, as long as you always serve the frontend on port 3000 (see below). |
   | `FRONTEND_REDIRECT_URL` | `http://localhost:3000/dashboard.html` | Same as above. |

3. (Only if you'll be pushing changes to `.github/workflows/` from this
   device) make sure `gh auth status` shows the `workflow` scope — if not:
   `gh auth refresh -h github.com -s workflow`. GitHub rejects pushes that
   touch workflow files without it.

## Terminal 1 — Worker

```
cd worker
npm run dev
```

Runs `wrangler dev` on `http://localhost:8787` (default port). Reads
`.dev.vars` for secrets/config.

- `.ts` source changes hot-reload automatically.
- `.dev.vars` changes do **not** hot-reload — stop (`Ctrl+C`) and rerun
  `npm run dev` after editing it.

## Terminal 2 — Frontend

From the repo root:

```
npx serve . -p 3000
```

Serves the static site on `http://localhost:3000`. `steam-auth.js`
auto-detects `localhost`/`127.0.0.1` and points itself at
`http://localhost:8787` automatically — no manual edits needed.

## Test it

1. Open `http://localhost:3000`.
2. Click **Sign in** — this is a real Steam OpenID login. Steam redirects
   back to `localhost:8787/auth/steam/callback`, which then bounces you to
   `localhost:3000/dashboard.html`.
3. Confirm: nav shows "Dashboard" only after sign-in, dashboard shows your
   profile + last 5 Dota 2 matches (or the empty state if "Expose Public
   Match Data" is off in your Dota settings), sign-out redirects back to
   `index.html` and hides the nav link again, and visiting
   `dashboard.html` directly while signed out redirects to `index.html`.

## Troubleshooting

- **CORS error in console** — `FRONTEND_ORIGIN` in `.dev.vars` doesn't match
  the port you're serving the frontend on. Fix it and restart Terminal 1.
- **Redirected to the wrong page after sign-in** — same fix,
  `FRONTEND_REDIRECT_URL` in `.dev.vars`.
- **Port already in use** — a previous `wrangler dev`/`serve` didn't exit
  cleanly. Find it and stop it (Windows/PowerShell):
  ```
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match '8787|3000' } | Select ProcessId, CommandLine
  ```
  then `taskkill /F /PID <id> /T`.
- **Push rejected on a `.github/workflows/` change** — needs the `workflow`
  OAuth scope; see step 3 above.
- **Want to skip the real Steam login** — mint a fake session token instead
  of clicking Sign in (useful for quick UI iteration):
  ```
  cd worker
  node -e "
    const { SignJWT } = require('jose');
    const fs = require('fs');
    const secret = fs.readFileSync('.dev.vars','utf8').match(/^JWT_SECRET=(.+)$/m)[1].trim();
    new SignJWT({ steamid: '<your steamid64>', personaname: 'Test', avatar: '' })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('7d')
      .sign(new TextEncoder().encode(secret)).then(console.log);
  "
  ```
  then in the browser console on `localhost:3000`:
  `localStorage.setItem('hg-steam-token', '<paste token>'); location.reload();`

## Deploying (reminder)

Not part of local testing, but: once changes are committed and pushed to
`main`, the frontend (GitHub Pages) and Worker (GitHub Actions,
`.github/workflows/deploy-worker.yml`, only when `worker/**` changed) both
deploy automatically. No manual `wrangler deploy` needed in the normal
cycle.

- **D1 migrations do run as part of that automation** — the workflow
  applies `wrangler d1 migrations apply highground-player-stats --remote`
  before `wrangler deploy`, so any new migration in `worker/migrations/`
  reaches production automatically on push. `wrangler d1 migrations apply
  --local` (used during local dev) only ever touches your machine's local
  simulated DB and has no effect on the remote one — if you want to check
  the real remote schema/data yourself, use the same command with
  `--remote` instead of `--local`.
