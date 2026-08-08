(function () {
  // Auto-detect local dev: serving the frontend from localhost talks to `wrangler dev`
  // on its default port (8787); anything else talks to the deployed Worker.
  const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const WORKER_BASE_URL = isLocalHost
    ? `http://${window.location.hostname}:8787`
    : 'https://highground-steam-auth.hazriq-fitri95.workers.dev';
  const TOKEN_KEY = 'hg-steam-token';

  const signinBtn = document.getElementById('steam-signin-btn');
  const profileEl = document.getElementById('steam-profile');
  const avatarEl = document.getElementById('steam-avatar');
  const nameEl = document.getElementById('steam-name');
  const signoutBtn = document.getElementById('steam-signout-btn');
  const dashboardNavLink = document.getElementById('dashboard-nav-link');

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

  function consumeTokenFromUrl() {
    const match = window.location.hash.match(/(?:^#|&)token=([^&]+)/);
    if (!match) return;
    localStorage.setItem(TOKEN_KEY, decodeURIComponent(match[1]));
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function showSignedOut() {
    if (signinBtn) signinBtn.hidden = false;
    if (profileEl) profileEl.hidden = true;
    if (dashboardNavLink) dashboardNavLink.hidden = true;
    notifyChange(false, null);
  }

  function showSignedIn(profile) {
    if (signinBtn) signinBtn.hidden = true;
    if (profileEl) profileEl.hidden = false;
    if (avatarEl) avatarEl.src = profile.avatar || '';
    if (nameEl) nameEl.textContent = profile.personaname || profile.steamid;
    if (dashboardNavLink) dashboardNavLink.hidden = false;
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
      localStorage.removeItem(TOKEN_KEY);
      showSignedOut();
    }
  }

  consumeTokenFromUrl();
  refreshSession();

  signinBtn?.addEventListener('click', () => {
    window.location.href = `${WORKER_BASE_URL}/auth/steam/login`;
  });

  signoutBtn?.addEventListener('click', () => {
    localStorage.removeItem(TOKEN_KEY);
    showSignedOut();
  });

  window.HGAuth = {
    workerBaseUrl: WORKER_BASE_URL,
    getToken: () => localStorage.getItem(TOKEN_KEY),
    onChange: (cb) => {
      listeners.push(cb);
    },
  };
})();
