import { spawn, type ChildProcess } from 'node:child_process';

const FOUR_HOUR_CRON_DESCRIPTION = 'UTC 00:00, 04:00, 08:00, 12:00, 16:00, 20:00';
const enabled = process.env.ENABLE_PREDICTION_SCHEDULE === 'true';
const dryRun = process.env.SUIX5_SCHEDULER_DRY_RUN === 'true';
const testIntervalMs = positiveInteger(process.env.SUIX5_SCHEDULER_TEST_INTERVAL_MS);

let activeChild: ChildProcess | undefined;
let timer: NodeJS.Timeout | undefined;
let shuttingDown = false;

function positiveInteger(value: string | undefined): number | undefined {
	if (!value || !/^\d+$/.test(value)) return undefined;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function nextFourHourUtcRun(now: Date): Date {
	const next = new Date(now);
	next.setUTCMinutes(0, 0, 0);
	next.setUTCHours(Math.floor(now.getUTCHours() / 4) * 4 + 4);
	return next;
}

function log(event: string, fields: Record<string, unknown> = {}): void {
	console.log(`scheduler_${event}`, JSON.stringify({ at: new Date().toISOString(), ...fields }));
}

function workerArguments(): string[] {
	const arguments_ = ['--env-file=.env.local', '--import', 'tsx', 'worker/prediction-worker.ts'];
	if (dryRun) arguments_.push('--dry-run');
	return arguments_;
}

async function invokeWorker(trigger: 'scheduled' | 'test'): Promise<void> {
	if (activeChild) {
		log('invocation_skipped_active', { trigger, pid: activeChild.pid });
		return;
	}
	const startedAt = Date.now();
	const args = workerArguments();
	log('invocation_started', { trigger, dryRun, command: [process.execPath, ...args].join(' ') });
	const child = spawn(process.execPath, args, { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
	activeChild = child;
	child.stdout.on('data', (chunk) => process.stdout.write(`worker_stdout ${chunk}`));
	child.stderr.on('data', (chunk) => process.stderr.write(`worker_stderr ${chunk}`));
	await new Promise<void>((resolve, reject) => {
		child.once('error', reject);
		child.once('exit', (code, signal) => {
			if (code === 0) resolve();
			else reject(new Error(`worker exited code=${code ?? 'null'} signal=${signal ?? 'none'}`));
		});
	}).then(
		() => log('invocation_completed', { trigger, durationMs: Date.now() - startedAt }),
		(error: unknown) => log('invocation_failed', { trigger, durationMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) }),
	);
	activeChild = undefined;
}

function scheduleNext(): void {
	if (shuttingDown) return;
	if (testIntervalMs) {
		const nextAt = new Date(Date.now() + testIntervalMs);
		log('next_run', { mode: 'test', nextAt: nextAt.toISOString(), intervalMs: testIntervalMs, dryRun });
		timer = setTimeout(async () => {
			await invokeWorker('test');
			scheduleNext();
		}, testIntervalMs);
		return;
	}
	if (!enabled) {
		log('disabled', { enableWith: 'ENABLE_PREDICTION_SCHEDULE=true' });
		return;
	}
	const nextAt = nextFourHourUtcRun(new Date());
	const delayMs = nextAt.getTime() - Date.now();
	log('next_run', { mode: 'production', schedule: FOUR_HOUR_CRON_DESCRIPTION, nextAt: nextAt.toISOString(), delayMs, dryRun });
	timer = setTimeout(async () => {
		await invokeWorker('scheduled');
		scheduleNext();
	}, delayMs);
}

async function shutdown(signal: string): Promise<void> {
	if (shuttingDown) return;
	shuttingDown = true;
	if (timer) clearTimeout(timer);
	log('shutdown_requested', { signal, activeWorkerPid: activeChild?.pid ?? null });
	if (activeChild) {
		await new Promise<void>((resolve) => activeChild!.once('exit', () => resolve()));
	}
	log('shutdown_completed', { signal });
}

async function main(): Promise<void> {
	log('started', {
		mode: testIntervalMs ? 'test' : enabled ? 'production' : 'disabled',
		dryRun,
		timezone: process.env.TZ ?? 'system-default',
		schedule: FOUR_HOUR_CRON_DESCRIPTION,
	});
	process.once('SIGINT', () => void shutdown('SIGINT').then(() => process.exit(0)));
	process.once('SIGTERM', () => void shutdown('SIGTERM').then(() => process.exit(0)));
	if (testIntervalMs) {
		await invokeWorker('test');
	}
	scheduleNext();
}

main().catch((error: unknown) => {
	console.error(`Prediction scheduler failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
});
