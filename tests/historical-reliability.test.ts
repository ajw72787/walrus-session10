import assert from 'node:assert/strict';
import test from 'node:test';
import { historicalReliabilityAtIssue, MIN_HORIZON_EVALUATIONS } from '../lib/historical-reliability.ts';
import type { ForecastRecord, HorizonHours } from '../lib/prediction-index.ts';

function record(options: { horizonHours?: HorizonHours; methodVersion?: string; evaluatedAt?: string; correct?: boolean; evidence?: boolean } = {}): ForecastRecord {
	const horizonHours = options.horizonHours ?? 4;
	const evidence = options.evidence ?? true;
	return {
		forecastId: `forecast-${Math.random()}`,
		slotTimestamp: '2026-11-01T00:00:00.000Z',
		createdAt: '2026-11-01T00:00:00.000Z',
		horizonHours,
		maturityTimestamp: '2026-11-01T04:00:00.000Z',
		baselineProxyValue: 100,
		baselineConstituentPricesUsd: { SUI: 1 },
		targetWeightsBps: { SUI: 10_000 },
		direction: 'up',
		confidence: 0.6,
		methodVersion: options.methodVersion ?? 'weighted-momentum-v1',
		priceSource: { provider: 'test', identifiers: { SUI: 'sui' }, sampledAt: { SUI: '2026-11-01T00:00:00.000Z' } },
		state: 'evaluated',
		...(evidence ? { walrus: { memoryId: 'forecast-memory', blobId: 'forecast-blob' } } : {}),
		evaluation: {
			evaluatedAt: options.evaluatedAt ?? '2026-11-01T01:00:00.000Z',
			actualProxyValue: 101,
			actualDirection: 'up',
			correct: options.correct ?? true,
			...(evidence ? { walrus: { memoryId: 'evaluation-memory', blobId: 'evaluation-blob' } } : {}),
		},
	};
}

test('uses only same-horizon, Walrus-evidenced evaluations available at issue time', () => {
	const cutoff = '2026-11-02T00:00:00.000Z';
	const snapshot = historicalReliabilityAtIssue([
		record({ horizonHours: 4, correct: true }),
		record({ horizonHours: 4, correct: false, evaluatedAt: '2026-11-03T00:00:00.000Z' }),
		record({ horizonHours: 12, correct: false }),
		record({ horizonHours: 4, correct: false, evidence: false }),
	], 4, 'weighted-momentum-v1', cutoff);
	assert.equal(snapshot.eligibleEvaluations, 1);
	assert.equal(snapshot.correctEvaluations, 1);
	assert.equal(snapshot.observedAccuracy, 1);
	assert.equal(snapshot.smoothedReliability, 2 / 3);
	assert.equal(snapshot.status, 'insufficient');
	assert.equal(snapshot.cutoffTimestamp, cutoff);
});

test('enters shadow status only after the per-horizon threshold without changing any model output', () => {
	const forecasts = Array.from({ length: MIN_HORIZON_EVALUATIONS }, (_, index) => record({ horizonHours: 12, correct: index % 2 === 0 }));
	const snapshot = historicalReliabilityAtIssue(forecasts, 12, 'weighted-momentum-v1', '2026-11-02T00:00:00.000Z');
	assert.equal(snapshot.status, 'shadow');
	assert.equal(snapshot.eligibleEvaluations, MIN_HORIZON_EVALUATIONS);
	assert.equal(snapshot.correctEvaluations, 6);
	assert.equal(snapshot.observedAccuracy, 0.5);
	assert.equal(snapshot.smoothedReliability, 0.5);
	assert.equal(snapshot.mode, 'shadow');
});

test('isolates method versions and rejects invalid issue timestamps', () => {
	const snapshot = historicalReliabilityAtIssue([record({ methodVersion: 'other-method' })], 4, 'weighted-momentum-v1', '2026-11-02T00:00:00.000Z');
	assert.equal(snapshot.eligibleEvaluations, 0);
	assert.equal(snapshot.observedAccuracy, null);
	assert.equal(snapshot.smoothedReliability, null);
	assert.throws(() => historicalReliabilityAtIssue([], 4, 'weighted-momentum-v1', 'not-a-date'), /Invalid reliability cutoff/);
});
