import assert from 'node:assert/strict';
import test from 'node:test';
import { materiallyEqualSnapshots, validatePublicSnapshot, type PublicSnapshot } from '../lib/public-snapshot.ts';

const snapshot: PublicSnapshot = {
	schemaVersion: 1,
	lastPublishedAt: '2026-11-02T00:00:00.000Z',
	suix5: { generation: '2', targetWeightsBps: { SUI: 4000, WAL: 3049, DEEP: 1696, CETUS: 930, NAVX: 325 }, verifiedAt: '2026-11-02T00:00:00.000Z' },
	forecasts: [{ id: 'forecast-1', issuedAt: '2026-11-02T00:00:00.000Z', maturityAt: '2026-11-02T04:00:00.000Z', horizonHours: 4, direction: 'up', methodVersion: 'weighted-momentum-v1', confidence: { value: 0.6, calibration: 'uncalibrated' }, status: 'pending', evidence: { memoryId: 'memory-id', blobId: 'blob-id' } }],
	summary: { totalForecasts: 1, pendingForecasts: 1, evaluatedForecasts: 0, directionalAccuracy: null },
	dataQuality: { priceSource: 'CoinGecko', latestSourceSampleAt: null, limitations: ['proxy only'] },
};

test('public snapshot accepts only the explicit public shape', () => {
	validatePublicSnapshot(snapshot);
	assert.throws(() => validatePublicSnapshot({ ...snapshot, privateKey: 'not-public' }), /non-public field/);
	assert.throws(() => validatePublicSnapshot({ ...snapshot, forecasts: [{ ...snapshot.forecasts[0], baselineConstituentPricesUsd: { SUI: 1 } }] }), /non-public field/);
});

test('material comparison ignores publication timestamp only', () => {
	const sameContent = { ...snapshot, lastPublishedAt: '2026-11-02T01:00:00.000Z' };
	assert.equal(materiallyEqualSnapshots(snapshot, sameContent), true);
	const changedContent = { ...snapshot, summary: { ...snapshot.summary, pendingForecasts: 0 } };
	assert.equal(materiallyEqualSnapshots(snapshot, changedContent), false);
});
