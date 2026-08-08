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

  const listeners = [];
  function notifyChange(signedIn, profile) {
    for (const cb of listeners) {
      try {
        cb({ signedIn, profile: profile || null });
      } catch {
        // listener errors shouldn't break auth state handling
      }
    }
  }

  function showSignedOut() {
    for (const btn of signinBtns) btn.hidden = false;
    if (profileEl) profileEl.hidden = true;
    notifyChange(false, null);
  }

  function showSignedIn(profile) {
    for (const btn of signinBtns) btn.hidden = true;
    if (profileEl) profileEl.hidden = false;
    if (avatarEl) avatarEl.src = profile.avatar || '';
    if (nameEl) nameEl.textContent = profile.personaname || profile.steamid;
    notifyChange(true, profile);
  }

  async function refreshSession() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      showSignedOut();
      return;
    }
    try {
      const res = await fetch(`${WORKER_BASE_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('session invalid');
      showSignedIn(await res.json());
    } catch {
      // Clear BEFORE notifying. A listener may redirect to the landing page, and
      // auth-guard.js there checks for a token — leaving a rejected one in place
      // would bounce it straight back here and loop.
      localStorage.removeItem(TOKEN_KEY);
      showSignedOut();
    }
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
