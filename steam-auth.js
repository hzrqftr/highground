(function () {
  // Auto-detect local dev: serving the frontend from localhost talks to `wrangler dev`
  // on its default port (8787); anything else talks to the deployed Worker.
  const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const WORKER_BASE_URL = isLocalHost
    ? `http://${window.location.hostname}:8787`
    : 'https://highground-steam-auth.hazriq-fitri95.workers.dev';
  // auth-guard.js owns the key and has already consumed any #token= from the URL
  // by the time this runs — it loads synchronously from <head>, this doesn't.
  const TOKEN_KEY = window.HG_TOKEN_KEY;

  const signinBtns = document.querySelectorAll('[data-steam-signin]');
  const profileEl = document.getElementById('steam-profile');
  const avatarEl = document.getElementById('steam-avatar');
  const nameEl = document.getElementById('steam-name');
  const signoutBtn = document.getElementById('steam-signout-btn');

  const AUTH_TIMEOUT_MS = 10000;

  // Plain fetch() never gives up on its own — without this, a stalled network
  // request leaves the page waiting forever with no error and no data, which is
  // worse than just failing. Every request below goes through this instead.
  function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
  }

  const listeners = [];
  function notifyChange(status, profile) {
    for (const cb of listeners) {
      try {
        cb({ status, signedIn: status === 'signed-in', profile: profile || null });
      } catch {
        // listener errors shouldn't break auth state handling
      }
    }
  }

  function showSignedOut() {
    for (const btn of signinBtns) btn.hidden = false;
    if (profileEl) profileEl.hidden = true;
    notifyChange('signed-out', null);
  }

  function showSignedIn(profile) {
    for (const btn of signinBtns) btn.hidden = true;
    if (profileEl) profileEl.hidden = false;
    if (avatarEl) avatarEl.src = profile.avatar || '';
    if (nameEl) nameEl.textContent = profile.personaname || profile.steamid;
    notifyChange('signed-in', profile);
  }

  async function refreshSession() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      showSignedOut();
      return;
    }
    let res;
    try {
      res = await fetchWithTimeout(
        `${WORKER_BASE_URL}/auth/me`,
        { headers: { Authorization: `Bearer ${token}` } },
        AUTH_TIMEOUT_MS,
      );
    } catch {
      // Network failure or timeout — we don't actually know the token is bad,
      // so don't clear it or drop into the signed-out UI. A retry (e.g. a plain
      // refresh) with the same token can still succeed once the network recovers.
      notifyChange('error', null);
      return;
    }

    if (res.status === 401) {
      // The server itself rejected the token — this is a real sign-out. Clear
      // BEFORE notifying: a listener may redirect to the landing page, and
      // auth-guard.js there checks for a token — leaving a rejected one in
      // place would bounce it straight back here and loop.
      localStorage.removeItem(TOKEN_KEY);
      showSignedOut();
      return;
    }

    if (!res.ok) {
      // Some other server-side hiccup (5xx) — same reasoning as the network-error
      // case above, the token itself hasn't been rejected.
      notifyChange('error', null);
      return;
    }

    showSignedIn(await res.json());
  }

  refreshSession();

  for (const btn of signinBtns) {
    btn.addEventListener('click', () => {
      window.location.href = `${WORKER_BASE_URL}/auth/steam/login`;
    });
  }

  signoutBtn?.addEventListener('click', () => {
    localStorage.removeItem(TOKEN_KEY);
    window.location.replace('index.html');
  });

  window.HGAuth = {
    workerBaseUrl: WORKER_BASE_URL,
    getToken: () => localStorage.getItem(TOKEN_KEY),
    onChange: (cb) => {
      listeners.push(cb);
    },
  };
})();
