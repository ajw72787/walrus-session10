import { MemWal } from '@mysten-incubation/memwal';

export const REMEMBER_JOB_TIMEOUT_MS = 10 * 60 * 1000;
export const REMEMBER_JOB_POLL_INTERVAL_MS = 3_000;

export interface RememberAcceptedJob {
	jobId: string;
	status: string;
}

export interface RememberCompletedJob {
	id: string;
	jobId?: string;
	blobId: string;
	namespace: string;
}

export interface RememberJobStatus {
	jobId: string;
	status: 'pending' | 'running' | 'uploaded' | 'done' | 'failed' | 'not_found';
	blobId?: string;
	error?: string;
}

export const SUIX5_MEMORY_NAMESPACE = 'suix5-market-intelligence-walrus-session10';
const PRODUCTION_RELAYER_URL = 'https://relayer.memory.walrus.xyz';

function requireEnvironment(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required server-side environment variable: ${name}`);
	return value;
}

export class WalrusMemoryAdapter {
	readonly namespace: string;
	#client: MemWal;

	private constructor(client: MemWal, namespace: string) {
		this.#client = client;
		this.namespace = namespace;
	}

	static fromEnvironment(namespace = SUIX5_MEMORY_NAMESPACE): WalrusMemoryAdapter {
		const key = process.env.MEMWAL_PRIVATE_KEY ?? process.env.MEMWAL_KEY;
		if (!key) {
			throw new Error('Missing required server-side environment variable: MEMWAL_PRIVATE_KEY');
		}

		return new WalrusMemoryAdapter(
			MemWal.create({
				key,
				accountId: requireEnvironment('MEMWAL_ACCOUNT_ID'),
				serverUrl: process.env.MEMWAL_SERVER_URL ?? PRODUCTION_RELAYER_URL,
				namespace,
			}),
			namespace,
		);
	}

	health() {
		return this.#client.health();
	}

	async submitRemember(text: string, idempotencyKey: string): Promise<RememberAcceptedJob> {
		const accepted = await this.#client.remember(text, {
			idempotencyKey,
		});
		if (!accepted.job_id) throw new Error('MemWal accepted a remember request without a job_id');
		return { jobId: accepted.job_id, status: accepted.status };
	}

	async waitForRememberJob(jobId: string): Promise<RememberCompletedJob> {
		const saved = await this.#client.waitForRememberJob(jobId, {
			timeoutMs: REMEMBER_JOB_TIMEOUT_MS,
			pollIntervalMs: REMEMBER_JOB_POLL_INTERVAL_MS,
		});
		return { id: saved.id, jobId: saved.job_id, blobId: saved.blob_id, namespace: saved.namespace };
	}

	async getRememberStatus(jobId: string): Promise<RememberJobStatus> {
		const status = await this.#client.getRememberStatus(jobId);
		return { jobId: status.job_id, status: status.status, blobId: status.blob_id, error: status.error };
	}

	recall(query: string, limit = 5) {
		return this.#client.recall({ query, limit, namespace: this.namespace });
	}
}
