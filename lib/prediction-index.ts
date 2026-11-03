import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type HorizonHours = 4 | 12 | 24;
export type Direction = 'up' | 'down' | 'flat';

export interface WalrusWriteJob {
	idempotencyKey: string;
	submissionStartedAt: string;
	jobId?: string;
	acceptedAt?: string;
	terminalStatus?: 'failed' | 'not_found';
	terminalError?: string;
}

export interface HistoricalReliabilitySnapshot {
	version: 'walrus-horizon-reliability-v1';
	mode: 'shadow';
	horizonHours: HorizonHours;
	cutoffTimestamp: string;
	eligibleEvaluations: number;
	correctEvaluations: number;
	observedAccuracy: number | null;
	smoothedReliability: number | null;
	status: 'insufficient' | 'shadow';
}

export interface ForecastRecord {
	forecastId: string;
	slotTimestamp: string;
	createdAt: string;
	horizonHours: HorizonHours;
	maturityTimestamp: string;
	baselineProxyValue: number;
	baselineConstituentPricesUsd: Record<string, number>;
	targetWeightsBps: Record<string, number>;
	direction: Direction;
	confidence: number;
	methodVersion: string;
	historicalReliability?: HistoricalReliabilitySnapshot;
	priceSource: { provider: string; identifiers: Record<string, string>; sampledAt: Record<string, string> };
	state:
		| 'prepared'
		| 'forecast_submission_unknown'
		| 'forecast_write_pending'
		| 'forecast_write_failed'
		| 'pending'
		| 'evaluation_submission_unknown'
		| 'evaluation_write_unknown'
		| 'evaluation_write_failed'
		| 'evaluated';
	walrus?: { memoryId: string; blobId: string };
	walrusWrite?: WalrusWriteJob;
	evaluation?: {
		evaluatedAt: string;
		actualProxyValue: number;
		actualDirection: Direction;
		correct: boolean;
		walrus?: { memoryId: string; blobId: string };
		walrusWrite?: WalrusWriteJob;
	};
}

interface PredictionIndex {
	version: 1;
	forecasts: ForecastRecord[];
}

export const INDEX_PATH = join(process.cwd(), 'data', 'prediction-index.json');
const LOCK_PATH = join(process.cwd(), 'data', 'prediction-worker.lock');

const emptyIndex = (): PredictionIndex => ({ version: 1, forecasts: [] });

export async function readIndex(path = INDEX_PATH): Promise<PredictionIndex> {
	try {
		const parsed = JSON.parse(await readFile(path, 'utf8')) as PredictionIndex;
		if (parsed.version !== 1 || !Array.isArray(parsed.forecasts)) throw new Error('unsupported index schema');
		return parsed;
	} catch (error: unknown) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyIndex();
		throw error;
	}
}

export async function writeIndex(index: PredictionIndex, path = INDEX_PATH): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(temporaryPath, `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 });
	await rename(temporaryPath, path);
}

export async function updateIndex(
	mutator: (index: PredictionIndex) => void,
	path = INDEX_PATH,
): Promise<PredictionIndex> {
	const index = await readIndex(path);
	mutator(index);
	await writeIndex(index, path);
	return index;
}

export async function acquireWorkerLock(): Promise<() => Promise<void>> {
	await mkdir(dirname(LOCK_PATH), { recursive: true });
	let handle: Awaited<ReturnType<typeof open>>;
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			handle = await open(LOCK_PATH, 'wx', 0o600);
			await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
			break;
		} catch (error: unknown) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
			const stale = await lockBelongsToDeadProcess();
			if (!stale || attempt === 1) {
				throw new Error(`Worker lock exists at ${LOCK_PATH}; refusing overlapping run.`);
			}
			await unlink(LOCK_PATH).catch(() => undefined);
		}
	}
	if (!handle!) throw new Error(`Unable to acquire worker lock at ${LOCK_PATH}`);
	return async () => {
		await handle.close();
		await unlink(LOCK_PATH).catch(() => undefined);
	};
}

async function lockBelongsToDeadProcess(): Promise<boolean> {
	try {
		const lock = JSON.parse(await readFile(LOCK_PATH, 'utf8')) as { pid?: unknown };
		if (!Number.isInteger(lock.pid) || typeof lock.pid !== 'number' || lock.pid <= 0) return false;
		try {
			process.kill(lock.pid, 0);
			return false;
		} catch (error: unknown) {
			return (error as NodeJS.ErrnoException).code === 'ESRCH';
		}
	} catch {
		return false;
	}
}

export function forecastId(slotTimestamp: Date, horizonHours: HorizonHours, methodVersion: string): string {
	return `suix5-${methodVersion}-${slotTimestamp.toISOString()}-${horizonHours}h`;
}

export function slotFor(date: Date): Date {
	const slot = new Date(date);
	slot.setUTCMinutes(0, 0, 0);
	slot.setUTCHours(Math.floor(slot.getUTCHours() / 4) * 4);
	return slot;
}
