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

export const COINGECKO_API_BASE = 'https://api.coingecko.com/api/v3';
export const COINGECKO_REQUEST_TIMEOUT_MS = 45_000;
export const COINGECKO_MAX_ATTEMPTS = 3;
export const COINGECKO_RETRY_BUDGET_MS = 4 * 60 * 1000;
const TRANSIENT_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

type FetchLike = typeof fetch;
type Sleep = (milliseconds: number) => Promise<void>;

export interface CoinGeckoRequestOptions {
	apiKey?: string;
	fetchImpl?: FetchLike;
	sleep?: Sleep;
	random?: () => number;
	now?: () => number;
	timeoutMs?: number;
	maxAttempts?: number;
	retryBudgetMs?: number;
}

const defaultSleep: Sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function configuredApiKey(value = process.env.COINGECKO_API_KEY): string {
	if (!value) throw new Error('Missing required server-side environment variable: COINGECKO_API_KEY');
	return value;
}

function retryAfterMilliseconds(headers: Headers, responseText: string, now: () => number): number | undefined {
	const header = headers.get('retry-after');
	if (header) {
		const seconds = Number(header);
		if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
		const dateMs = Date.parse(header);
		if (Number.isFinite(dateMs)) return Math.max(0, dateMs - now());
	}
	try {
		const parsed = JSON.parse(responseText) as { retry_after?: unknown };
		const seconds = Number(parsed.retry_after);
		if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
	} catch {
		// Non-JSON errors are normal for upstream gateway failures.
	}
	return undefined;
}

function fallbackDelayMilliseconds(attempt: number, random: () => number): number {
	const exponential = 2_000 * 2 ** attempt;
	return Math.round(exponential * (0.75 + random() * 0.5));
}

function errorDetail(responseText: string): string {
	return responseText.replace(/\s+/g, ' ').slice(0, 300) || 'no response body';
}

/** Performs an authenticated CoinGecko Demo request with a bounded retry budget. */
export async function fetchCoinGeckoJson(url: string, options: CoinGeckoRequestOptions = {}): Promise<unknown> {
	const apiKey = configuredApiKey(options.apiKey);
	const fetchImpl = options.fetchImpl ?? fetch;
	const sleep = options.sleep ?? defaultSleep;
	const random = options.random ?? Math.random;
	const now = options.now ?? Date.now;
	const timeoutMs = options.timeoutMs ?? COINGECKO_REQUEST_TIMEOUT_MS;
	const maxAttempts = options.maxAttempts ?? COINGECKO_MAX_ATTEMPTS;
	const retryBudgetMs = options.retryBudgetMs ?? COINGECKO_RETRY_BUDGET_MS;
	const startedAt = now();
	let lastFailure = 'no request was attempted';

	for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
		let response: Response | undefined;
		try {
			response = await fetchImpl(url, {
				headers: { accept: 'application/json', 'x-cg-demo-api-key': apiKey },
				signal: AbortSignal.timeout(timeoutMs),
			});
			if (response.ok) return response.json();
			const responseText = await response.text();
			lastFailure = `HTTP ${response.status}: ${errorDetail(responseText)}`;
			if (!TRANSIENT_HTTP_STATUSES.has(response.status)) throw new Error(`CoinGecko request failed (${lastFailure})`);

			const retryAfter = retryAfterMilliseconds(response.headers, responseText, now);
			const delayMs = retryAfter ?? fallbackDelayMilliseconds(attempt, random);
			if (attempt === maxAttempts - 1 || now() - startedAt + delayMs + timeoutMs > retryBudgetMs) break;
			await sleep(delayMs);
		} catch (error: unknown) {
			if (response) throw error;
			lastFailure = error instanceof Error ? error.message : String(error);
			const delayMs = fallbackDelayMilliseconds(attempt, random);
			if (attempt === maxAttempts - 1 || now() - startedAt + delayMs + timeoutMs > retryBudgetMs) break;
			await sleep(delayMs);
		}
	}
	throw new Error(`CoinGecko transient retry budget exhausted after ${maxAttempts} attempts: ${lastFailure}`);
}

export async function fetchHourlyHistory(asset: keyof typeof PRICE_SOURCE_IDENTIFIERS, options?: CoinGeckoRequestOptions): Promise<MarketSeries> {
	const identifier = PRICE_SOURCE_IDENTIFIERS[asset];
	const body = (await fetchCoinGeckoJson(
		`${COINGECKO_API_BASE}/coins/${identifier}/market_chart?vs_currency=usd&days=7&interval=hourly`,
		options,
	)) as { prices?: [number, number][] };
	if (!Array.isArray(body.prices)) throw new Error(`CoinGecko returned no price history for ${asset}.`);
	const points = body.prices
		.filter(([timestampMs, priceUsd]) => Number.isFinite(timestampMs) && Number.isFinite(priceUsd) && priceUsd > 0)
		.map(([timestampMs, priceUsd]) => ({ timestampMs, priceUsd }))
		.sort((left, right) => left.timestampMs - right.timestampMs);
	if (points.length < 49) throw new Error(`Insufficient hourly history for ${asset}: ${points.length} points.`);
	return { asset, identifier, points };
}

/** Five parallel authenticated requests fit below the worker's shutdown allowance even with retries. */
export function fetchAllHourlyHistory(options?: CoinGeckoRequestOptions): Promise<MarketSeries[]> {
	return Promise.all((Object.keys(PRICE_SOURCE_IDENTIFIERS) as (keyof typeof PRICE_SOURCE_IDENTIFIERS)[]).map((asset) => fetchHourlyHistory(asset, options)));
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
