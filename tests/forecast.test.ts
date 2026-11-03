import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateForecast, directionForProxy, proxyValue } from '../lib/forecast.ts';
import { forecastId, slotFor } from '../lib/prediction-index.ts';
import type { MarketSeries } from '../lib/market-prices.ts';

const now = Date.UTC(2026, 10, 2, 12, 0, 0);
const assets = ['SUI', 'WAL', 'DEEP', 'CETUS', 'NAVX'] as const;
const series: MarketSeries[] = assets.map((asset, assetIndex) => ({
	asset,
	identifier: asset.toLowerCase(),
	points: Array.from({ length: 60 }, (_, index) => ({
		timestampMs: now - (59 - index) * 60 * 60 * 1000,
		priceUsd: 1 + assetIndex + index * 0.01,
	})),
}));
const weights = { SUI: 4000, WAL: 3049, DEEP: 1696, CETUS: 930, NAVX: 325 };

test('forecast calculation is deterministic and uses a 100-point basket baseline', () => {
	const result = calculateForecast(series, weights, 4, now, []);
	assert.equal(result.baselineProxyValue, 100);
	assert.equal(result.direction, 'up');
	assert.match(result.inputs.calibration, /disabled/);
});

test('pooled evaluations cannot alter weighted-momentum direction or raw confidence', () => {
	const withoutHistory = calculateForecast(series, weights, 4, now, []);
	const withTwelveIncorrect = calculateForecast(series, weights, 4, now, Array.from({ length: 12 }, () => ({ correct: false })));
	assert.equal(withTwelveIncorrect.direction, withoutHistory.direction);
	assert.equal(withTwelveIncorrect.confidence, withoutHistory.confidence);
	assert.match(withTwelveIncorrect.inputs.calibration, /disabled/);
});

test('proxy value and slot IDs are stable', () => {
	assert.ok(Math.abs(proxyValue({ SUI: 1 }, { SUI: 1.1 }, { SUI: 10_000 }) - 110) < 1e-9);
	assert.equal(directionForProxy(100), 'flat');
	const slot = slotFor(new Date(Date.UTC(2026, 10, 2, 13, 59, 0)));
	assert.equal(slot.toISOString(), '2026-11-02T12:00:00.000Z');
	assert.equal(forecastId(slot, 4, 'weighted-momentum-v1'), 'suix5-weighted-momentum-v1-2026-11-02T12:00:00.000Z-4h');
});
