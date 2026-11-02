import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { readIndex, type ForecastRecord } from './prediction-index.ts';
import { PRICE_SOURCE } from './market-prices.ts';
import { readActiveSuiX5State } from './suix5-live.ts';

export const PUBLIC_SNAPSHOT_PATH = join(process.cwd(), 'public', 'data', 'predictions.json');
export const PUBLIC_SNAPSHOT_SCHEMA_VERSION = 1;

export interface PublicSnapshot {
	schemaVersion: 1;
	lastPublishedAt: string;
	suix5: { generation: string; targetWeightsBps: Record<string, number>; verifiedAt: string } | null;
	forecasts: Array<{
		id: string;
		issuedAt: string;
		maturityAt: string;
		horizonHours: 4 | 12 | 24;
		direction: 'up' | 'down' | 'flat';
		methodVersion: string;
		confidence: { value: number; calibration: 'uncalibrated' | 'calibrated' };
		status: 'pending' | 'evaluated' | 'write_pending';
		evaluation?: { evaluatedAt: string; actualDirection: 'up' | 'down' | 'flat'; correct: boolean; evidence?: { memoryId: string; blobId: string } };
		evidence?: { memoryId: string; blobId: string };
	}>;
	summary: { totalForecasts: number; pendingForecasts: number; evaluatedForecasts: number; directionalAccuracy: number | null };
	dataQuality: { priceSource: string; latestSourceSampleAt: string | null; limitations: string[] };
}

function publicForecast(record: ForecastRecord, calibration: 'uncalibrated' | 'calibrated'): PublicSnapshot['forecasts'][number] {
	const status = record.state === 'evaluated' ? 'evaluated' : record.state === 'pending' ? 'pending' : 'write_pending';
	return {
		id: record.forecastId,
		issuedAt: record.createdAt,
		maturityAt: record.maturityTimestamp,
		horizonHours: record.horizonHours,
		direction: record.direction,
		methodVersion: record.methodVersion,
		confidence: { value: record.confidence, calibration },
		status,
		...(record.evaluation
			? {
				evaluation: {
					evaluatedAt: record.evaluation.evaluatedAt,
					actualDirection: record.evaluation.actualDirection,
					correct: record.evaluation.correct,
					...(record.evaluation.walrus ? { evidence: record.evaluation.walrus } : {}),
				},
			}
			: {}),
		...(record.walrus ? { evidence: record.walrus } : {}),
	};
}

function requireKeys(value: unknown, keys: string[], label: string): asserts value is Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
	for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`${label} contains non-public field: ${key}`);
}

export function validatePublicSnapshot(snapshot: unknown): asserts snapshot is PublicSnapshot {
	requireKeys(snapshot, ['schemaVersion', 'lastPublishedAt', 'suix5', 'forecasts', 'summary', 'dataQuality'], 'snapshot');
	const value = snapshot as Record<string, unknown>;
	if (value.schemaVersion !== PUBLIC_SNAPSHOT_SCHEMA_VERSION || !Array.isArray(value.forecasts)) throw new Error('invalid public snapshot schema');
	for (const forecast of value.forecasts) {
		requireKeys(forecast, ['id', 'issuedAt', 'maturityAt', 'horizonHours', 'direction', 'methodVersion', 'confidence', 'status', 'evaluation', 'evidence'], 'forecast');
		requireKeys((forecast as Record<string, unknown>).confidence, ['value', 'calibration'], 'forecast confidence');
		const evidence = (forecast as Record<string, unknown>).evidence;
		if (evidence !== undefined) requireKeys(evidence, ['memoryId', 'blobId'], 'forecast evidence');
		const evaluation = (forecast as Record<string, unknown>).evaluation;
		if (evaluation !== undefined) {
			requireKeys(evaluation, ['evaluatedAt', 'actualDirection', 'correct', 'evidence'], 'forecast evaluation');
			const evaluationEvidence = (evaluation as Record<string, unknown>).evidence;
			if (evaluationEvidence !== undefined) requireKeys(evaluationEvidence, ['memoryId', 'blobId'], 'evaluation evidence');
		}
	}
}

export function materiallyEqualSnapshots(left: PublicSnapshot, right: PublicSnapshot): boolean {
	const omitTimestamp = ({ lastPublishedAt: _ignored, ...rest }: PublicSnapshot) => rest;
	return JSON.stringify(omitTimestamp(left)) === JSON.stringify(omitTimestamp(right));
}

export async function buildPublicSnapshot(now = new Date()): Promise<PublicSnapshot> {
	const index = await readIndex(); // Invalid or absent index intentionally rejects rather than inventing public data.
	const completed = index.forecasts.filter((forecast) => forecast.state === 'evaluated' && forecast.evaluation);
	const calibration = completed.length >= 12 ? 'calibrated' : 'uncalibrated';
	let suix5: PublicSnapshot['suix5'] = null;
	if (process.env.TATUM_API_KEY) {
		const state = await readActiveSuiX5State();
		suix5 = { generation: state.generation, targetWeightsBps: state.weightsBps, verifiedAt: now.toISOString() };
	}
	const sampledAt = index.forecasts.flatMap((forecast) => Object.values(forecast.priceSource.sampledAt)).sort().at(-1) ?? null;
	const snapshot: PublicSnapshot = {
		schemaVersion: PUBLIC_SNAPSHOT_SCHEMA_VERSION,
		lastPublishedAt: now.toISOString(),
		suix5,
		forecasts: index.forecasts.map((record) => publicForecast(record, calibration)).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)),
		summary: {
			totalForecasts: index.forecasts.length,
			pendingForecasts: index.forecasts.filter((forecast) => forecast.state === 'pending').length,
			evaluatedForecasts: completed.length,
			directionalAccuracy: completed.length ? completed.filter((forecast) => forecast.evaluation!.correct).length / completed.length : null,
		},
		dataQuality: {
			priceSource: PRICE_SOURCE,
			latestSourceSampleAt: sampledAt,
			limitations: [
				'Forecasts use a normalized $100 virtual basket proxy, not redeemable SUIX5 NAV or a token market price.',
				'On-chain NAV is not used while nav_valid is false.',
				'Confidence is uncalibrated until at least 12 evaluated forecasts exist.',
				'Walrus identifiers are persistence evidence; the local operational index is required for deterministic forecast inventory.',
			],
		},
	};
	validatePublicSnapshot(snapshot);
	return snapshot;
}

export async function writePublicSnapshot(snapshot: PublicSnapshot, destination = PUBLIC_SNAPSHOT_PATH): Promise<void> {
	validatePublicSnapshot(snapshot);
	await mkdir(dirname(destination), { recursive: true });
	const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o644 });
	await rename(temporary, destination);
}

export async function readPublicSnapshot(path = PUBLIC_SNAPSHOT_PATH): Promise<PublicSnapshot> {
	const snapshot: unknown = JSON.parse(await readFile(path, 'utf8'));
	validatePublicSnapshot(snapshot);
	return snapshot;
}
