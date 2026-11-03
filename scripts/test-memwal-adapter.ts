import { SUIX5_MEMORY_NAMESPACE, WalrusMemoryAdapter } from '../lib/memwal.ts';

const testId = `walrus-session10-adapter-${new Date().toISOString()}`;
const text = `[INDEPENDENT SDK ADAPTER TEST ${testId}] SUIX5 Market Intelligence Agent uses Walrus Memory only for read-only research predictions and evaluation outcomes. This record is not production vault control.`;

async function main() {
	const memory = WalrusMemoryAdapter.fromEnvironment(SUIX5_MEMORY_NAMESPACE);
	const health = await memory.health();
	console.log('health', JSON.stringify({ status: health.status, mode: health.mode, write_ready: health.write_ready }));

	const accepted = await memory.submitRemember(text, testId);
	const saved = await memory.waitForRememberJob(accepted.jobId);
	console.log(
		'saved',
		JSON.stringify({ id: saved.id, job_id: saved.jobId, blob_id: saved.blobId, namespace: saved.namespace }),
	);

	const recalled = await memory.recall(testId, 5);
	const match = recalled.results.find((result) => result.text === text);
	if (!match) {
		throw new Error(`Recall did not return the exact test memory; ${recalled.total} result(s) returned.`);
	}
	console.log(
		'recalled',
		JSON.stringify({ blob_id: match.blob_id, textMatches: true, total: recalled.total }),
	);
}

main().catch((error: unknown) => {
	console.error(`MemWal adapter test failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
});
