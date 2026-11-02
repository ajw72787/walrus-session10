import { ChannelCredentials } from '@grpc/grpc-js';
import { GrpcTransport } from '@protobuf-ts/grpc-transport';
import { SuiGrpcClient } from '@mysten/sui/grpc';

const REGISTRY_ID = '0x725ac07794f6e3eb41ba47d7191c0d3a306ebe92ac5a10b0edc00fdb540dd81f';

function clientFromEnvironment(): SuiGrpcClient {
	const apiKey = process.env.TATUM_API_KEY;
	if (!apiKey) throw new Error('TATUM_API_KEY is not set.');
	return new SuiGrpcClient({
		network: 'mainnet',
		transport: new GrpcTransport({
			host: 'sui-mainnet-grpc.gateway.tatum.io:443',
			channelCredentials: ChannelCredentials.createSsl(),
			meta: { 'x-api-key': apiKey },
		}),
	});
}

function symbolForMoveType(type: string): 'SUI' | 'WAL' | 'DEEP' | 'CETUS' | 'NAVX' | null {
	if (type.endsWith('::sui::SUI')) return 'SUI';
	if (type.endsWith('::wal::WAL')) return 'WAL';
	if (type.endsWith('::deep::DEEP')) return 'DEEP';
	if (type.endsWith('::cetus::CETUS')) return 'CETUS';
	if (type.endsWith('::navx::NAVX')) return 'NAVX';
	return null;
}

export interface ActiveSuiX5State {
	registryId: string;
	generation: string;
	stateFieldId: string;
	stateVersion: string;
	weightsBps: Record<string, number>;
}

export async function readActiveSuiX5State(): Promise<ActiveSuiX5State> {
	const client = clientFromEnvironment();
	const { object: registry } = await client.getObject({ objectId: REGISTRY_ID, include: { json: true } });
	const current = (registry.json as { current?: string } | null)?.current;
	if (!current) throw new Error('Registry did not return an active generation.');
	const fields = await client.listDynamicFields({ parentId: REGISTRY_ID, limit: 100 });
	const { objects } = await client.getObjects({ objectIds: fields.dynamicFields.map((field) => field.fieldId), include: { json: true } });
	const stateObject = objects.find((object) => {
		if (object instanceof Error) return false;
		const json = object.json as { name?: { version?: string } } | null;
		return json?.name?.version === current;
	});
	if (!stateObject || stateObject instanceof Error) throw new Error(`No StateV2 dynamic field found for generation ${current}.`);
	const state = (stateObject.json as { value?: { composition?: { targets?: { token: string; weight_bps: string }[] } } } | null)?.value;
	const targets = state?.composition?.targets;
	if (!targets || targets.length !== 5) throw new Error('Active StateV2 did not return five composition targets.');
	const weightsBps: Record<string, number> = {};
	for (const target of targets) {
		const symbol = symbolForMoveType(target.token);
		if (!symbol || !Number.isInteger(Number(target.weight_bps))) throw new Error(`Unsupported constituent: ${target.token}`);
		weightsBps[symbol] = Number(target.weight_bps);
	}
	if (Object.keys(weightsBps).length !== 5 || Object.values(weightsBps).reduce((sum, weight) => sum + weight, 0) !== 10_000) {
		throw new Error('Active StateV2 weights are incomplete or do not sum to 10,000 bps.');
	}
	return { registryId: REGISTRY_ID, generation: current, stateFieldId: stateObject.objectId, stateVersion: stateObject.version, weightsBps };
}
