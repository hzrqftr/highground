(function () {
  // Local dev default (wrangler dev). Swap to the deployed Worker URL after `wrangler deploy`.
  const WORKER_BASE_URL = 'https://highground-steam-auth.hazriq-fitri95.workers.dev';
  const TOKEN_KEY = 'hg-steam-token';

  const signinBtn = document.getElementById('steam-signin-btn');
  const profileEl = document.getElementById('steam-profile');
  const avatarEl = document.getElementById('steam-avatar');
  const nameEl = document.getElementById('steam-name');
  const signoutBtn = document.getElementById('steam-signout-btn');

  function consumeTokenFromUrl() {
    const match = window.location.hash.match(/(?:^#|&)token=([^&]+)/);
    if (!match) return;
    localStorage.setItem(TOKEN_KEY, decodeURIComponent(match[1]));
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function showSignedOut() {
    if (signinBtn) signinBtn.hidden = false;
    if (profileEl) profileEl.hidden = true;
  }

  function showSignedIn(profile) {
    if (signinBtn) signinBtn.hidden = true;
    if (profileEl) profileEl.hidden = false;
    if (avatarEl) avatarEl.src = profile.avatar || '';
    if (nameEl) nameEl.textContent = profile.personaname || profile.steamid;
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
})();
