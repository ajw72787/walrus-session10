'use client';

import { useEffect, useState } from 'react';

type Snapshot = {
	schemaVersion: number;
	lastPublishedAt: string;
	suix5: { generation: string; targetWeightsBps: Record<string, number>; verifiedAt: string } | null;
	forecasts: Array<{ id: string; issuedAt: string; maturityAt: string; horizonHours: number; direction: 'up' | 'down' | 'flat'; methodVersion: string; confidence: { value: number; calibration: string }; status: string; evaluation?: { evaluatedAt: string; actualDirection: string; correct: boolean; evidence?: { memoryId: string; blobId: string } }; evidence?: { memoryId: string; blobId: string } }>;
	summary: { totalForecasts: number; pendingForecasts: number; evaluatedForecasts: number; directionalAccuracy: number | null };
	dataQuality: { priceSource: string; latestSourceSampleAt: string | null; limitations: string[] };
};

const formatTime = (value: string) => new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value)) + ' UTC';
const directionClass = (direction: string) => direction === 'up' ? 'up' : direction === 'down' ? 'down' : 'flat';

function Evidence({ evidence }: { evidence?: { memoryId: string; blobId: string } }) {
	if (!evidence) return <span className="muted">Not yet durable</span>;
	return <div className="evidence"><span>Memory {evidence.memoryId}</span><span>Blob {evidence.blobId}</span></div>;
}

export default function Home() {
	const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loadedAt, setLoadedAt] = useState<number | null>(null);

	useEffect(() => {
		fetch('/data/predictions.json', { cache: 'no-store' })
			.then(async (response) => { if (!response.ok) throw new Error(`Snapshot unavailable (${response.status})`); return response.json() as Promise<Snapshot>; })
			.then((data) => { setSnapshot(data); setLoadedAt(Date.now()); })
			.catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Snapshot unavailable'));
	}, []);

	if (error) return <main className="shell"><header><p className="eyebrow">SUIX5 INTELLIGENCE</p><h1>Public snapshot unavailable</h1><p className="muted">{error}. No forecast data is shown when the sanitized snapshot cannot be loaded.</p></header></main>;
	if (!snapshot) return <main className="shell"><p className="eyebrow">SUIX5 INTELLIGENCE</p><h1>Loading public evidence…</h1></main>;
	const byHorizon = [4, 12, 24].map((horizon) => snapshot.forecasts.find((forecast) => forecast.horizonHours === horizon));
	const stale = loadedAt !== null && loadedAt - new Date(snapshot.lastPublishedAt).getTime() > 8 * 60 * 60 * 1000;
	return <main className="shell">
		<header className="hero">
			<div><p className="eyebrow">WALRUS SESSION 10 · TATUM TOTAL RECALL</p><h1>SUIX5 <em>Intelligence</em></h1><p className="lede">A read-only directional research agent for the SUIX5 constituent basket.</p></div>
			<a className="explore" href="https://sui-x.com" target="_blank" rel="noreferrer">Explore SuiX ↗</a>
		</header>
		{stale && <aside className="warning">Snapshot may be stale. Last published {formatTime(snapshot.lastPublishedAt)}.</aside>}
		<section className="metrics" aria-label="Forecast summary">
			<div><span>Total forecasts</span><strong>{snapshot.summary.totalForecasts}</strong></div><div><span>Pending</span><strong>{snapshot.summary.pendingForecasts}</strong></div><div><span>Evaluated</span><strong>{snapshot.summary.evaluatedForecasts}</strong></div><div><span>Directional accuracy</span><strong>{snapshot.summary.directionalAccuracy === null ? '—' : `${(snapshot.summary.directionalAccuracy * 100).toFixed(0)}%`}</strong></div>
		</section>
		<section><div className="section-heading"><p className="eyebrow">LATEST MODEL OUTPUT</p><h2>Direction by horizon</h2></div><div className="forecast-grid">
			{byHorizon.map((forecast, index) => forecast ? <article className="forecast-card" key={forecast.id}><span>{forecast.horizonHours}H horizon</span><strong className={directionClass(forecast.direction)}>{forecast.direction}</strong><p>{(forecast.confidence.value * 100).toFixed(0)}% confidence <small>· {forecast.confidence.calibration}</small></p><hr/><p>Issued {formatTime(forecast.issuedAt)}</p><p>Matures {formatTime(forecast.maturityAt)}</p></article> : <article className="forecast-card" key={index}><span>{[4, 12, 24][index]}H horizon</span><strong>—</strong><p className="muted">No published forecast</p></article>)}
		</div></section>
		<section className="two-column"><div><div className="section-heading"><p className="eyebrow">ON-CHAIN TARGETS</p><h2>Current allocation</h2></div>{snapshot.suix5 ? <><p className="muted">Generation {snapshot.suix5.generation} · verified {formatTime(snapshot.suix5.verifiedAt)}</p><div className="weights">{Object.entries(snapshot.suix5.targetWeightsBps).map(([asset, bps]) => <div key={asset}><span>{asset}</span><b>{(bps / 100).toFixed(2)}%</b><i style={{ width: `${bps / 100}%` }} /></div>)}</div></> : <p className="muted">Verified target weights were not available in this snapshot.</p>}</div><div className="method"><p className="eyebrow">INTERPRETATION</p><h2>Evidence, not execution</h2><p>This is a normalized $100 virtual basket proxy. It is not actual SUIX5 vault NAV, a redeemable value, or a token market price.</p><p>Forecasts are persisted through Walrus Memory; public identifiers below provide evidence of each write. Confidence remains uncalibrated until 12 evaluated outcomes exist.</p></div></section>
		<section><div className="section-heading"><p className="eyebrow">FORECAST LEDGER</p><h2>Published evidence</h2></div><div className="ledger">{snapshot.forecasts.map((forecast) => <article className="ledger-row" key={forecast.id}><div><span className={`pill ${directionClass(forecast.direction)}`}>{forecast.horizonHours}H · {forecast.direction}</span><h3>{forecast.status}</h3><p>Issued {formatTime(forecast.issuedAt)} · Matures {formatTime(forecast.maturityAt)}</p><p className="muted">{forecast.methodVersion} · {(forecast.confidence.value * 100).toFixed(0)}% · {forecast.confidence.calibration}</p></div><div>{forecast.evaluation ? <p className={forecast.evaluation.correct ? 'correct' : 'incorrect'}>Actual {forecast.evaluation.actualDirection} · {forecast.evaluation.correct ? 'Correct' : 'Incorrect'}</p> : <p className="muted">Awaiting maturity</p>}<Evidence evidence={forecast.evidence}/>{forecast.evaluation?.evidence && <Evidence evidence={forecast.evaluation.evidence}/>}</div></article>)}</div></section>
		<footer><p>Source: {snapshot.dataQuality.priceSource}. Last source sample: {snapshot.dataQuality.latestSourceSampleAt ? formatTime(snapshot.dataQuality.latestSourceSampleAt) : 'not available'}.</p><ul>{snapshot.dataQuality.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul><p>Snapshot updated {formatTime(snapshot.lastPublishedAt)} · Read-only public dashboard · Tatum + Walrus attribution</p></footer>
	</main>;
}
