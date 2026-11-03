import { WalrusMemoryAdapter } from '../lib/memwal.ts';
import { readIndex, updateIndex } from '../lib/prediction-index.ts';

const FORECAST_ID = 'suix5-weighted-momentum-v1-2026-11-02T16:00:00.000Z-4h';
const JOB_ID = '0b159d54-2723-4ee7-b2a1-2bb02b47e0c6';
const BLOB_ID = 'ib_gyIo9j62PuuWZxfj5CNupRqsYeDcAKQOrUmQfaWw';
const FORECAST_MEMORY_ID = '5e78fab1-cba1-4f63-adb9-2acdc9593f25';

function assertIncidentRecord(record: Awaited<ReturnType<typeof readIndex>>['forecasts'][number] | undefined): asserts record is NonNullable<typeof record> {
	if (!record || record.forecastId !== FORECAST_ID || record.state !== 'evaluation_write_unknown' || record.walrus?.memoryId !== FORECAST_MEMORY_ID) {
		throw new Error('The index record does not match the known November 3 recovery incident.');
	}
	if (!record.evaluation || record.evaluation.walrus || record.evaluation.evaluatedAt !== '2026-11-03T08:00:00.234Z' || record.evaluation.actualDirection !== 'down' || record.evaluation.correct !== true) {
		throw new Error('The stored evaluation content does not match the known November 3 recovery incident.');
	}
	if (record.evaluation.walrusWrite?.jobId) throw new Error('The incident already has a persisted Walrus job ID; refusing manual relink.');
}

async function main() {
	const index = await readIndex();
	const record = index.forecasts.find((forecast) => forecast.forecastId === FORECAST_ID);
	assertIncidentRecord(record);

	const memory = WalrusMemoryAdapter.fromEnvironment();
	const status = await memory.getRememberStatus(JOB_ID);
	if (status.status !== 'done' || status.blobId !== BLOB_ID) throw new Error(`Confirmed job did not match expected completed result: ${status.status}`);
	const saved = await memory.waitForRememberJob(JOB_ID);
	if (saved.id !== JOB_ID || saved.blobId !== BLOB_ID || saved.namespace !== memory.namespace) {
		throw new Error('Confirmed Walrus result identity does not match the incident recovery data.');
	}

	await updateIndex((latest) => {
		const target = latest.forecasts.find((forecast) => forecast.forecastId === FORECAST_ID);
		assertIncidentRecord(target);
		target.evaluation!.walrus = { memoryId: saved.id, blobId: saved.blobId };
		target.state = 'evaluated';
	});
	console.log('nov3_evaluation_recovered', JSON.stringify({ forecastId: FORECAST_ID, memoryId: saved.id, blobId: saved.blobId }));
}

main().catch((error: unknown) => {
	console.error(`November 3 evaluation recovery failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
});
