import { describe, expect, it } from 'vitest';
import { classifyMatchRole, selectPreferredRole } from '../src/index';
import type { OpenDotaMatchDetail, OpenDotaMatchPlayer, RoleBucket } from '../src/index';

// Farm-rank descending gold_per_min values, indexed by rank 1..5.
const RANK_GPM = [500, 400, 300, 200, 100];

// Builds a 5-player team where `meAccountId` occupies farm rank `meRank` (1 = highest
// gold_per_min on the team, 5 = lowest). Other four teammates fill the remaining ranks
// with distinct account ids and no items/lane_role.
function buildMatch(meAccountId: number, meRank: 1 | 2 | 3 | 4 | 5, overrides: Partial<OpenDotaMatchPlayer> = {}): OpenDotaMatchDetail {
	const teammateIds = [9001, 9002, 9003, 9004, 9005];
	const players: OpenDotaMatchPlayer[] = [];
	for (let i = 0; i < 5; i++) {
		const rank = i + 1;
		const base: OpenDotaMatchPlayer = {
			account_id: rank === meRank ? meAccountId : teammateIds[i],
			player_slot: i,
			gold_per_min: RANK_GPM[i],
			lane_role: null,
			item_0: 0,
			item_1: 0,
			item_2: 0,
			item_3: 0,
			item_4: 0,
			item_5: 0,
		};
		players.push(rank === meRank ? { ...base, ...overrides } : base);
	}
	return { match_id: 1, players };
}

const SUPPORT_ITEM = 102; // Force Staff, a member of SUPPORT_ITEM_IDS

describe('classifyMatchRole', () => {
	it('rank 1, no support item, unparsed -> Carry', () => {
		expect(classifyMatchRole(buildMatch(1, 1), 1)).toBe('Carry');
	});

	it('rank 2, no support item, unparsed -> Mid', () => {
		expect(classifyMatchRole(buildMatch(1, 2), 1)).toBe('Mid');
	});

	it('rank 3, no support item, unparsed -> Offlane', () => {
		expect(classifyMatchRole(buildMatch(1, 3), 1)).toBe('Offlane');
	});

	it('rank 4, no support item, unparsed -> Soft Support (rank fallback)', () => {
		expect(classifyMatchRole(buildMatch(1, 4), 1)).toBe('Soft Support');
	});

	it('rank 5, no support item, unparsed -> Hard Support (rank fallback)', () => {
		expect(classifyMatchRole(buildMatch(1, 5), 1)).toBe('Hard Support');
	});

	it('rank 4, unparsed, holding a support item -> still Soft Support', () => {
		expect(classifyMatchRole(buildMatch(1, 4, { item_0: SUPPORT_ITEM }), 1)).toBe('Soft Support');
	});

	it('rank 4 with lane_role 1 (Safe) -> Hard Support, overriding the rank fallback', () => {
		expect(classifyMatchRole(buildMatch(1, 4, { lane_role: 1 }), 1)).toBe('Hard Support');
	});

	it('rank 5 with lane_role 3 (Off) -> Soft Support, overriding the rank fallback', () => {
		expect(classifyMatchRole(buildMatch(1, 5, { lane_role: 3 }), 1)).toBe('Soft Support');
	});

	it('support-item holder at rank 1-3 ("farmed support"), unparsed -> Soft Support default', () => {
		expect(classifyMatchRole(buildMatch(1, 1, { item_0: SUPPORT_ITEM }), 1)).toBe('Soft Support');
	});

	it('support-tier player with lane_role 2 (Mid) falls through to rank fallback', () => {
		expect(classifyMatchRole(buildMatch(1, 5, { lane_role: 2 }), 1)).toBe('Hard Support');
	});

	it('support-tier player with lane_role 4 (Jungle) falls through to rank fallback', () => {
		expect(classifyMatchRole(buildMatch(1, 4, { lane_role: 4 }), 1)).toBe('Soft Support');
	});

	it('rank 1-3 with an irrelevant lane_role present is still a core classification', () => {
		expect(classifyMatchRole(buildMatch(1, 2, { lane_role: 2 }), 1)).toBe('Mid');
	});

	it('player not found in match.players -> null', () => {
		expect(classifyMatchRole(buildMatch(1, 1), 999)).toBeNull();
	});

	it('fewer than 5 players on the team -> null', () => {
		const match = buildMatch(1, 1);
		match.players = match.players.filter((p) => p.player_slot < 3);
		expect(classifyMatchRole(match, 1)).toBeNull();
	});
});

describe('selectPreferredRole', () => {
	function tally(overrides: Partial<Record<RoleBucket, number>>): Record<RoleBucket, number> {
		return {
			Carry: 0,
			Mid: 0,
			Offlane: 0,
			'Soft Support': 0,
			'Hard Support': 0,
			...overrides,
		};
	}

	it('a bucket clearing the threshold outright wins, no fallback triggered', () => {
		const result = selectPreferredRole(tally({ Carry: 10, Mid: 2, Offlane: 1, 'Soft Support': 3, 'Hard Support': 4 }));
		expect(result).toEqual({ role: 'Carry', games: 10 });
	});

	it('neither support flavor alone reaches the threshold, but combined does -> coarse Support', () => {
		const result = selectPreferredRole(tally({ Carry: 5, 'Soft Support': 4, 'Hard Support': 5 }));
		expect(result).toEqual({ role: 'Support', games: 9 });
	});

	it('combined support also falls short of the threshold -> not enough data', () => {
		const result = selectPreferredRole(tally({ Carry: 5, 'Soft Support': 3, 'Hard Support': 3 }));
		expect(result).toEqual({ role: null, games: 0 });
	});

	it('Hard Support alone clearing the threshold wins directly, not overridden by the fallback', () => {
		const result = selectPreferredRole(tally({ 'Hard Support': 8 }));
		expect(result).toEqual({ role: 'Hard Support', games: 8 });
	});

	it('all buckets under threshold and zero support games -> not enough data', () => {
		const result = selectPreferredRole(tally({ Carry: 5, Mid: 5 }));
		expect(result).toEqual({ role: null, games: 0 });
	});
});
