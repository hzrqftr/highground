import { SignJWT, jwtVerify } from 'jose';
import heroesData from '../../data/heroes.json';

export interface Env {
	STEAM_API_KEY: string;
	JWT_SECRET: string;
	FRONTEND_ORIGIN: string;
	FRONTEND_REDIRECT_URL: string;
	DB: D1Database;
}

const STEAM_OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function corsHeaders(origin: string): HeadersInit {
	return {
		'Access-Control-Allow-Origin': origin,
		'Access-Control-Allow-Methods': 'GET, OPTIONS',
		'Access-Control-Allow-Headers': 'Authorization',
	};
}

function json(data: unknown, init: ResponseInit = {}): Response {
	return new Response(JSON.stringify(data), {
		...init,
		headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
	});
}

async function handleLogin(request: Request): Promise<Response> {
	const workerOrigin = new URL(request.url).origin;
	const params = new URLSearchParams({
		'openid.ns': 'http://specs.openid.net/auth/2.0',
		'openid.mode': 'checkid_setup',
		'openid.return_to': `${workerOrigin}/auth/steam/callback`,
		'openid.realm': workerOrigin,
		'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
		'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
	});
	return Response.redirect(`${STEAM_OPENID_ENDPOINT}?${params.toString()}`, 302);
}

async function verifyWithSteam(query: URLSearchParams): Promise<boolean> {
	const verifyParams = new URLSearchParams(query);
	verifyParams.set('openid.mode', 'check_authentication');

	const response = await fetch(STEAM_OPENID_ENDPOINT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: verifyParams.toString(),
	});
	const body = await response.text();
	return /is_valid\s*:\s*true/.test(body);
}

function extractSteamId(claimedId: string | null): string | null {
	if (!claimedId) return null;
	const match = claimedId.match(/^https?:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/);
	return match ? match[1] : null;
}

interface SteamProfile {
	steamid: string;
	personaname: string;
	avatar: string;
	avatarfull: string;
	profileurl: string;
}

async function fetchSteamProfile(steamId: string, apiKey: string): Promise<SteamProfile | null> {
	const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=${steamId}`;
	const response = await fetch(url);
	if (!response.ok) return null;
	const data = (await response.json()) as { response?: { players?: SteamProfile[] } };
	return data.response?.players?.[0] ?? null;
}

async function handleCallback(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);

	if (url.searchParams.get('openid.mode') !== 'id_res') {
		return json({ error: 'unexpected openid.mode' }, { status: 400 });
	}

	const isValid = await verifyWithSteam(url.searchParams);
	if (!isValid) {
		return json({ error: 'steam assertion failed verification' }, { status: 401 });
	}

	const steamId = extractSteamId(url.searchParams.get('openid.claimed_id'));
	if (!steamId) {
		return json({ error: 'could not extract steamid' }, { status: 400 });
	}

	const profile = await fetchSteamProfile(steamId, env.STEAM_API_KEY);

	const token = await new SignJWT({
		steamid: steamId,
		personaname: profile?.personaname ?? null,
		avatar: profile?.avatarfull ?? null,
	})
		.setProtectedHeader({ alg: 'HS256' })
		.setIssuedAt()
		.setExpirationTime(`${SESSION_TTL_SECONDS}s`)
		.sign(new TextEncoder().encode(env.JWT_SECRET));

	const redirectUrl = new URL(env.FRONTEND_REDIRECT_URL);
	redirectUrl.hash = `token=${token}`;
	return Response.redirect(redirectUrl.toString(), 302);
}

async function handleMe(request: Request, env: Env): Promise<Response> {
	const headers = corsHeaders(env.FRONTEND_ORIGIN);
	const auth = request.headers.get('Authorization');
	const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;

	if (!token) {
		return json({ error: 'missing bearer token' }, { status: 401, headers });
	}

	try {
		const { payload } = await jwtVerify(token, new TextEncoder().encode(env.JWT_SECRET));
		return json(
			{
				steamid: payload.steamid,
				personaname: payload.personaname,
				avatar: payload.avatar,
			},
			{ headers },
		);
	} catch {
		return json({ error: 'invalid or expired token' }, { status: 401, headers });
	}
}

// Steam64 -> Steam32 (Dota match APIs key off the 32-bit account id)
function steamIdToAccountId(steamid: string): string {
	return (BigInt(steamid) - 76561197960265728n).toString();
}

interface OpenDotaRecentMatch {
	match_id: number;
	hero_id: number;
	kills: number;
	deaths: number;
	assists: number;
	duration: number;
	game_mode: number;
	player_slot: number;
	radiant_win: boolean;
	start_time: number;
}

const RECENT_MATCHES_LIMIT = 5;

const CACHE_TTL_SECONDS = 30 * 60; // 30 minutes — shared by both D1 caches below
const ROLE_SAMPLE_SIZE = 20;
const MIN_CLASSIFIED_MATCHES = 8;

// Near-exclusively support/utility items regardless of how farmed the buyer ends up —
// cross-referenced against data/items.json, not guessed. Extend the same way if needed.
const SUPPORT_ITEM_IDS = new Set([
	79, // Mekansm
	100, // Eul's Scepter of Divinity (cyclone)
	102, // Force Staff
	226, // Lotus Orb
	231, // Guardian Greaves
	254, // Glimmer Cape
	1466, // Gleipnir (gungir)
]);

// Valve's own "Support" role tag per hero, from data/heroes.json (same file the
// frontend already uses for hero names/icons). Deliberately NOT used alone —
// verified against real match data that doing so misfires both ways: a
// support-tagged hero having a clearly core-shaped game (high farm, no support
// items) shouldn't be called support just because the hero *can* flex that way,
// and a support-coded hero with zero tracked items still needs corroborating
// evidence (low relative farm) before the tag counts for anything. See
// isSupportCandidate below for how the two signals are combined.
const HERO_SUPPORT_IDS = new Set(
	(heroesData as { id: number; roles: string[] }[]).filter((h) => h.roles.includes('Support')).map((h) => h.id),
);

type RoleBucket = 'Carry' | 'Mid' | 'Offlane' | 'Soft Support' | 'Hard Support';

interface OpenDotaWL {
	win: number;
	lose: number;
}

interface OpenDotaTotalsEntry {
	field: string;
	n: number;
	sum: number;
}

interface OpenDotaMatchIdEntry {
	match_id: number;
}

interface OpenDotaMatchPlayer {
	account_id: number | null;
	player_slot: number;
	hero_id: number;
	gold_per_min: number;
	item_0: number;
	item_1: number;
	item_2: number;
	item_3: number;
	item_4: number;
	item_5: number;
}

interface OpenDotaMatchDetail {
	match_id: number;
	players: OpenDotaMatchPlayer[];
}

interface PlayerStatsRow {
	account_id: string;
	steamid: string;
	wins: number;
	losses: number;
	kills_sum: number;
	deaths_sum: number;
	assists_sum: number;
	kda_n: number;
	preferred_role: string | null;
	preferred_role_games: number | null;
	last_refreshed_at: number;
}

// Classifies a single match into a role bucket for the given account, using only
// match-performance data (farm rank among that game's 5 teammates, plus whether a
// support-only item shows up in the final build) — never hero identity, since the
// same hero can be played in wildly different roles from one pub game to the next.
function supportItemCount(p: OpenDotaMatchPlayer): number {
	const items = [p.item_0, p.item_1, p.item_2, p.item_3, p.item_4, p.item_5];
	return items.filter((id) => SUPPORT_ITEM_IDS.has(id)).length;
}

// v1 ranked the whole team by gold_per_min and mapped rank 4/5 straight onto
// Soft/Hard Support. Verified against real match data, that's unreliable: a
// core having a bad farming game can easily out-rank (i.e. under-rank) the
// actual support in GPM without being one, since farm OUTCOME doesn't track
// assigned position — especially for pick/kill-securing support heroes, whose
// kill participation inflates their GPM above a struggling core's. In every
// misclassified case checked, the teammate with lower GPM than the real
// support carried zero support items — they just had a bad game, they weren't
// the support. So: identify the support pool by itemization first, and only
// ever compare farm within that pool (or within the remaining core players),
// never across the two.
//
// v2 added Valve's hero "Support" tag as a second signal — but not alone, and
// not unconditionally. Verified against more real match data: a single support
// item from a non-support hero (a struggling core buying one defensive item)
// shouldn't outrank a genuine support with zero tracked items, but a
// support-tagged hero with high relative farm and zero items (i.e. clearly
// played as a core that game) shouldn't get pulled in either — Wraith King is
// tagged Support but a 592 GPM, 2nd-highest-farm-on-team game is not that.
// So the hero tag only ever corroborates: it substitutes for a missing item
// when the player's raw farm is already in the bottom half of their team, and
// it never overrides an already-strong item signal from someone else.
function isSupportCandidate(p: OpenDotaMatchPlayer, team: OpenDotaMatchPlayer[]): boolean {
	const items = supportItemCount(p);
	if (items >= 2) return true;
	if (items >= 1 && HERO_SUPPORT_IDS.has(p.hero_id)) return true;
	if (items === 0 && HERO_SUPPORT_IDS.has(p.hero_id)) {
		const rawRank = [...team].sort((a, b) => b.gold_per_min - a.gold_per_min).indexOf(p) + 1;
		return rawRank >= 4; // bottom half of the team by raw farm
	}
	return false;
}

function classifyMatchRole(match: OpenDotaMatchDetail, accountId: number): RoleBucket | null {
	const me = match.players.find((p) => p.account_id === accountId);
	if (!me) return null;

	const isRadiant = me.player_slot < 128;
	const team = match.players.filter((p) => p.player_slot < 128 === isRadiant);
	if (team.length < 5) return null;

	const isMe = (p: OpenDotaMatchPlayer) => p.account_id === accountId;

	// More support items wins outright; gold_per_min only breaks ties on item
	// count — never overrides it (that reintroduces the exact confound above).
	const supportPriority = (p: OpenDotaMatchPlayer): [number, number] => [-supportItemCount(p), p.gold_per_min];
	const compareSupportPriority = (a: OpenDotaMatchPlayer, b: OpenDotaMatchPlayer) => {
		const [countA, gpmA] = supportPriority(a);
		const [countB, gpmB] = supportPriority(b);
		return countA - countB || gpmA - gpmB;
	};

	const supportCandidates = team
		.filter((p) => isSupportCandidate(p, team))
		.sort(compareSupportPriority)
		.slice(0, 2); // a draft only ever has 2 support slots

	if (supportCandidates.length === 0) {
		// Nobody shows a support build this game — team-wide farm rank is the
		// only signal left, same as before.
		const rankedByFarm = [...team].sort((a, b) => b.gold_per_min - a.gold_per_min);
		const rank = rankedByFarm.findIndex(isMe) + 1;
		if (rank === 0) return null;
		if (rank === 1) return 'Carry';
		if (rank === 2) return 'Mid';
		if (rank === 3) return 'Offlane';
		return rank === 4 ? 'Soft Support' : 'Hard Support';
	}

	if (supportCandidates.some(isMe)) {
		if (supportCandidates.length === 1) return 'Hard Support';
		const ordered = [...supportCandidates].sort(compareSupportPriority);
		return isMe(ordered[0]) ? 'Hard Support' : 'Soft Support';
	}

	// I'm not one of the identified supports — rank only among the remaining
	// core players, not the whole team, so their farm doesn't drag mine around.
	// (No lane data is available to split rank 2/3 more precisely than
	// Mid/Offlane by convention — this is a known soft spot, not a solved one.)
	const coreTeam = team.filter((p) => !supportCandidates.includes(p));
	const coreRank = [...coreTeam].sort((a, b) => b.gold_per_min - a.gold_per_min).findIndex(isMe) + 1;
	if (coreRank === 0) return null;
	if (coreRank === 1) return 'Carry';
	if (coreRank === 2) return 'Mid';
	return 'Offlane';
}

const OPENDOTA_TIMEOUT_MS = 8000;

// Plain fetch() has no ceiling on how long it'll wait — a single slow/hanging
// OpenDota response would otherwise stall the whole /dota/stats request (and,
// via ctx.waitUntil, the invocation) indefinitely. Every OpenDota call below
// goes through this so a bad response degrades to a timeout, not a hang.
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, { signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

async function fetchOpenDotaWL(accountId: string): Promise<OpenDotaWL> {
	const res = await fetchWithTimeout(`https://api.opendota.com/api/players/${accountId}/wl`, OPENDOTA_TIMEOUT_MS);
	if (!res.ok) throw new Error('opendota wl fetch failed');
	return (await res.json()) as OpenDotaWL;
}

async function fetchOpenDotaTotals(accountId: string): Promise<OpenDotaTotalsEntry[]> {
	const res = await fetchWithTimeout(`https://api.opendota.com/api/players/${accountId}/totals`, OPENDOTA_TIMEOUT_MS);
	if (!res.ok) throw new Error('opendota totals fetch failed');
	const data = (await res.json()) as OpenDotaTotalsEntry[];
	return Array.isArray(data) ? data : [];
}

async function fetchOpenDotaMatchIds(accountId: string): Promise<OpenDotaMatchIdEntry[]> {
	const res = await fetchWithTimeout(
		`https://api.opendota.com/api/players/${accountId}/matches?limit=${ROLE_SAMPLE_SIZE}&project=match_id`,
		OPENDOTA_TIMEOUT_MS,
	);
	if (!res.ok) throw new Error('opendota matches fetch failed');
	const data = (await res.json()) as OpenDotaMatchIdEntry[];
	return Array.isArray(data) ? data : [];
}

async function fetchOpenDotaMatchDetail(matchId: number): Promise<OpenDotaMatchDetail | null> {
	try {
		const res = await fetchWithTimeout(`https://api.opendota.com/api/matches/${matchId}`, OPENDOTA_TIMEOUT_MS);
		if (!res.ok) return null;
		return (await res.json()) as OpenDotaMatchDetail;
	} catch {
		return null;
	}
}

async function fetchAndComputeStats(accountId: string, steamid: string, now: number): Promise<PlayerStatsRow> {
	const [wl, totals, matchIds] = await Promise.all([
		fetchOpenDotaWL(accountId),
		fetchOpenDotaTotals(accountId),
		fetchOpenDotaMatchIds(accountId),
	]);

	const matchDetails = await Promise.all(matchIds.map((m) => fetchOpenDotaMatchDetail(m.match_id)));
	const successfulDetails = matchDetails.filter((m): m is OpenDotaMatchDetail => m !== null);

	// Distinguish "OpenDota's per-match endpoint is failing" from "this player just
	// doesn't have many matches" — only the former should count as a batch failure.
	const failedDetailCount = matchIds.length - successfulDetails.length;
	if (matchIds.length > 0 && failedDetailCount >= 5) {
		throw new Error('too many opendota match-detail fetches failed');
	}

	const numericAccountId = Number(accountId);
	const tally: Record<RoleBucket, number> = { Carry: 0, Mid: 0, Offlane: 0, 'Soft Support': 0, 'Hard Support': 0 };
	for (const match of successfulDetails) {
		const role = classifyMatchRole(match, numericAccountId);
		if (role) tally[role] += 1;
	}

	let preferredRole: string | null = null;
	let preferredRoleGames = 0;
	for (const role of Object.keys(tally) as RoleBucket[]) {
		if (tally[role] > preferredRoleGames) {
			preferredRole = role;
			preferredRoleGames = tally[role];
		}
	}
	if (preferredRoleGames < MIN_CLASSIFIED_MATCHES) {
		preferredRole = null;
		preferredRoleGames = 0;
	}

	// Separate kills/deaths/assists averages, not OpenDota's blended "kda" ratio —
	// presented as an actual K/D/A triplet, same convention as each match row already uses.
	const killsEntry = totals.find((t) => t.field === 'kills');
	const deathsEntry = totals.find((t) => t.field === 'deaths');
	const assistsEntry = totals.find((t) => t.field === 'assists');

	return {
		account_id: accountId,
		steamid,
		wins: wl.win,
		losses: wl.lose,
		kills_sum: killsEntry?.sum ?? 0,
		deaths_sum: deathsEntry?.sum ?? 0,
		assists_sum: assistsEntry?.sum ?? 0,
		kda_n: killsEntry?.n ?? 0, // kills/deaths/assists are always co-present per match, so share one n
		preferred_role: preferredRole,
		preferred_role_games: preferredRoleGames,
		last_refreshed_at: now,
	};
}

async function upsertPlayerStats(db: D1Database, row: PlayerStatsRow): Promise<void> {
	await db
		.prepare(
			`INSERT INTO player_stats (account_id, steamid, wins, losses, kills_sum, deaths_sum, assists_sum, kda_n, preferred_role, preferred_role_games, last_refreshed_at)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
			 ON CONFLICT(account_id) DO UPDATE SET
			   steamid = excluded.steamid,
			   wins = excluded.wins,
			   losses = excluded.losses,
			   kills_sum = excluded.kills_sum,
			   deaths_sum = excluded.deaths_sum,
			   assists_sum = excluded.assists_sum,
			   kda_n = excluded.kda_n,
			   preferred_role = excluded.preferred_role,
			   preferred_role_games = excluded.preferred_role_games,
			   last_refreshed_at = excluded.last_refreshed_at`,
		)
		.bind(
			row.account_id,
			row.steamid,
			row.wins,
			row.losses,
			row.kills_sum,
			row.deaths_sum,
			row.assists_sum,
			row.kda_n,
			row.preferred_role,
			row.preferred_role_games,
			row.last_refreshed_at,
		)
		.run();
}

function statsResponse(row: PlayerStatsRow) {
	const totalGames = row.wins + row.losses;
	const hasKda = row.kda_n > 0;
	return {
		win_rate: totalGames > 0 ? row.wins / totalGames : null,
		wins: row.wins,
		losses: row.losses,
		avg_kills: hasKda ? row.kills_sum / row.kda_n : null,
		avg_deaths: hasKda ? row.deaths_sum / row.kda_n : null,
		avg_assists: hasKda ? row.assists_sum / row.kda_n : null,
		preferred_role: row.preferred_role,
		last_refreshed_at: row.last_refreshed_at,
	};
}

async function handleStats(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const headers = corsHeaders(env.FRONTEND_ORIGIN);
	const auth = request.headers.get('Authorization');
	const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;

	if (!token) {
		return json({ error: 'missing bearer token' }, { status: 401, headers });
	}

	let steamid: string;
	try {
		const { payload } = await jwtVerify(token, new TextEncoder().encode(env.JWT_SECRET));
		steamid = String(payload.steamid);
	} catch {
		return json({ error: 'invalid or expired token' }, { status: 401, headers });
	}

	const accountId = steamIdToAccountId(steamid);
	const now = Math.floor(Date.now() / 1000);

	const cached = await env.DB.prepare('SELECT * FROM player_stats WHERE account_id = ?1')
		.bind(accountId)
		.first<PlayerStatsRow>();

	if (cached && now - cached.last_refreshed_at < CACHE_TTL_SECONDS) {
		return json(statsResponse(cached), { headers });
	}

	try {
		const fresh = await fetchAndComputeStats(accountId, steamid, now);
		ctx.waitUntil(upsertPlayerStats(env.DB, fresh));
		return json(statsResponse(fresh), { headers });
	} catch {
		if (cached) {
			return json(statsResponse(cached), { headers });
		}
		return json({ error: 'failed to load stats' }, { status: 502, headers });
	}
}

interface RecentMatchesCacheRow {
	account_id: string;
	steamid: string;
	matches_json: string;
	last_refreshed_at: number;
}

interface TrimmedMatch {
	match_id: number;
	hero_id: number;
	kills: number;
	deaths: number;
	assists: number;
	duration: number;
	game_mode: number;
	player_slot: number;
	radiant_win: boolean;
	start_time: number;
	role: RoleBucket | null;
}

async function fetchAndComputeRecentMatches(accountId: string): Promise<TrimmedMatch[]> {
	const res = await fetchWithTimeout(
		`https://api.opendota.com/api/players/${accountId}/recentMatches`,
		OPENDOTA_TIMEOUT_MS,
	);
	if (!res.ok) throw new Error('opendota recentMatches fetch failed');
	const matches = (await res.json()) as OpenDotaRecentMatch[];
	if (!Array.isArray(matches)) throw new Error('opendota recentMatches returned unexpected shape');

	const trimmed = matches.slice(0, RECENT_MATCHES_LIMIT);
	const numericAccountId = Number(accountId);
	// Same per-match detail lookup the aggregate role stat uses (needed for
	// teammate GPM and final items) — just applied to 5 matches instead of 20.
	const details = await Promise.all(trimmed.map((m) => fetchOpenDotaMatchDetail(m.match_id)));

	return trimmed.map((m, i) => {
		const detail = details[i];
		return {
			match_id: m.match_id,
			hero_id: m.hero_id,
			kills: m.kills,
			deaths: m.deaths,
			assists: m.assists,
			duration: m.duration,
			game_mode: m.game_mode,
			player_slot: m.player_slot,
			radiant_win: m.radiant_win,
			start_time: m.start_time,
			role: detail ? classifyMatchRole(detail, numericAccountId) : null,
		};
	});
}

async function upsertRecentMatches(
	db: D1Database,
	accountId: string,
	steamid: string,
	matches: TrimmedMatch[],
	now: number,
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO recent_matches_cache (account_id, steamid, matches_json, last_refreshed_at)
			 VALUES (?1, ?2, ?3, ?4)
			 ON CONFLICT(account_id) DO UPDATE SET
			   steamid = excluded.steamid,
			   matches_json = excluded.matches_json,
			   last_refreshed_at = excluded.last_refreshed_at`,
		)
		.bind(accountId, steamid, JSON.stringify(matches), now)
		.run();
}

async function handleRecentMatches(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const headers = corsHeaders(env.FRONTEND_ORIGIN);
	const auth = request.headers.get('Authorization');
	const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;

	if (!token) {
		return json({ error: 'missing bearer token' }, { status: 401, headers });
	}

	let steamid: string;
	try {
		const { payload } = await jwtVerify(token, new TextEncoder().encode(env.JWT_SECRET));
		steamid = String(payload.steamid);
	} catch {
		return json({ error: 'invalid or expired token' }, { status: 401, headers });
	}

	const accountId = steamIdToAccountId(steamid);
	const now = Math.floor(Date.now() / 1000);

	const cached = await env.DB.prepare('SELECT * FROM recent_matches_cache WHERE account_id = ?1')
		.bind(accountId)
		.first<RecentMatchesCacheRow>();

	if (cached && now - cached.last_refreshed_at < CACHE_TTL_SECONDS) {
		return json({ matches: JSON.parse(cached.matches_json) }, { headers });
	}

	try {
		const fresh = await fetchAndComputeRecentMatches(accountId);
		ctx.waitUntil(upsertRecentMatches(env.DB, accountId, steamid, fresh, now));
		return json({ matches: fresh }, { headers });
	} catch {
		// Same fallback shape the original uncached handler always returned on
		// failure — the frontend's empty-state already handles `matches: []`.
		if (cached) {
			return json({ matches: JSON.parse(cached.matches_json) }, { headers });
		}
		return json({ matches: [] }, { headers });
	}
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders(env.FRONTEND_ORIGIN) });
		}

		if (url.pathname === '/auth/steam/login') {
			return handleLogin(request);
		}
		if (url.pathname === '/auth/steam/callback') {
			return handleCallback(request, env);
		}
		if (url.pathname === '/auth/me') {
			return handleMe(request, env);
		}
		if (url.pathname === '/dota/recent-matches') {
			return handleRecentMatches(request, env, ctx);
		}
		if (url.pathname === '/dota/stats') {
			return handleStats(request, env, ctx);
		}

		return new Response('Not found', { status: 404 });
	},
} satisfies ExportedHandler<Env>;
