import { createHash } from 'node:crypto'
import { z } from 'zod'

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
type ActionDefinition<In extends z.ZodRawShape = any, Out extends z.ZodTypeAny = any> = {
	name: string
	schema: {
		input: z.ZodObject<In>
		output: Out
	}
	execute: (args: z.infer<z.ZodObject<In>>) => z.infer<Out>
}

export function createAction<In extends z.ZodRawShape, Out extends z.ZodTypeAny>(def: {
	name: string
	schema: { input: z.ZodObject<In>; output: Out }
	execute: (args: z.infer<z.ZodObject<In>>) => z.infer<Out>
}): ActionDefinition<In, Out> {
	return def
}

type InputOfAction<A> = A extends ActionDefinition<infer S> ? z.infer<z.ZodObject<S>> : never
type OutputOfAction<A> = A extends ActionDefinition<infer _, infer O> ? z.infer<O> : never

type ParamType<Actions, T> =
	| T
	| ActionChain<Actions extends Record<string, ActionDefinition> ? Actions : never, T>

type ActionInvocation<
	Actions extends Record<string, ActionDefinition>,
	ActionName extends keyof Actions
> = {
	action: ActionName
	params: {
		[P in keyof InputOfAction<Actions[ActionName]>]: ParamType<
			Actions,
			InputOfAction<Actions[ActionName]>[P]
		>
	}
}

type ActionChain<Actions extends Record<string, ActionDefinition>, ExpectedOutput = unknown> = {
	[K in keyof Actions]: OutputOfAction<Actions[K]> extends ExpectedOutput
		? ActionInvocation<Actions, K>
		: never
}[keyof Actions]

type OutputOfActionChain<
	Actions extends Record<string, ActionDefinition>,
	Chain extends ActionChain<Actions>
> = Chain extends ActionInvocation<Actions, infer ActionName>
	? OutputOfAction<Actions[ActionName]>
	: never

type ActionUnionType<Actions extends Record<string, ActionDefinition>> = {
	[K in keyof Actions]: {
		action: K
		params: {
			[P in keyof InputOfAction<Actions[K]>]:
				| InputOfAction<Actions[K]>[P]
				| ActionChain<Actions, InputOfAction<Actions[K]>[P]>
		}
	}
}[keyof Actions]

type TopLevelSchemaType<Actions extends Record<string, ActionDefinition>> = {
	execution: ActionUnionType<Actions>
}

function generateSignature(schema: z.ZodTypeAny): string {
	const def = schema._def

	switch (def.typeName) {
		case z.ZodFirstPartyTypeKind.ZodString:
			return 'string'
		case z.ZodFirstPartyTypeKind.ZodNumber:
			return 'number'
		case z.ZodFirstPartyTypeKind.ZodBoolean:
			return 'boolean'
		case z.ZodFirstPartyTypeKind.ZodLiteral:
			return `literal_${JSON.stringify(def.value)}`
		case z.ZodFirstPartyTypeKind.ZodObject: {
			const shape = def.shape()
			const entries = Object.entries(shape)
				.map(([k, v]) => `${k}-${generateSignature(v as z.ZodTypeAny)}`)
				.sort()
			return `object_${entries.join('_')}`
		}
		case z.ZodFirstPartyTypeKind.ZodUnion: {
			const options = def.options.map((opt: z.ZodTypeAny) => generateSignature(opt)).sort()
			return `union_${options.join('_or_')}`
		}
		default:
			return 'unknown'
	}
}

function shortHash(str: string): string {
	return createHash('sha1').update(str).digest('hex').slice(0, 8)
}

function stableName(schema: z.ZodTypeAny): string {
	const signature = generateSignature(schema)
	return `Schema_${shortHash(signature)}`
}

function stableDescribe(schema: z.ZodTypeAny): z.ZodTypeAny {
	if (schema._def.description) return schema
	const name = stableName(schema)
	return schema.describe(name)
}

function makeNonEmptyUnion(schemas: z.ZodTypeAny[]): z.ZodTypeAny {
	if (schemas.length === 0) {
		throw new Error('No schemas provided for union.')
	}
	if (schemas.length === 1) {
		return schemas[0] ?? (undefined as never)
	}
	return z.union(schemas as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
}

type JsonSchema = Record<string, unknown>

function makeCustomResponseFormat<ParsedT>(
	jsonSchema: JsonSchema,
	parser: (content: string) => ParsedT
) {
	const response_format = {
		type: 'json_schema',
		json_schema: {
			name: 'execution',
			strict: true,
			schema: jsonSchema
		}
	}

	const obj = { ...response_format }

	Object.defineProperties(obj, {
		$brand: {
			value: 'auto-parseable-response-format',
			enumerable: false
		},
		$parseRaw: {
			value: parser,
			enumerable: false
		}
	})

	return obj as {
		__output: ParsedT
		$brand: 'auto-parseable-response-format'
		$parseRaw(content: string): ParsedT
		type: 'json_schema'
		json_schema: {
			name: string
			strict: true
			schema: JsonSchema
		}
	}
}

export function createActionsExecutor<Actions extends Record<string, ActionDefinition>>(
	actions: Actions
) {
	function getOutputSchemaName(schema: z.ZodTypeAny): string {
		return stableName(schema)
	}

	const actionsByOutputName: Record<string, string[]> = {}
	for (const [name, action] of Object.entries(actions)) {
		const outName = getOutputSchemaName(action.schema.output)
		if (!actionsByOutputName[outName]) {
			actionsByOutputName[outName] = []
		}
		actionsByOutputName[outName].push(name)
	}

	const actionSchemas: Record<string, z.ZodTypeAny> = {}
	function paramSchemaForType(paramSchema: z.ZodTypeAny): z.ZodTypeAny {
		const outName = getOutputSchemaName(paramSchema)
		const possibleActions = (actionsByOutputName[outName] ?? [])
			.map(n => actionSchemas[n])
			.filter((x): x is z.ZodTypeAny => x !== undefined)

		if (possibleActions.length > 0) {
			return stableDescribe(
				z.union([paramSchema, ...possibleActions] as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
			)
		}

		return stableDescribe(paramSchema)
	}

	const actionSchemaBuilders: Record<string, () => z.ZodTypeAny> = {}

	for (const [name, action] of Object.entries(actions)) {
		actionSchemaBuilders[name] = () => {
			const shape = action.schema.input.shape
			const paramsShape: Record<string, z.ZodTypeAny> = {}
			for (const key in shape) {
				paramsShape[key] = paramSchemaForType(shape[key])
			}
			return z.object({
				action: z.literal(name),
				params: z.object(paramsShape).strict()
			})
		}
	}

	for (const [name] of Object.entries(actions)) {
		actionSchemas[name] = z.lazy(actionSchemaBuilders[name] ?? (undefined as never))
	}

	const ActionUnion = z.lazy(() => {
		const schemaArray = Object.values(actionSchemas)
		return stableDescribe(makeNonEmptyUnion(schemaArray))
	})

	const schemaBase = z.object({ execution: ActionUnion }).strict()
	const schema = schemaBase as z.ZodType<TopLevelSchemaType<Actions>>

	function execute<Chain extends ActionChain<Actions>>(
		invocation: Chain
	): OutputOfActionChain<Actions, Chain> {
		const parsed = schema.parse({ execution: invocation })
		return executeAction(parsed.execution)
	}

	function executeAction<Chain extends ActionChain<Actions>>(
		invocation: Chain
	): OutputOfActionChain<Actions, Chain> {
		const { action: actionName, params } = invocation
		const action = actions[actionName]
		if (!action) {
			throw new Error(`Unknown action: ${String(actionName)}`)
		}

		const input: Record<string, unknown> = {}
		for (const key in params) {
			const param = params[key]
			if (param && typeof param === 'object' && 'action' in param) {
				input[key] = executeAction(param as ActionChain<Actions>)
			} else {
				input[key] = param
			}
		}

		const validatedInput = action.schema.input.parse(input)
		return action.execute(validatedInput)
	}

	function zodToJsonSchema(zodType: z.ZodTypeAny): unknown {
		const def = zodType._def
		switch (def.typeName) {
			case z.ZodFirstPartyTypeKind.ZodString:
				return { type: 'string' }
			case z.ZodFirstPartyTypeKind.ZodNumber:
				return { type: 'number' }
			case z.ZodFirstPartyTypeKind.ZodBoolean:
				return { type: 'boolean' }
			case z.ZodFirstPartyTypeKind.ZodLiteral:
				return { type: typeof def.value, const: def.value }
			case z.ZodFirstPartyTypeKind.ZodObject: {
				const shape = def.shape()
				const properties: Record<string, unknown> = {}
				const required: string[] = []
				for (const [key, val] of Object.entries(shape)) {
					properties[key] = zodToJsonSchema(val as z.ZodTypeAny)
					required.push(key)
				}
				return {
					type: 'object',
					properties,
					required,
					additionalProperties: false
				}
			}
			case z.ZodFirstPartyTypeKind.ZodUnion: {
				const unionDef = def as z.ZodUnionDef
				return { anyOf: unionDef.options.map((opt: z.ZodTypeAny) => zodToJsonSchema(opt)) }
			}
			default:
				return {}
		}
	}

	const definitions: Record<string, unknown> = {}

	function ensureOutputDefinition(schema: z.ZodTypeAny): string {
		const name = stableName(schema)
		if (!definitions[name]) {
			definitions[name] = zodToJsonSchema(schema)
		}
		return name
	}

	for (const [_, action] of Object.entries(actions)) {
		ensureOutputDefinition(action.schema.output)
	}

	function paramToJsonSchema(paramSchema: z.ZodTypeAny) {
		const outName = getOutputSchemaName(paramSchema)

		const baseSchema = zodToJsonSchema(paramSchema)
		if (actionsByOutputName[outName]) {
			const possibleActions = actionsByOutputName[outName].map(aName => {
				return { $ref: `#/definitions/${aName}Action` }
			})
			return { anyOf: [baseSchema, ...possibleActions] }
		}
		return baseSchema
	}

	for (const [actionName, action] of Object.entries(actions)) {
		const paramsShape = action.schema.input.shape
		const paramProps: Record<string, unknown> = {}
		const required: string[] = []

		for (const key in paramsShape) {
			paramProps[key] = paramToJsonSchema(paramsShape[key])
			required.push(key)
		}

		definitions[`${actionName}Action`] = {
			type: 'object',
			properties: {
				action: { type: 'string', const: actionName },
				params: {
					type: 'object',
					properties: paramProps,
					required,
					additionalProperties: false
				}
			},
			required: ['action', 'params'],
			additionalProperties: false
		}
	}

	const actionUnion = {
		anyOf: Object.keys(actions).map(aName => ({ $ref: `#/definitions/${aName}Action` }))
	}

	const jsonSchema = {
		$schema: 'http://json-schema.org/draft-07/schema#',
		type: 'object',
		properties: {
			execution: actionUnion
		},
		required: ['execution'],
		additionalProperties: false,
		definitions
	}

	const response_format = makeCustomResponseFormat<z.infer<typeof schema>>(jsonSchema, content =>
		schema.parse(JSON.parse(content))
	)

	return { execute, schema, response_format }
}
