import { createHash } from 'node:crypto'
import { z } from 'zod'

// biome-ignore lint/suspicious/noExplicitAny: single required "any" to not overwhelm generics
type ActionDefinition<In extends z.ZodRawShape = any, Out extends z.ZodTypeAny = any> = {
	schema: { input: z.ZodObject<In>; output?: Out }
	execute: (args: z.infer<z.ZodObject<In>>) => Promise<z.infer<Out>>
}

type AnyActions = Record<string, ActionDefinition>

export function createAction<In extends z.ZodRawShape, Out extends z.ZodTypeAny>(def: {
	schema: { input: z.ZodObject<In>; output?: Out }
	execute: (args: z.infer<z.ZodObject<In>>) => Promise<z.infer<Out>>
}): ActionDefinition<In, Out> {
	return def
}

type InputOfAction<A> = A extends ActionDefinition<infer S> ? z.infer<z.ZodObject<S>> : never
type OutputOfAction<A> = A extends ActionDefinition<infer _, infer O> ? z.infer<O> : never

type ActionInvocation<Actions extends AnyActions, Name extends keyof Actions> = {
	action: Name
	params: {
		[P in keyof InputOfAction<Actions[Name]>]:
			| InputOfAction<Actions[Name]>[P]
			| ActionChain<Actions, InputOfAction<Actions[Name]>[P]>
	}
}

export type ActionChain<Actions extends AnyActions, ExpectedOutput = unknown> = {
	[K in keyof Actions]: OutputOfAction<Actions[K]> extends ExpectedOutput
		? ActionInvocation<Actions, K>
		: never
}[keyof Actions]

export type OutputOfActionChain<
	Actions extends AnyActions,
	Chain extends ActionChain<Actions>
> = Chain extends ActionInvocation<Actions, infer N> ? OutputOfAction<Actions[N]> : never

type ActionUnionType<Actions extends AnyActions> = {
	[K in keyof Actions]: {
		action: K
		params: {
			[P in keyof InputOfAction<Actions[K]>]:
				| InputOfAction<Actions[K]>[P]
				| ActionChain<Actions, InputOfAction<Actions[K]>[P]>
		}
	}
}[keyof Actions]

type TopLevelSchemaType<Actions extends AnyActions> = {
	execution: ActionUnionType<Actions>
}

function generateSignature(schema: z.ZodTypeAny): string {
	const def = schema?._def
	if (!def) return 'unknown'
	switch (def.typeName) {
		case z.ZodFirstPartyTypeKind.ZodString:
			return 'string'
		case z.ZodFirstPartyTypeKind.ZodNumber:
			return 'number'
		case z.ZodFirstPartyTypeKind.ZodBoolean:
			return 'boolean'
		case z.ZodFirstPartyTypeKind.ZodLiteral:
			return `literal_${JSON.stringify(def.value)}`
		case z.ZodFirstPartyTypeKind.ZodVoid:
			return 'void'
		case z.ZodFirstPartyTypeKind.ZodObject: {
			const shape = def.shape()
			const entries = Object.entries(shape)
				.map(([k, v]) => `${k}-${generateSignature(v as z.ZodTypeAny)}`)
				.sort()
			return `object_${entries.join('_')}`
		}
		case z.ZodFirstPartyTypeKind.ZodUnion:
			return `union_${(def.options as z.ZodTypeAny[]).map(generateSignature).sort().join('_or_')}`
		case z.ZodFirstPartyTypeKind.ZodEnum:
			return `enum_${def.values.sort().join('_')}`
		case z.ZodFirstPartyTypeKind.ZodArray:
			return `array_${generateSignature(def.type)}`
		case z.ZodFirstPartyTypeKind.ZodNativeEnum:
			return `native_enum_${Object.values(def.values).sort().join('_')}`
		default:
			return 'unknown'
	}
}

const shortHash = (str: string) => createHash('sha1').update(str).digest('hex').slice(0, 8)
const stableName = (schema: z.ZodTypeAny) => `Schema_${shortHash(generateSignature(schema))}`
const stableDescribe = (schema: z.ZodTypeAny) =>
	schema._def.description ? schema : schema.describe(stableName(schema))

function makeNonEmptyUnion(schemas: z.ZodTypeAny[]) {
	if (!schemas.length) throw new Error('No schemas')
	return schemas.length === 1
		? (schemas[0] ?? (undefined as never))
		: z.union(schemas as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
}

type JsonSchema = Record<string, unknown>

function makeCustomResponseFormat<ParsedT>(jsonSchema: JsonSchema, parser: (c: string) => ParsedT) {
	const obj = {
		type: 'json_schema',
		json_schema: { name: 'execution', strict: true, schema: jsonSchema }
	}
	Object.defineProperties(obj, {
		$brand: { value: 'auto-parseable-response-format', enumerable: false },
		$parseRaw: { value: parser, enumerable: false }
	})
	return obj as {
		__output: ParsedT
		$brand: 'auto-parseable-response-format'
		$parseRaw(c: string): ParsedT
		type: 'json_schema'
		json_schema: { name: string; strict: true; schema: JsonSchema }
	}
}

export function zodToJsonSchema(zodType: z.ZodTypeAny): unknown {
	const def = zodType?._def
	if (!def) return { type: 'unknown' }
	switch (def.typeName) {
		case z.ZodFirstPartyTypeKind.ZodString:
			return { type: 'string' }
		case z.ZodFirstPartyTypeKind.ZodNumber:
			return { type: 'number' }
		case z.ZodFirstPartyTypeKind.ZodBoolean:
			return { type: 'boolean' }
		case z.ZodFirstPartyTypeKind.ZodLiteral:
			return { type: typeof def.value, const: def.value }
		case z.ZodFirstPartyTypeKind.ZodVoid:
			return { type: 'void' }
		case z.ZodFirstPartyTypeKind.ZodObject: {
			const shape = def.shape()
			const props: Record<string, unknown> = {}
			const req: string[] = []
			Object.entries(shape).map(([k, v]) => {
				props[k] = zodToJsonSchema(v as z.ZodTypeAny)
				req.push(k)
			})
			return { type: 'object', properties: props, required: req, additionalProperties: false }
		}
		case z.ZodFirstPartyTypeKind.ZodUnion: {
			const unionDef = def as z.ZodUnionDef
			return { anyOf: unionDef.options.map((opt: z.ZodTypeAny) => zodToJsonSchema(opt)) }
		}
		case z.ZodFirstPartyTypeKind.ZodEnum:
			return { type: 'string', enum: def.values }
		case z.ZodFirstPartyTypeKind.ZodArray:
			return { type: 'array', items: zodToJsonSchema(def.type) }
		case z.ZodFirstPartyTypeKind.ZodNativeEnum:
			return { type: 'string', enum: Object.values(def.values) }
		case z.ZodFirstPartyTypeKind.ZodOptional:
			return zodToJsonSchema(def.innerType)
		case z.ZodFirstPartyTypeKind.ZodDate:
			return { type: 'string', format: 'date-time' }
		case z.ZodFirstPartyTypeKind.ZodDefault:
			return zodToJsonSchema(def.innerType)
		case z.ZodFirstPartyTypeKind.ZodNullable:
			return zodToJsonSchema(def.innerType)
		default:
			throw `Should not see this. This is an actions package error. Unknown type: ${def.typeName}`
	}
}

export function createActionsExecutor<Actions extends AnyActions>(actions: Actions) {
	const actionsByOutputName: Record<string, string[]> = {}
	Object.entries(actions).map(([name, action]) => {
		const outName = stableName(action.schema.output)
		if (!actionsByOutputName[outName]) actionsByOutputName[outName] = []
		actionsByOutputName[outName].push(name)
	})

	const actionSchemas: Record<string, z.ZodTypeAny> = {}
	const paramSchemaForType = (paramSchema: z.ZodTypeAny) => {
		const outName = stableName(paramSchema)
		const acts = (actionsByOutputName[outName] ?? [])
			.map(n => actionSchemas[n])
			.filter((x): x is z.ZodTypeAny => !!x)
		return stableDescribe(
			acts.length
				? z.union([paramSchema, ...acts] as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
				: paramSchema
		)
	}

	const actionSchemaBuilders: Record<string, () => z.ZodTypeAny> = {}
	Object.entries(actions).map(([name, action]) => {
		actionSchemaBuilders[name] = () => {
			const shape = action.schema.input.shape
			const paramsShape: Record<string, z.ZodTypeAny> = {}
			for (const key in shape) paramsShape[key] = paramSchemaForType(shape[key])
			return z.object({ action: z.literal(name), params: z.object(paramsShape).strict() })
		}
	})

	Object.keys(actions).map(name => {
		actionSchemas[name] = z.lazy(actionSchemaBuilders[name] ?? (undefined as never))
	})

	const ActionUnion = z.lazy(() => stableDescribe(makeNonEmptyUnion(Object.values(actionSchemas))))
	const schemaBase = z.object({ execution: ActionUnion }).strict()
	const schema = schemaBase as z.ZodType<TopLevelSchemaType<Actions>>

	async function execute<Chain extends ActionChain<Actions>>(
		invocation: Chain
	): Promise<OutputOfActionChain<Actions, Chain>> {
		const parsed = schema.parse({ execution: invocation })
		return await executeAction(parsed.execution)
	}

	async function getActionSchema(actionName: keyof Actions): Promise<z.ZodObject<z.ZodRawShape>> {
		const action = actions[actionName]
		if (!action) throw new Error(`Unknown action: ${String(actionName)}`)
		return action.schema.input.shape
	}

	async function getActionNames(): Promise<Array<keyof Actions>> {
		return Object.keys(actions)
	}

	async function executeAction<Chain extends ActionChain<Actions>>(
		invocation: Chain
	): Promise<OutputOfActionChain<Actions, Chain>> {
		const { action: actionName, params } = invocation
		const action = actions[actionName]
		if (!action) throw new Error(`Unknown action: ${String(actionName)}`)
		const input: Record<string, unknown> = {}
		for (const key in params) {
			const param = params[key]
			input[key] =
				param && typeof param === 'object' && 'action' in param ? await executeAction(param) : param
		}
		return await action.execute(action.schema.input.parse(input))
	}

	const definitions: Record<string, unknown> = {}
	const ensureOutputDefinition = (schema: z.ZodTypeAny) => {
		const name = stableName(schema)
		if (!definitions[name]) definitions[name] = zodToJsonSchema(schema)
		return name
	}

	Object.values(actions).map(a => ensureOutputDefinition(a.schema.output))

	const paramToJsonSchema = (paramSchema: z.ZodTypeAny) => {
		const outName = stableName(paramSchema)
		const base = zodToJsonSchema(paramSchema)
		const refs = (actionsByOutputName[outName] ?? []).map(aName => ({
			$ref: `#/definitions/${aName}Action`
		}))
		return refs.length ? { anyOf: [base, ...refs] } : base
	}

	Object.entries(actions).map(([actionName, action]) => {
		const shape = action.schema.input.shape
		const props: Record<string, unknown> = {}
		const req: string[] = []
		for (const key in shape) {
			props[key] = paramToJsonSchema(shape[key] ?? (undefined as never))
			req.push(key)
		}
		definitions[`${actionName}Action`] = {
			type: 'object',
			properties: {
				action: { type: 'string', const: actionName },
				params: { type: 'object', properties: props, required: req, additionalProperties: false }
			},
			required: ['action', 'params'],
			additionalProperties: false
		}
	})

	const actionUnion = {
		anyOf: Object.keys(actions).map(aName => ({ $ref: `#/definitions/${aName}Action` }))
	}
	const jsonSchema = {
		$schema: 'http://json-schema.org/draft-07/schema#',
		type: 'object',
		properties: { execution: actionUnion },
		required: ['execution'],
		additionalProperties: false,
		definitions
	}

	const response_format = makeCustomResponseFormat<z.infer<typeof schema>>(jsonSchema, c =>
		schema.parse(JSON.parse(c))
	)

	return { execute, getActionSchema, getActionNames, schema, response_format }
}
