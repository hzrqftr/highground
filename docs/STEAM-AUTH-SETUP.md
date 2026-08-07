# Sign in with Steam — setup, continuation, and deploy

Status as of this commit: the Cloudflare Worker backend and frontend widget are
written and type-checked, but **not yet tested end-to-end or deployed**. This is
the playbook to finish it from a different device.

## What this is

- Steam auth uses **OpenID 2.0**, not OAuth — there's no client-side-only flow
  like the Google sign-in in `yugioh-forbiddenmemories`. Steam redirects back
  with a signed assertion that must be verified with a server-to-server POST,
  and the Steam Web API key used to fetch profile info is a **secret** (unlike
  a Google OAuth Client ID, it must never reach the browser). That's why this
  needs a backend: a Cloudflare Worker at `worker/`.
- Session handoff uses a **JWT in `localStorage`**, not a cookie — the frontend
  (GitHub Pages, `hzrqftr.github.io`) and the Worker (`*.workers.dev` or a
  custom domain) are different origins, so cross-site cookies were avoided
  entirely rather than fought.

## Files

| Path | Purpose |
|---|---|
| `worker/src/index.ts` | The Worker: `/auth/steam/login`, `/auth/steam/callback` (verifies with Steam, signs a JWT), `/auth/me` (validates the JWT, returns profile) |
| `worker/wrangler.jsonc` | Worker config. `FRONTEND_ORIGIN` = `https://hzrqftr.github.io` (for CORS), `FRONTEND_REDIRECT_URL` = `https://hzrqftr.github.io/highground/` (post-login redirect) — both confirmed against the actual GitHub remote |
| `worker/.dev.vars.example` | Template for local secrets — copy to `.dev.vars` (gitignored) and fill in |
| `steam-auth.js` | Frontend: consumes the JWT from the redirect, calls `/auth/me`, toggles the sign-in button vs. profile widget |
| `index.html`, `styles.css` | Sidebar "Sign in with Steam" button + profile widget markup/styles |

## Continuing on another device

1. **Clone/pull this repo**, then install Node.js LTS if it isn't already
   present (`node -v` to check).
2. **Install worker dependencies**:
   ```
   cd worker
   npm install
   ```
3. **Get a Steam Web API key** (if you don't already have it saved somewhere):
   https://steamcommunity.com/dev/apikey — sign in with your own Steam account.
4. **Create local secrets**:
   ```
   cp .dev.vars.example .dev.vars
   ```
   Then edit `.dev.vars` and set:
   - `STEAM_API_KEY` — the key from step 3
   - `JWT_SECRET` — any long random string, e.g.
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

   `.dev.vars` is gitignored — it does not travel with the repo, generate a
   fresh one per machine.
5. **Run the Worker locally** — do this in a normal terminal (VS Code's
   integrated terminal is fine); it failed when run through a sandboxed
   automation shell on Windows (`write EOF` / a libuv assertion spawning the
   `workerd` subprocess), which looked environment-specific, not a code issue:
   ```
   npm run dev
   ```
   Should come up on `http://localhost:8787`.
6. **Serve the frontend locally** (not `file://` — `fetch()` needs a real
   origin) from the repo root, e.g.:
   ```
   npx serve .
   ```
   Open it, click "Sign in with Steam," confirm the whole redirect round-trip
   works and the sidebar shows your Steam avatar/name.
7. **Deploy for real**:
   ```
   wrangler login
   wrangler secret put STEAM_API_KEY
   wrangler secret put JWT_SECRET
   npm run deploy
   ```
8. **Point the frontend at the deployed Worker**: in `steam-auth.js`, change
   `WORKER_BASE_URL` from `http://localhost:8787` to the deployed
   `*.workers.dev` URL (or a custom domain route, if one is set up later).
9. Commit and push the `WORKER_BASE_URL` change once verified live.

## Open items / things to double check later

- No custom domain is wired up yet — the Worker will live on the default
  `*.workers.dev` subdomain unless you add a route. That's fine to start;
  a custom domain would let you avoid CORS/cross-origin entirely later.
- `worker/` has its own `.gitignore` (node_modules, `.dev.vars`, `.wrangler/`)
  so those never get committed — no extra root `.gitignore` entries needed.
