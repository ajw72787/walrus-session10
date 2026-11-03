import type { ForecastRecord, HistoricalReliabilitySnapshot, HorizonHours } from './prediction-index.ts';

export const HISTORICAL_RELIABILITY_VERSION = 'walrus-horizon-reliability-v1' as const;
export const MIN_HORIZON_EVALUATIONS = 12;

/**
 * Produces an issue-time-only reliability snapshot. Semantic Walrus recall is
 * intentionally not used: the local index is the deterministic ledger, while
 * both persisted Walrus evidence IDs prove each eligible record was written.
 */
export function historicalReliabilityAtIssue(
	forecasts: ForecastRecord[],
	horizonHours: HorizonHours,
	methodVersion: string,
	issuedAt: string,
): HistoricalReliabilitySnapshot {
	const cutoffMs = Date.parse(issuedAt);
	if (!Number.isFinite(cutoffMs)) throw new Error(`Invalid reliability cutoff timestamp: ${issuedAt}`);
	const eligible = forecasts.filter((forecast) => {
		const evaluatedAtMs = Date.parse(forecast.evaluation?.evaluatedAt ?? '');
		return forecast.horizonHours === horizonHours
			&& forecast.methodVersion === methodVersion
			&& forecast.state === 'evaluated'
			&& Boolean(forecast.walrus?.memoryId && forecast.walrus?.blobId)
			&& Boolean(forecast.evaluation?.walrus?.memoryId && forecast.evaluation?.walrus?.blobId)
			&& Number.isFinite(evaluatedAtMs)
			&& evaluatedAtMs < cutoffMs;
	});
	const correctEvaluations = eligible.filter((forecast) => forecast.evaluation?.correct).length;
	const eligibleEvaluations = eligible.length;
	const sufficient = eligibleEvaluations >= MIN_HORIZON_EVALUATIONS;
	return {
		version: HISTORICAL_RELIABILITY_VERSION,
		mode: 'shadow',
		horizonHours,
		cutoffTimestamp: issuedAt,
		eligibleEvaluations,
		correctEvaluations,
		observedAccuracy: eligibleEvaluations ? correctEvaluations / eligibleEvaluations : null,
		smoothedReliability: eligibleEvaluations ? (correctEvaluations + 1) / (eligibleEvaluations + 2) : null,
		status: sufficient ? 'shadow' : 'insufficient',
	};
}
