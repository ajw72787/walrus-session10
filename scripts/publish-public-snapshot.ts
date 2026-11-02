import { mkdir, mkdtemp, open, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { materiallyEqualSnapshots, readPublicSnapshot, validatePublicSnapshot, type PublicSnapshot } from '../lib/public-snapshot.ts';

const exec = promisify(execFile);
const FILE = 'public/data/predictions.json';
const branch = 'main';
const dryRun = process.argv.includes('--dry-run');
const publishEnabled = process.env.ENABLE_PUBLIC_SNAPSHOT_PUBLISH === 'true';
const publisherLockPath = join(process.cwd(), 'data', 'public-snapshot-publisher.lock');

async function git(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await exec('git', args, { cwd, maxBuffer: 1024 * 1024 });
	return stdout.trim();
}

async function remoteBranchExists(cwd: string): Promise<boolean> {
	try {
		await git(cwd, ['rev-parse', '--verify', `refs/remotes/origin/${branch}`]);
		return true;
	} catch {
		return false;
	}
}

async function publishAttempt(repository: string, snapshotText: string, snapshot: PublicSnapshot, attempt: number): Promise<'unchanged' | 'published'> {
	await git(repository, ['fetch', '--quiet', 'origin', branch]);
	if (!(await remoteBranchExists(repository))) throw new Error(`origin/${branch} does not exist`);
	const worktree = await mkdtemp(join(tmpdir(), 'suix5-public-snapshot-'));
	try {
		await git(repository, ['worktree', 'add', '--detach', worktree, `origin/${branch}`]);
		let existing: PublicSnapshot | undefined;
		try { existing = JSON.parse(await readFile(join(worktree, FILE), 'utf8')) as PublicSnapshot; validatePublicSnapshot(existing); } catch { /* first public snapshot */ }
		if (existing && materiallyEqualSnapshots(existing, snapshot)) {
			console.log('public_snapshot_unchanged', JSON.stringify({ attempt }));
			return 'unchanged';
		}
		if (dryRun) {
			console.log('public_snapshot_publish_dry_run', JSON.stringify({ attempt, file: FILE, action: existing ? 'update' : 'create' }));
			return 'published';
		}
		await mkdir(join(worktree, 'public', 'data'), { recursive: true });
		await writeFile(join(worktree, FILE), snapshotText, { mode: 0o644 });
		await git(worktree, ['add', '--', FILE]);
		const staged = await git(worktree, ['diff', '--cached', '--name-only']);
		if (staged !== FILE) throw new Error(`publisher safety check failed; staged files: ${staged || '(none)'}`);
		await git(worktree, ['commit', '-m', 'chore: publish SUIX5 prediction snapshot', '--', FILE]);
		await git(worktree, ['push', 'origin', `HEAD:${branch}`]);
		console.log('public_snapshot_published', JSON.stringify({ attempt, file: FILE }));
		return 'published';
	} finally {
		await git(repository, ['worktree', 'remove', '--force', worktree]).catch(() => undefined);
		await rm(worktree, { recursive: true, force: true });
	}
}

async function acquirePublisherLock(): Promise<() => Promise<void>> {
	await mkdir(join(process.cwd(), 'data'), { recursive: true });
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(publisherLockPath, 'wx', 0o600);
		await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
	} catch (error: unknown) {
		if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('A public snapshot publisher is already active.');
		throw error;
	}
	if (!handle!) throw new Error('Unable to acquire the public snapshot publisher lock.');
	return async () => { await handle.close(); await unlink(publisherLockPath).catch(() => undefined); };
}

async function main() {
	const release = await acquirePublisherLock();
	try {
	const repository = process.cwd();
	const status = await git(repository, ['status', '--porcelain']);
	console.log('publisher_repository_checked', JSON.stringify({ dirtyWorkingTree: Boolean(status), dryRun, enabled: publishEnabled }));
	if (!dryRun && !publishEnabled) throw new Error('Publishing is disabled. Set ENABLE_PUBLIC_SNAPSHOT_PUBLISH=true after review.');
	const snapshot = await readPublicSnapshot();
	const snapshotText = await readFile(join(repository, FILE), 'utf8');
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		try {
			await publishAttempt(repository, snapshotText, snapshot, attempt);
			return;
		} catch (error: unknown) {
			if (attempt === 3) throw error;
			console.warn(`public_snapshot_publish_retry attempt=${attempt}: ${error instanceof Error ? error.message : String(error)}`);
			await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
		}
	}
	} finally {
		await release();
	}
}

main().catch((error: unknown) => {
	console.error(`Public snapshot publish failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
});
