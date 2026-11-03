import { WalrusMemoryAdapter } from '../lib/memwal.ts';
import { calculateForecast, directionForProxy, METHOD_VERSION, proxyValue } from '../lib/forecast.ts';
import { fetchAllHourlyHistory, latestPoint, PRICE_SOURCE, PRICE_SOURCE_IDENTIFIERS } from '../lib/market-prices.ts';
import { acquireWorkerLock, forecastId, readIndex, slotFor, updateIndex, type ForecastRecord, type HorizonHours } from '../lib/prediction-index.ts';
import { readActiveSuiX5State } from '../lib/suix5-live.ts';
import { buildPublicSnapshot, writePublicSnapshot } from '../lib/public-snapshot.ts';
import { pollAcceptedWalrusJob } from '../lib/walrus-job-recovery.ts';
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
	const { walrusWrite: _walrusWrite, ...immutable } = record;
	return JSON.stringify({ kind: 'suix5_forecast', immutable: true, ...immutable });
}

function evaluationMemory(record: ForecastRecord): string {
	const { walrusWrite: _walrusWrite, ...evaluation } = record.evaluation ?? {};
	return JSON.stringify({
		kind: 'suix5_forecast_evaluation',
		forecastId: record.forecastId,
		linkedForecastWalrus: record.walrus,
		...evaluation,
	});
}

async function resumeForecastWrite(memory: WalrusMemoryAdapter, record: ForecastRecord): Promise<boolean> {
	if (!record.walrusWrite?.jobId) return false;
	const result = await pollAcceptedWalrusJob(memory, record.walrusWrite);
	if (result.kind === 'pending') {
		console.warn('forecast_walrus_job_still_pending', JSON.stringify({ forecastId: record.forecastId, jobId: record.walrusWrite.jobId }));
		return false;
	}
	if (result.kind === 'terminal_failure') {
		await updateIndex((latest) => {
			const target = latest.forecasts.find((forecast) => forecast.forecastId === record.forecastId);
			if (target?.state === 'forecast_write_pending' && target.walrusWrite?.jobId === record.walrusWrite?.jobId) {
				target.state = 'forecast_write_failed';
				target.walrusWrite!.terminalStatus = result.status;
				target.walrusWrite!.terminalError = result.error;
			}
		});
		console.error('forecast_walrus_job_terminal_failure', JSON.stringify({ forecastId: record.forecastId, jobId: record.walrusWrite.jobId, status: result.status }));
		return false;
	}
	await updateIndex((latest) => {
		const target = latest.forecasts.find((forecast) => forecast.forecastId === record.forecastId);
		if (target?.state === 'forecast_write_pending' && target.walrusWrite?.jobId === record.walrusWrite?.jobId) {
			target.walrus = { memoryId: result.saved.id, blobId: result.saved.blobId };
			target.state = 'pending';
		}
	});
	return true;
}

async function resumeEvaluationWrite(memory: WalrusMemoryAdapter, record: ForecastRecord): Promise<boolean> {
	if (!record.evaluation?.walrusWrite?.jobId) return false;
	const result = await pollAcceptedWalrusJob(memory, record.evaluation.walrusWrite);
	if (result.kind === 'pending') {
		console.warn('evaluation_walrus_job_still_pending', JSON.stringify({ forecastId: record.forecastId, jobId: record.evaluation.walrusWrite.jobId }));
		return false;
	}
	if (result.kind === 'terminal_failure') {
		await updateIndex((latest) => {
			const target = latest.forecasts.find((forecast) => forecast.forecastId === record.forecastId);
			if (target?.state === 'evaluation_write_unknown' && target.evaluation?.walrusWrite?.jobId === record.evaluation?.walrusWrite?.jobId) {
				target.state = 'evaluation_write_failed';
				target.evaluation!.walrusWrite!.terminalStatus = result.status;
				target.evaluation!.walrusWrite!.terminalError = result.error;
			}
		});
		console.error('evaluation_walrus_job_terminal_failure', JSON.stringify({ forecastId: record.forecastId, jobId: record.evaluation.walrusWrite.jobId, status: result.status }));
		return false;
	}
	await updateIndex((latest) => {
		const target = latest.forecasts.find((forecast) => forecast.forecastId === record.forecastId);
		if (target?.state === 'evaluation_write_unknown' && target.evaluation?.walrusWrite?.jobId === record.evaluation?.walrusWrite?.jobId) {
				target.evaluation!.walrus = { memoryId: result.saved.id, blobId: result.saved.blobId };
			target.state = 'evaluated';
		}
	});
	return true;
}

async function submitForecastWrite(memory: WalrusMemoryAdapter, record: ForecastRecord): Promise<boolean> {
	const idempotencyKey = `forecast-${record.forecastId}`;
	await updateIndex((latest) => {
		const target = latest.forecasts.find((forecast) => forecast.forecastId === record.forecastId);
		if (target?.state === 'prepared') {
			target.state = 'forecast_submission_unknown';
			target.walrusWrite = { idempotencyKey, submissionStartedAt: new Date().toISOString() };
		}
	});
	try {
		const accepted = await memory.submitRemember(forecastMemory(record), idempotencyKey);
		await updateIndex((latest) => {
			const target = latest.forecasts.find((forecast) => forecast.forecastId === record.forecastId);
			if (target?.state === 'forecast_submission_unknown' && target.walrusWrite?.idempotencyKey === idempotencyKey) {
				target.walrusWrite.jobId = accepted.jobId;
				target.walrusWrite.acceptedAt = new Date().toISOString();
				target.state = 'forecast_write_pending';
			}
		});
	} catch (error: unknown) {
		console.error('forecast_walrus_submission_unknown', JSON.stringify({ forecastId: record.forecastId, error: error instanceof Error ? error.message : String(error) }));
		return false;
	}
	const latest = (await readIndex()).forecasts.find((forecast) => forecast.forecastId === record.forecastId);
	return latest ? resumeForecastWrite(memory, latest) : false;
}

async function submitEvaluationWrite(memory: WalrusMemoryAdapter, record: ForecastRecord): Promise<boolean> {
	if (!record.evaluation) return false;
	const idempotencyKey = `evaluation-${record.forecastId}`;
	try {
		const accepted = await memory.submitRemember(evaluationMemory(record), idempotencyKey);
		await updateIndex((latest) => {
			const target = latest.forecasts.find((forecast) => forecast.forecastId === record.forecastId);
			if (target?.state === 'evaluation_submission_unknown' && target.evaluation?.walrusWrite?.idempotencyKey === idempotencyKey) {
				target.evaluation.walrusWrite.jobId = accepted.jobId;
				target.evaluation.walrusWrite.acceptedAt = new Date().toISOString();
				target.state = 'evaluation_write_unknown';
			}
		});
	} catch (error: unknown) {
		console.error('evaluation_walrus_submission_unknown', JSON.stringify({ forecastId: record.forecastId, error: error instanceof Error ? error.message : String(error) }));
		return false;
	}
	const latest = (await readIndex()).forecasts.find((forecast) => forecast.forecastId === record.forecastId);
	return latest ? resumeEvaluationWrite(memory, latest) : false;
}

async function reconcilePartialWrites(memory: WalrusMemoryAdapter): Promise<void> {
	const index = await readIndex();
	for (const record of index.forecasts) {
		if (record.state === 'prepared') {
			if (dryRun) {
				console.log('dry_reconcile_forecast', record.forecastId);
				continue;
			}
			await submitForecastWrite(memory, record);
		}
		if (record.state === 'evaluation_write_unknown' && record.evaluation) {
			if (dryRun) {
				console.log('dry_reconcile_evaluation', record.forecastId);
				continue;
			}
			if (!record.evaluation.walrusWrite?.jobId) {
				console.error('evaluation_walrus_job_missing_manual_recovery_required', record.forecastId);
				continue;
			}
			await resumeEvaluationWrite(memory, record);
		}
		if (record.state === 'forecast_write_pending') await resumeForecastWrite(memory, record);
		if (record.state === 'forecast_submission_unknown' || record.state === 'evaluation_submission_unknown') {
			console.error('walrus_submission_unknown_manual_recovery_required', record.forecastId);
		}
	}
}

async function evaluateMatured(memory: WalrusMemoryAdapter, now: Date, series: Awaited<ReturnType<typeof fetchAllHourlyHistory>>): Promise<number> {
	const index = await readIndex();
	const mature = index.forecasts.filter((forecast) => forecast.state === 'pending' && new Date(forecast.maturityTimestamp) <= now);
	let evaluated = 0;
	for (const record of mature) {
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
				target.evaluation = { ...evaluation, walrusWrite: { idempotencyKey: `evaluation-${record.forecastId}`, submissionStartedAt: new Date().toISOString() } };
				target.state = 'evaluation_submission_unknown';
			}
		});
		const current = (await readIndex()).forecasts.find((forecast) => forecast.forecastId === record.forecastId);
		if (current && await submitEvaluationWrite(memory, current)) evaluated += 1;
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
		const series = await fetchAllHourlyHistory();
		const evaluated = await evaluateMatured(memory, now, series);
		const index = await readIndex();
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
			if (await submitForecastWrite(memory, record)) created += 1;
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
