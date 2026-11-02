import { ChannelCredentials } from '@grpc/grpc-js';
import { GrpcTransport } from '@protobuf-ts/grpc-transport';
import { GrpcTypes, SuiGrpcClient } from '@mysten/sui/grpc';

const endpoint = 'sui-mainnet-grpc.gateway.tatum.io:443';
const objectId = '0x725ac07794f6e3eb41ba47d7191c0d3a306ebe92ac5a10b0edc00fdb540dd81f';

function ownerToJson(owner: unknown): unknown {
	return owner;
}

function json(value: unknown): string {
	return JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item));
}

async function main() {
	const apiKey = process.env.TATUM_API_KEY;
	if (!apiKey) {
		throw new Error('TATUM_API_KEY is not set. Load it from an ignored environment file before running this test.');
	}

	const transport = new GrpcTransport({
		host: endpoint,
		channelCredentials: ChannelCredentials.createSsl(),
		meta: { 'x-api-key': apiKey },
	});
	const client = new SuiGrpcClient({ network: 'mainnet', transport });

	const checkpointStream = client.ledgerService.listCheckpoints({
		options: { limit: 1, ordering: GrpcTypes.Ordering.DESCENDING },
	});
	let latestCheckpoint: unknown;
	for await (const response of checkpointStream.responses) {
		if (response.checkpoint) {
			latestCheckpoint = response.checkpoint;
			break;
		}
	}
	if (!latestCheckpoint) {
		throw new Error('The gRPC checkpoint stream returned no checkpoint.');
	}
	console.log('latest_checkpoint', json(latestCheckpoint));

	const { object } = await client.getObject({
		objectId,
		include: { content: true, json: true },
	});

	console.log(
		'object',
		json({
			objectId: object.objectId,
			type: object.type,
			version: object.version,
			owner: ownerToJson(object.owner),
			moveJson: object.json ?? null,
			moveContentBcsAvailable: object.content !== undefined,
		}),
	);
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Tatum Sui gRPC smoke test failed: ${message}`);
	process.exitCode = 1;
});
