import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchCoinGeckoJson, fetchHourlyHistory } from '../lib/market-prices.ts';

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

test('sends the CoinGecko Demo key and honours retry_after from a transient gateway response', async () => {
	const responses = [response({ retry_after: 120 }, 504), response({ prices: [] })];
	const sleeps: number[] = [];
	const headers: Headers[] = [];
	const result = await fetchCoinGeckoJson('https://example.invalid/market_chart', {
		apiKey: 'test-demo-key',
		fetchImpl: (async (_url, init) => {
			headers.push(new Headers(init?.headers));
			return responses.shift()!;
		}) as typeof fetch,
		sleep: async (milliseconds) => { sleeps.push(milliseconds); },
		now: () => 0,
	});
	assert.deepEqual(result, { prices: [] });
	assert.equal(headers[0].get('x-cg-demo-api-key'), 'test-demo-key');
	assert.equal(headers[0].get('accept'), 'application/json');
	assert.deepEqual(sleeps, [120_000]);
});

test('retries network timeouts with jittered exponential backoff', async () => {
	let calls = 0;
	const sleeps: number[] = [];
	const result = await fetchCoinGeckoJson('https://example.invalid/market_chart', {
		apiKey: 'test-demo-key',
		fetchImpl: (async () => {
			calls += 1;
			if (calls === 1) throw new DOMException('timed out', 'TimeoutError');
			return response({ ok: true });
		}) as typeof fetch,
		sleep: async (milliseconds) => { sleeps.push(milliseconds); },
		random: () => 0.5,
		now: () => 0,
	});
	assert.deepEqual(result, { ok: true });
	assert.equal(calls, 2);
	assert.deepEqual(sleeps, [2_000]);
});

test('retries every supported transient HTTP status', async () => {
	for (const status of [429, 500, 502, 503, 504]) {
		let calls = 0;
		const result = await fetchCoinGeckoJson('https://example.invalid/market_chart', {
			apiKey: 'test-demo-key',
			fetchImpl: (async () => (++calls === 1 ? response({ error: 'temporary' }, status) : response({ status }))) as typeof fetch,
			sleep: async () => undefined,
			random: () => 0.5,
			now: () => 0,
		});
		assert.deepEqual(result, { status });
		assert.equal(calls, 2);
	}
});

test('does not sleep or retry beyond the configured total retry budget', async () => {
	let calls = 0;
	await assert.rejects(
		() => fetchCoinGeckoJson('https://example.invalid/market_chart', {
			apiKey: 'test-demo-key',
			fetchImpl: (async () => { calls += 1; return response({ retry_after: 120 }, 503); }) as typeof fetch,
			sleep: async () => assert.fail('must not sleep beyond budget'),
			timeoutMs: 45_000,
			retryBudgetMs: 60_000,
			now: () => 0,
		}),
		/transient retry budget exhausted/,
	);
	assert.equal(calls, 1);
});

test('retains insufficient-history validation after an authenticated request', async () => {
	await assert.rejects(
		() => fetchHourlyHistory('SUI', {
			apiKey: 'test-demo-key',
			fetchImpl: (async () => response({ prices: [[1, 1]] })) as typeof fetch,
		}),
		/Insufficient hourly history for SUI: 1 points/,
	);
});
