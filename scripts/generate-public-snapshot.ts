import { buildPublicSnapshot, writePublicSnapshot } from '../lib/public-snapshot.ts';

async function main() {
	const snapshot = await buildPublicSnapshot();
	await writePublicSnapshot(snapshot);
	console.log('public_snapshot_written', JSON.stringify({ forecasts: snapshot.summary.totalForecasts, evaluated: snapshot.summary.evaluatedForecasts, generation: snapshot.suix5?.generation ?? null }));
}

main().catch((error: unknown) => {
	console.error(`Public snapshot generation failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
});
