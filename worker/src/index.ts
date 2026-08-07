import { SignJWT, jwtVerify } from 'jose';

export interface Env {
	STEAM_API_KEY: string;
	JWT_SECRET: string;
	FRONTEND_ORIGIN: string;
	FRONTEND_REDIRECT_URL: string;
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

async function handleRecentMatches(request: Request, env: Env): Promise<Response> {
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
	const response = await fetch(
		`https://api.opendota.com/api/players/${accountId}/recentMatches`,
	);

	if (!response.ok) {
		return json({ matches: [] }, { headers });
	}

	const matches = (await response.json()) as OpenDotaRecentMatch[];
	if (!Array.isArray(matches)) {
		return json({ matches: [] }, { headers });
	}

	const trimmed = matches.slice(0, RECENT_MATCHES_LIMIT).map((m) => ({
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
	}));

	return json({ matches: trimmed }, { headers });
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
			return handleRecentMatches(request, env);
		}

		return new Response('Not found', { status: 404 });
	},
} satisfies ExportedHandler<Env>;
