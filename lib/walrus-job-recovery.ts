import type { RememberCompletedJob, RememberJobStatus } from './memwal.ts';
import type { WalrusWriteJob } from './prediction-index.ts';

export interface WalrusJobClient {
	waitForRememberJob(jobId: string): Promise<RememberCompletedJob>;
	getRememberStatus(jobId: string): Promise<RememberJobStatus>;
}

export type WalrusJobPollResult =
	| { kind: 'completed'; saved: RememberCompletedJob }
	| { kind: 'pending' }
	| { kind: 'terminal_failure'; status: 'failed' | 'not_found'; error?: string };

/**
 * Polls only an already persisted accepted job. It never calls remember(), so
 * timeouts and terminal errors cannot create a second immutable memory.
 */
export async function pollAcceptedWalrusJob(client: WalrusJobClient, write: WalrusWriteJob): Promise<WalrusJobPollResult> {
	if (!write.jobId) throw new Error('Cannot poll a Walrus write without an accepted job_id');
	try {
		return { kind: 'completed', saved: await client.waitForRememberJob(write.jobId) };
	} catch (error: unknown) {
		// A timeout is intentionally non-terminal. Confirm whether the relayer
		// reached a terminal state while the last polling request was in flight.
		const latest = await client.getRememberStatus(write.jobId);
		if (latest.status === 'failed' || latest.status === 'not_found') {
			return { kind: 'terminal_failure', status: latest.status, error: latest.error };
		}
		if (latest.status === 'done') {
			return { kind: 'completed', saved: await client.waitForRememberJob(write.jobId) };
		}
		return { kind: 'pending' };
	}
}
