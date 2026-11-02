import { ChannelCredentials } from '@grpc/grpc-js';
import { GrpcTransport } from '@protobuf-ts/grpc-transport';
import { SuiGrpcClient } from '@mysten/sui/grpc';

const packageId = '0xc13c241cdcb32ce410dba013bc77590b51c62b6e4cf463a5f0d48fbec6d31b14';
const registryId = '0x725ac07794f6e3eb41ba47d7191c0d3a306ebe92ac5a10b0edc00fdb540dd81f';
const activeStateFieldId = '0xb1520acc222a91cf088c25a1d190a7c58d1ea9f4375d7d27682502da80e94927';

function json(value: unknown): string {
	return JSON.stringify(value, (_key, item) => {
		if (typeof item === 'bigint') return item.toString();
		if (item instanceof Uint8Array) return `[${item.byteLength} BCS bytes]`;
		return item;
	});
}

async function main() {
	const apiKey = process.env.TATUM_API_KEY;
	if (!apiKey) throw new Error('TATUM_API_KEY is not set.');

	const client = new SuiGrpcClient({
		network: 'mainnet',
		transport: new GrpcTransport({
			host: 'sui-mainnet-grpc.gateway.tatum.io:443',
			channelCredentials: ChannelCredentials.createSsl(),
			meta: { 'x-api-key': apiKey },
		}),
	});
	if (process.argv.includes('--active-state-field')) {
		const { object } = await client.getObject({
			objectId: activeStateFieldId,
			include: { content: true, json: true },
		});
		console.log(
			'active_state_field',
			json({
				objectId: object.objectId,
				type: object.type,
				version: object.version,
				owner: object.owner,
				moveJson: object.json ?? null,
				moveContentBcsAvailable: object.content !== undefined,
			}),
		);
		return;
	}
	const tableArgumentIndex = process.argv.indexOf('--table');
	if (tableArgumentIndex >= 0) {
		const parentId = process.argv[tableArgumentIndex + 1];
		if (!parentId) throw new Error('--table requires a parent object ID.');
		const fields = await client.listDynamicFields({ parentId, limit: 100, include: { value: true } });
		console.log(
			'table_fields',
			json({
				parentId,
				fields: fields.dynamicFields.map((field) => ({
					fieldId: field.fieldId,
					kind: field.$kind,
					nameType: field.name.type,
					valueType: field.valueType,
				})),
				hasNextPage: fields.hasNextPage,
			}),
		);
		if (fields.dynamicFields.length > 0) {
			const { objects } = await client.getObjects({
				objectIds: fields.dynamicFields.map((field) => field.fieldId),
				include: { json: true },
			});
			console.log(
				'table_field_values',
				json(
					objects.map((object) =>
						object instanceof Error
							? { error: object.message }
							: { objectId: object.objectId, type: object.type, moveJson: object.json ?? null },
					),
				),
			);
		}
		return;
	}
	const eventArgumentIndex = process.argv.indexOf('--event-type');
	if (eventArgumentIndex >= 0) {
		const eventType = process.argv[eventArgumentIndex + 1];
		if (!eventType) throw new Error('--event-type requires a fully qualified event type.');
		const page = await client.listEvents({ filter: { eventType }, order: 'descending', limit: 10 });
		console.log(
			'events',
			json({
				eventType,
				events: page.events.map((event) => ({
					checkpoint: event.checkpoint,
					transactionDigest: event.transactionDigest,
					eventIndex: event.eventIndex,
					eventType: event.eventType,
					json: event.json ?? null,
				})),
				hasNextPage: page.hasNextPage,
			}),
		);
		return;
	}
	const functionArgumentIndex = process.argv.indexOf('--function');
	if (functionArgumentIndex >= 0) {
		const functionName = process.argv[functionArgumentIndex + 1];
		if (!functionName) throw new Error('--function requires a package, module, or function filter.');
		const page = await client.listTransactions({
			filter: { function: functionName },
			order: 'descending',
			limit: 10,
			include: { events: true, transaction: true },
		});
		console.log(
			'transactions',
			json({
				functionName,
				transactions: page.transactions.map((result) => {
					const transaction = 'Transaction' in result ? result.Transaction : result.FailedTransaction;
					if (!transaction) return { kind: result.$kind, digest: null, success: false, events: [] };
					return {
						kind: result.$kind,
						digest: transaction.digest,
						success: transaction.status.success,
						events: transaction.events
							?.filter((event) => event.packageId === packageId)
							.map((event) => ({ type: event.eventType, json: event.json ?? null })),
					};
				}),
				hasNextPage: page.hasNextPage,
			}),
		);
		return;
	}

	const { response: packageResponse } = await client.movePackageService.getPackage({ packageId });
	const { object: registry } = await client.getObject({
		objectId: registryId,
		include: { content: true, json: true },
	});
	const dynamicFields = await client.listDynamicFields({
		parentId: registryId,
		limit: 100,
		include: { value: true },
	});

	const movePackage = packageResponse.package;
	if (!movePackage) throw new Error('Package metadata was not returned.');
	const registryModule = movePackage.modules.find((module) => module.name === 'registry');
	if (!registryModule) throw new Error('The published package has no registry module.');

	console.log(
		'package',
		json({
			storageId: movePackage.storageId,
			originalId: movePackage.originalId,
			version: movePackage.version,
			modules: movePackage.modules
				.filter((module) =>
					['accounting', 'composition', 'custody', 'deposit', 'prices', 'rebalance', 'rebalance_state', 'redeem', 'registry', 'reserve'].includes(
						module.name ?? '',
					),
				)
				.map((module) => ({
				name: module.name,
				datatypes: module.datatypes.map((datatype) => datatype.typeName),
				functions: module.functions.map((fn) => fn.name),
			})),
		}),
	);
	const registryTypes = registryModule.datatypes.filter((datatype) =>
		['Registry', 'GenerationKey', 'StateV1', 'StateV2'].includes(datatype.name ?? ''),
	);
	console.log(
		'registry_abi',
		json({
			datatypes: registryTypes,
			functions: registryModule.functions.filter((fn) =>
				['current_generation', 'resolve', 'resolve_ro', 'version'].includes(fn.name ?? ''),
			),
		}),
	);
	console.log(
		'registry_object',
		json({
			objectId: registry.objectId,
			type: registry.type,
			version: registry.version,
			owner: registry.owner,
			moveJson: registry.json ?? null,
			moveContentBcsAvailable: registry.content !== undefined,
		}),
	);
	console.log(
		'registry_dynamic_fields',
		json({
			dynamicFields: dynamicFields.dynamicFields.map((field) => ({
				kind: field.$kind,
				fieldId: field.fieldId,
				nameType: field.name.type,
				nameBcs: `[${field.name.bcs.byteLength} BCS bytes]`,
				valueType: field.valueType,
				valueBcs: field.value ? `[${field.value.bcs.byteLength} BCS bytes]` : null,
			})),
			hasNextPage: dynamicFields.hasNextPage,
		}),
	);

	const fieldObjectIds = dynamicFields.dynamicFields
		.map((field) => field.fieldId)
		.filter((id): id is string => Boolean(id));
	if (fieldObjectIds.length > 0) {
		const { objects } = await client.getObjects({
			objectIds: fieldObjectIds,
			include: { content: true, json: true },
		});
		console.log(
			'dynamic_field_objects',
			json(
				objects.map((object) =>
					object instanceof Error
						? { error: object.message }
						: {
								objectId: object.objectId,
								type: object.type,
								version: object.version,
								owner: object.owner,
								moveJson: object.json ?? null,
							},
				),
			),
		);
	}
}

main().catch((error: unknown) => {
	console.error(`SUIX5 discovery failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
});
