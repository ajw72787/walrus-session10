import assert from 'node:assert/strict';
import test from 'node:test';
import { pollAcceptedWalrusJob, type WalrusJobClient } from '../lib/walrus-job-recovery.ts';

const write = { idempotencyKey: 'evaluation-forecast-1', submissionStartedAt: '2026-11-03T08:00:00.000Z', jobId: 'job-1', acceptedAt: '2026-11-03T08:00:01.000Z' };

function client(overrides: Partial<WalrusJobClient> = {}): WalrusJobClient {
	return {
		getRememberStatus: async () => ({ jobId: 'job-1', status: 'running' }),
		waitForRememberJob: async () => ({ id: 'memory-1', jobId: 'job-1', blobId: 'blob-1', namespace: 'test' }),
		...overrides,
	};
}

test('completes an accepted job without a second submission', async () => {
	const result = await pollAcceptedWalrusJob(client(), write);
	assert.deepEqual(result, { kind: 'completed', saved: { id: 'memory-1', jobId: 'job-1', blobId: 'blob-1', namespace: 'test' } });
});

test('keeps a timed-out accepted job pending for a later run', async () => {
	let statusCalls = 0;
	const pendingClient = client({
		getRememberStatus: async () => ({ jobId: 'job-1', status: (++statusCalls === 1 ? 'running' : 'uploaded') }),
		waitForRememberJob: async () => { throw new Error('remember job timed out'); },
	});
	assert.deepEqual(await pollAcceptedWalrusJob(pendingClient, write), { kind: 'pending' });

	const resumed = await pollAcceptedWalrusJob(client(), write);
	assert.equal(resumed.kind, 'completed');
});

test('records terminal failed and not-found statuses without resubmission', async () => {
	for (const status of ['failed', 'not_found'] as const) {
		let waits = 0;
		const result = await pollAcceptedWalrusJob(client({
			getRememberStatus: async () => ({ jobId: 'job-1', status, error: 'terminal test failure' }),
			waitForRememberJob: async () => { waits += 1; throw new Error('terminal status is reported by the SDK wait'); },
		}), write);
		assert.deepEqual(result, { kind: 'terminal_failure', status, error: 'terminal test failure' });
		assert.equal(waits, 1);
	}
});

test('requires a persisted accepted job ID, preventing uncertain-write retries', async () => {
	await assert.rejects(() => pollAcceptedWalrusJob(client(), { idempotencyKey: 'same-key', submissionStartedAt: '2026-11-03T08:00:00.000Z' }), /accepted job_id/);
});
