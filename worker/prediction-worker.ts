import { WalrusMemoryAdapter } from '../lib/memwal.ts';
import { calculateForecast, directionForProxy, METHOD_VERSION, proxyValue } from '../lib/forecast.ts';
import { fetchAllHourlyHistory, latestPoint, PRICE_SOURCE, PRICE_SOURCE_IDENTIFIERS } from '../lib/market-prices.ts';
import { acquireWorkerLock, forecastId, readIndex, slotFor, updateIndex, type ForecastRecord, type HorizonHours } from '../lib/prediction-index.ts';
import { readActiveSuiX5State } from '../lib/suix5-live.ts';
import { buildPublicSnapshot, writePublicSnapshot } from '../lib/public-snapshot.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const HORIZONS: HorizonHours[] = [4, 12, 24];
const dryRun = process.argv.includes('--dry-run');
const exec = promisify(execFile);
let shutdownSignal: string | undefined;

// PM2 may signal the scheduler and its child together. Keep this one-shot
// worker alive long enough to release its atomic lock and finish its current
// immutable-write boundary; the scheduler will not start another child.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.once(signal, () => {
		shutdownSignal = signal;
		console.warn(`Prediction worker received ${signal}; completing the current run before exit.`);
	});
}

function forecastMemory(record: ForecastRecord): string {
	return JSON.stringify({ kind: 'suix5_forecast', immutable: true, ...record });
}

function evaluationMemory(record: ForecastRecord): string {
	return JSON.stringify({
		kind: 'suix5_forecast_evaluation',
		forecastId: record.forecastId,
		linkedForecastWalrus: record.walrus,
		...record.evaluation,
	});
}

async function reconcilePartialWrites(memory: WalrusMemoryAdapter): Promise<void> {
	const index = await readIndex();
	for (const record of index.forecasts) {
		if (record.state === 'prepared') {
			if (dryRun) {
				console.log('dry_reconcile_forecast', record.forecastId);
				continue;
			}
			const saved = await memory.remember(forecastMemory(record), `forecast-${record.forecastId}`);
			await updateIndex((latest) => {
				const target = latest.forecasts.find((forecast) => forecast.forecastId === record.forecastId);
				if (target?.state === 'prepared') {
					target.walrus = { memoryId: saved.id, blobId: saved.blob_id };
					target.state = 'pending';
				}
			});
		}
		if (record.state === 'evaluation_write_unknown' && record.evaluation) {
			if (dryRun) {
				console.log('dry_reconcile_evaluation', record.forecastId);
				continue;
			}
			const saved = await memory.remember(evaluationMemory(record), `evaluation-${record.forecastId}`);
			await updateIndex((latest) => {
				const target = latest.forecasts.find((forecast) => forecast.forecastId === record.forecastId);
				if (target?.state === 'evaluation_write_unknown' && target.evaluation) {
					target.evaluation.walrus = { memoryId: saved.id, blobId: saved.blob_id };
					target.state = 'evaluated';
				}
			});
		}
	}
}

async function evaluateMatured(memory: WalrusMemoryAdapter, now: Date): Promise<number> {
	const index = await readIndex();
	const mature = index.forecasts.filter((forecast) => forecast.state === 'pending' && new Date(forecast.maturityTimestamp) <= now);
	let evaluated = 0;
	for (const record of mature) {
		const series = await fetchAllHourlyHistory();
		const prices = Object.fromEntries(series.map((item) => [item.asset, latestPoint(item, now.getTime(), 2 * 60 * 60 * 1000).priceUsd]));
		const actualProxyValue = proxyValue(record.baselineConstituentPricesUsd, prices, record.targetWeightsBps);
		const actualDirection = directionForProxy(actualProxyValue);
		const evaluation = {
			evaluatedAt: now.toISOString(),
			actualProxyValue,
			actualDirection,
			correct: actualDirection === record.direction,
		};
		if (dryRun) {
			console.log('dry_evaluation', JSON.stringify({ forecastId: record.forecastId, ...evaluation }));
			continue;
		}
		await updateIndex((latest) => {
			const target = latest.forecasts.find((forecast) => forecast.forecastId === record.forecastId);
			if (target?.state === 'pending') {
				target.evaluation = evaluation;
				target.state = 'evaluation_write_unknown';
			}
		});
		const saved = await memory.remember(evaluationMemory({ ...record, evaluation }), `evaluation-${record.forecastId}`);
		await updateIndex((latest) => {
			const target = latest.forecasts.find((forecast) => forecast.forecastId === record.forecastId);
			if (target?.state === 'evaluation_write_unknown' && target.evaluation) {
				target.evaluation.walrus = { memoryId: saved.id, blobId: saved.blob_id };
				target.state = 'evaluated';
			}
		});
		evaluated += 1;
	}
	return evaluated;
}

async function main() {
	const release = await acquireWorkerLock();
	try {
		const now = new Date();
		const state = await readActiveSuiX5State();
		const memory = WalrusMemoryAdapter.fromEnvironment();
		await reconcilePartialWrites(memory);
		const evaluated = await evaluateMatured(memory, now);
		const index = await readIndex();
		const series = await fetchAllHourlyHistory();
		const completed = index.forecasts.filter((forecast) => forecast.state === 'evaluated' && forecast.evaluation).map((forecast) => ({ correct: forecast.evaluation!.correct }));
		const slot = slotFor(now);
		let created = 0;
		for (const horizonHours of HORIZONS) {
			const id = forecastId(slot, horizonHours, METHOD_VERSION);
			if (index.forecasts.some((forecast) => forecast.forecastId === id)) {
				console.log('duplicate_skipped', id);
				continue;
			}
			const calculation = calculateForecast(series, state.weightsBps, horizonHours, now.getTime(), completed);
			const record: ForecastRecord = {
				forecastId: id,
				slotTimestamp: slot.toISOString(),
				createdAt: now.toISOString(),
				horizonHours,
				maturityTimestamp: new Date(now.getTime() + horizonHours * 60 * 60 * 1000).toISOString(),
				baselineProxyValue: calculation.baselineProxyValue,
				baselineConstituentPricesUsd: calculation.baselinePrices,
				targetWeightsBps: state.weightsBps,
				direction: calculation.direction,
				confidence: calculation.confidence,
				methodVersion: METHOD_VERSION,
				priceSource: { provider: PRICE_SOURCE, identifiers: PRICE_SOURCE_IDENTIFIERS, sampledAt: calculation.sampledAt },
				state: 'prepared',
			};
			console.log('forecast', JSON.stringify({ ...record, inputs: calculation.inputs, activeGeneration: state.generation, stateFieldId: state.stateFieldId }));
			if (dryRun) continue;
			await updateIndex((latest) => {
				if (!latest.forecasts.some((forecast) => forecast.forecastId === id)) latest.forecasts.push(record);
			});
			const saved = await memory.remember(forecastMemory(record), `forecast-${id}`);
			await updateIndex((latest) => {
				const target = latest.forecasts.find((forecast) => forecast.forecastId === id);
				if (target?.state === 'prepared') {
					target.walrus = { memoryId: saved.id, blobId: saved.blob_id };
					target.state = 'pending';
				}
			});
			created += 1;
		}
		console.log('run_summary', JSON.stringify({ dryRun, evaluated, created, activeGeneration: state.generation, slot: slot.toISOString() }));
		if (!dryRun) {
			try {
				const snapshot = await buildPublicSnapshot();
				await writePublicSnapshot(snapshot);
				console.log('public_snapshot_refreshed', JSON.stringify({ forecasts: snapshot.summary.totalForecasts, evaluated: snapshot.summary.evaluatedForecasts }));
				if (process.env.ENABLE_PUBLIC_SNAPSHOT_PUBLISH === 'true') {
					await exec(process.execPath, ['--import', 'tsx', 'scripts/publish-public-snapshot.ts'], { cwd: process.cwd(), env: process.env });
				}
			} catch (error: unknown) {
				console.error(`Public snapshot/publish step failed without affecting forecast records: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	} finally {
		await release();
	}
	if (shutdownSignal) console.log(`Prediction worker completed after ${shutdownSignal}.`);
}

main().catch((error: unknown) => {
	console.error(`Prediction worker failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
});
