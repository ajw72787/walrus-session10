import type { Direction, HorizonHours } from './prediction-index.ts';
import { latestPoint, pointAtOrBefore, type MarketSeries } from './market-prices.ts';

export const METHOD_VERSION = 'weighted-momentum-v1';
const MAX_STALENESS_MS = 2 * 60 * 60 * 1000;
const MAX_HISTORICAL_GAP_MS = 2 * 60 * 60 * 1000;

export interface ForecastCalculation {
	direction: Direction;
	confidence: number;
	baselineProxyValue: number;
	baselinePrices: Record<string, number>;
	sampledAt: Record<string, string>;
	inputs: { weightedMomentum: number; weightedVolatility: number; score: number; calibration: string };
}

function standardDeviation(values: number[]): number {
	const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
	return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

export function calculateForecast(
	series: MarketSeries[],
	weightsBps: Record<string, number>,
	horizonHours: HorizonHours,
	nowMs: number,
	_priorEvaluations: { correct: boolean }[],
): ForecastCalculation {
	const expectedAssets = Object.keys(weightsBps).sort();
	if (expectedAssets.join(',') !== series.map((item) => item.asset).sort().join(',')) {
		throw new Error('On-chain constituents do not match available price history.');
	}
	const baselinePrices: Record<string, number> = {};
	const sampledAt: Record<string, string> = {};
	let weightedMomentum = 0;
	let weightedVolatility = 0;
	for (const item of series) {
		const latest = latestPoint(item, nowMs, MAX_STALENESS_MS);
		const comparison = pointAtOrBefore(item, latest.timestampMs - horizonHours * 60 * 60 * 1000, MAX_HISTORICAL_GAP_MS);
		const dailyStart = latest.timestampMs - 24 * 60 * 60 * 1000;
		const hourly = item.points.filter((point) => point.timestampMs >= dailyStart && point.timestampMs <= latest.timestampMs);
		if (hourly.length < 20) throw new Error(`Insufficient 24h volatility inputs for ${item.asset}.`);
		const returns = hourly.slice(1).map((point, index) => Math.log(point.priceUsd / hourly[index].priceUsd));
		const weight = weightsBps[item.asset] / 10_000;
		weightedMomentum += weight * Math.log(latest.priceUsd / comparison.priceUsd);
		weightedVolatility += weight * standardDeviation(returns);
		baselinePrices[item.asset] = latest.priceUsd;
		sampledAt[item.asset] = new Date(latest.timestampMs).toISOString();
	}
	const score = weightedMomentum / Math.max(weightedVolatility, 0.0005);
	const direction: Direction = score > 0.15 ? 'up' : score < -0.15 ? 'down' : 'flat';
	const rawConfidence = Math.min(0.85, 0.5 + Math.min(0.3, Math.abs(score) * 0.08));
	return {
		direction,
		// Pooled cross-horizon calibration is deliberately disabled. Per-horizon
		// Walrus-backed reliability is recorded separately in shadow mode.
		confidence: rawConfidence,
		baselineProxyValue: 100,
		baselinePrices,
		sampledAt,
		inputs: { weightedMomentum, weightedVolatility, score, calibration: 'disabled (shadow-only horizon reliability)' },
	};
}

export function proxyValue(baselinePrices: Record<string, number>, latestPrices: Record<string, number>, weightsBps: Record<string, number>): number {
	return Object.entries(weightsBps).reduce(
		(sum, [asset, weight]) => sum + (weight / 10_000) * (latestPrices[asset] / baselinePrices[asset]) * 100,
		0,
	);
}

export function directionForProxy(value: number): Direction {
	return value > 100.05 ? 'up' : value < 99.95 ? 'down' : 'flat';
}
