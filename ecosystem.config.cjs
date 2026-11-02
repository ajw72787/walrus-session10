module.exports = {
	apps: [
		{
			name: 'suix5-prediction-worker',
			script: './node_modules/.bin/tsx',
			args: 'worker/prediction-scheduler.ts',
			cwd: __dirname,
			instances: 1,
			exec_mode: 'fork',
			interpreter: 'none',
			autorestart: true,
			min_uptime: '5s',
			restart_delay: 5000,
			kill_timeout: 900000,
			time: true,
			env: { TZ: 'UTC' },
		},
	],
};
