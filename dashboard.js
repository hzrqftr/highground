(function () {
  // auth-guard.js has already bounced the no-token case before paint. What's left
  // is /auth/me's answer, once it arrives: a rejected token ('signed-out'), a
  // network/timeout failure that says nothing about whether the token is still
  // good ('error'), or success ('signed-in') — handled in onChange at the bottom.
  const auth = window.HGAuth;
  if (!auth) return;

  const DATA_TIMEOUT_MS = 10000;

  // Mirrors steam-auth.js's helper — a stalled request otherwise leaves the
  // dashboard's loading state (or now, skeleton) up forever with nothing to show.
  function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
  }

  const profileSkeleton = document.getElementById('profile-skeleton');
  const profileCard = document.getElementById('profile-card');
  const profileError = document.getElementById('profile-error');
  const avatarEl = document.getElementById('dashboard-profile-avatar');
  const nameEl = document.getElementById('dashboard-profile-name');
  const steamidEl = document.getElementById('dashboard-profile-steamid');
  const linkEl = document.getElementById('dashboard-profile-link');

  const matchesList = document.getElementById('matches-list');
  const matchesLoading = document.getElementById('matches-loading');
  const matchesEmpty = document.getElementById('matches-empty');
  const matchesError = document.getElementById('matches-error');

  const statsGrid = document.getElementById('stats-grid');
  const statsLoading = document.getElementById('stats-loading');
  const statsEmpty = document.getElementById('stats-empty');
  const statsError = document.getElementById('stats-error');
  const statWinrate = document.getElementById('stat-winrate');
  const statKda = document.getElementById('stat-kda');
  const statRole = document.getElementById('stat-role');

  let heroesById = null;
  async function loadHeroes() {
    if (heroesById) return heroesById;
    try {
      const res = await fetch('data/heroes.json');
      const heroes = await res.json();
      heroesById = new Map(heroes.map((h) => [h.id, h]));
    } catch {
      heroesById = new Map();
    }
    return heroesById;
  }

  function formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function formatRelativeTime(unixSeconds) {
    const diffMs = Date.now() - unixSeconds * 1000;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours < 1) return 'less than an hour ago';
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  }

  function isWin(match) {
    const isRadiant = match.player_slot < 128;
    return isRadiant === match.radiant_win;
  }

  async function renderMatches(matches) {
    const heroes = await loadHeroes();
    matchesLoading.hidden = true;

    if (!matches.length) {
      matchesEmpty.hidden = false;
      return;
    }

    matchesList.innerHTML = '';
    for (const match of matches) {
      const hero = heroes.get(match.hero_id);
      const win = isWin(match);

      const li = document.createElement('li');
      li.className = `match-row ${win ? 'match-win' : 'match-loss'}`;

      const heroIcon = document.createElement('img');
      heroIcon.className = 'match-hero-icon';
      heroIcon.alt = hero?.localized_name || `Hero ${match.hero_id}`;
      heroIcon.addEventListener('error', () => heroIcon.replaceWith(Object.assign(document.createElement('span'), { className: 'match-hero-icon match-hero-icon-fallback', textContent: '🛡️' })), { once: true });
      heroIcon.src = hero?.icon || '';

      const heroName = document.createElement('span');
      heroName.className = 'match-hero-name';
      heroName.textContent = hero?.localized_name || `Hero ${match.hero_id}`;

      const role = document.createElement('span');
      role.className = 'match-role';
      role.textContent = match.role || '—';

      const result = document.createElement('span');
      result.className = 'match-result';
      result.textContent = win ? 'Win' : 'Loss';

      const kda = document.createElement('span');
      kda.className = 'match-kda';
      kda.textContent = `${match.kills}/${match.deaths}/${match.assists}`;

      const duration = document.createElement('span');
      duration.className = 'match-duration';
      duration.textContent = formatDuration(match.duration);

      const time = document.createElement('span');
      time.className = 'match-time';
      time.textContent = formatRelativeTime(match.start_time);

      li.append(heroIcon, heroName, role, result, kda, duration, time);
      matchesList.appendChild(li);
    }
    matchesList.hidden = false;
  }

  async function fetchMatches(token) {
    try {
      const res = await fetchWithTimeout(
        `${auth.workerBaseUrl}/dota/recent-matches`,
        { headers: { Authorization: `Bearer ${token}` } },
        DATA_TIMEOUT_MS,
      );
      if (!res.ok) throw new Error('request failed');
      const data = await res.json();
      await renderMatches(data.matches || []);
    } catch {
      matchesLoading.hidden = true;
      matchesError.hidden = false;
    }
  }

  function renderStats(stats) {
    statsLoading.hidden = true;

    if (stats.win_rate === null) {
      statsEmpty.hidden = false;
      return;
    }

    statWinrate.textContent = `${(stats.win_rate * 100).toFixed(1)}%`;
    statKda.textContent = `${Math.round(stats.avg_kills)}/${Math.round(stats.avg_deaths)}/${Math.round(stats.avg_assists)}`;
    statRole.textContent = stats.preferred_role ?? 'Not enough data';
    statsGrid.hidden = false;
  }

  async function fetchStats(token) {
    try {
      const res = await fetchWithTimeout(
        `${auth.workerBaseUrl}/dota/stats`,
        { headers: { Authorization: `Bearer ${token}` } },
        DATA_TIMEOUT_MS,
      );
      if (!res.ok) throw new Error('request failed');
      const data = await res.json();
      renderStats(data);
    } catch {
      statsLoading.hidden = true;
      statsError.hidden = false;
    }
  }

  function renderProfile(profile) {
    avatarEl.src = profile.avatar || '';
    nameEl.textContent = profile.personaname || profile.steamid;
    steamidEl.textContent = `SteamID: ${profile.steamid}`;
    linkEl.href = `https://steamcommunity.com/profiles/${profile.steamid}`;
    profileSkeleton.hidden = true;
    profileCard.hidden = false;
  }

  auth.onChange(({ status, profile }) => {
    if (status === 'signed-out') {
      window.location.replace('index.html');
      return;
    }

    if (status === 'error') {
      // Network/timeout, not a rejected token (steam-auth.js only clears the
      // token on an actual 401) — a retry can still work, so say so plainly
      // rather than redirecting away from a page the user may still be signed
      // into.
      profileSkeleton.hidden = true;
      profileError.hidden = false;
      return;
    }

    renderProfile(profile);
    fetchStats(auth.getToken());
    fetchMatches(auth.getToken());
  });
})();
