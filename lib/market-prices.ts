export const PRICE_SOURCE = 'CoinGecko Demo API market_chart';
export const PRICE_SOURCE_IDENTIFIERS = {
	SUI: 'sui',
	WAL: 'walrus-2',
	DEEP: 'deep',
	CETUS: 'cetus-protocol',
	NAVX: 'navi',
} as const;

export interface PricePoint {
	timestampMs: number;
	priceUsd: number;
}

export interface MarketSeries {
	asset: keyof typeof PRICE_SOURCE_IDENTIFIERS;
	identifier: string;
	points: PricePoint[];
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const API_BASE = 'https://api.coingecko.com/api/v3';
const REQUEST_TIMEOUT_MS = 20_000;

async function fetchJson(url: string): Promise<unknown> {
	for (let attempt = 0; attempt < 4; attempt += 1) {
		let response: Response;
		try {
			response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
		} catch (error: unknown) {
			const detail = error instanceof Error ? error.message : String(error);
			throw new Error(`CoinGecko request failed or timed out after ${REQUEST_TIMEOUT_MS}ms: ${detail}`);
		}
		if (response.ok) return response.json();
		if (response.status === 429 && attempt < 3) {
			const retryAfter = Number(response.headers.get('retry-after'));
			await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 12_000 * (attempt + 1));
			continue;
		}
		throw new Error(`CoinGecko request failed (${response.status}): ${await response.text()}`);
	}
	throw new Error('CoinGecko retry budget exhausted');
}

export async function fetchHourlyHistory(asset: keyof typeof PRICE_SOURCE_IDENTIFIERS): Promise<MarketSeries> {
	const identifier = PRICE_SOURCE_IDENTIFIERS[asset];
	const body = (await fetchJson(
		`${API_BASE}/coins/${identifier}/market_chart?vs_currency=usd&days=7&interval=hourly`,
	)) as { prices?: [number, number][] };
	if (!Array.isArray(body.prices)) throw new Error(`CoinGecko returned no price history for ${asset}.`);
	const points = body.prices
		.filter(([timestampMs, priceUsd]) => Number.isFinite(timestampMs) && Number.isFinite(priceUsd) && priceUsd > 0)
		.map(([timestampMs, priceUsd]) => ({ timestampMs, priceUsd }));
	if (points.length < 49) throw new Error(`Insufficient hourly history for ${asset}: ${points.length} points.`);
	return { asset, identifier, points };
}

export async function fetchAllHourlyHistory(): Promise<MarketSeries[]> {
	const series: MarketSeries[] = [];
	for (const asset of Object.keys(PRICE_SOURCE_IDENTIFIERS) as (keyof typeof PRICE_SOURCE_IDENTIFIERS)[]) {
		series.push(await fetchHourlyHistory(asset));
		await sleep(2_000);
	}
	return series;
}

export function latestPoint(series: MarketSeries, nowMs: number, maxStalenessMs: number): PricePoint {
	const point = series.points.at(-1);
	if (!point || nowMs - point.timestampMs > maxStalenessMs) {
		throw new Error(`Stale price history for ${series.asset}.`);
	}
	return point;
}

export function pointAtOrBefore(series: MarketSeries, targetMs: number, maxGapMs: number): PricePoint {
	const point = [...series.points].reverse().find((candidate) => candidate.timestampMs <= targetMs);
	if (!point || targetMs - point.timestampMs > maxGapMs) {
		throw new Error(`No sufficiently close historical price for ${series.asset}.`);
	}
	return point;
}
