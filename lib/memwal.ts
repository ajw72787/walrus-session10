import { MemWal } from '@mysten-incubation/memwal';

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

	async remember(text: string, idempotencyKey?: string) {
		const accepted = await this.#client.remember(text, {
			idempotencyKey,
		});
		return this.#client.waitForRememberJob(accepted.job_id);
	}

	recall(query: string, limit = 5) {
		return this.#client.recall({ query, limit, namespace: this.namespace });
	}
}
