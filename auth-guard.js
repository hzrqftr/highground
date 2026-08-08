(function () {
  // Loaded synchronously from <head> so both redirects resolve before first paint —
  // a signed-in visitor never sees the landing page, and a signed-out one never sees
  // a flash of the dashboard. Runs ahead of steam-auth.js, which is why token
  // consumption lives here rather than there.
  var KEY = 'hg-steam-token';
  window.HG_TOKEN_KEY = KEY;

  // The Worker returns to dashboard.html with #token=… and localStorage is still
  // empty at that moment. Consume the hash BEFORE the signed-out check below, or
  // the guard bounces a fresh login straight back to the landing page and the
  // token is lost.
  try {
    var match = window.location.hash.match(/(?:^#|&)token=([^&]+)/);
    if (match) {
      localStorage.setItem(KEY, decodeURIComponent(match[1]));
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  } catch {
    // storage unavailable (private mode, blocked cookies) — fall through as signed out
  }

  var hasToken = false;
  try {
    hasToken = !!localStorage.getItem(KEY);
  } catch {
    hasToken = false;
  }

  // Presence only. An expired token still gets you to the dashboard, where
  // /auth/me rejects it and steam-auth.js clears it before bouncing back here —
  // so the round trip settles rather than looping.
  var page = document.documentElement.dataset.hgPage;
  if (page === 'landing' && hasToken) {
    window.location.replace('dashboard.html');
  } else if (page === 'app' && !hasToken) {
    window.location.replace('index.html');
  }
})();
