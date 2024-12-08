import { z } from 'zod'

// Original definitions with type safety:
export type ActionDefinition<S extends z.ZodRawShape, OutSchema extends z.ZodTypeAny> = {
	name: string
	schema: {
		input: z.ZodObject<S>
		output: OutSchema
	}
	execute: (args: z.infer<z.ZodObject<S>>) => z.infer<OutSchema>
}

export function createAction<S extends z.ZodRawShape, Out extends z.ZodTypeAny>(def: {
	name: string
	schema: { input: z.ZodObject<S>; output: Out }
	execute: (args: z.infer<z.ZodObject<S>>) => z.infer<Out>
}): ActionDefinition<S, Out> {
	return def
}

// Helpers to extract input/output types from actions
type InputOfAction<A> = A extends ActionDefinition<infer S, any> ? z.infer<z.ZodObject<S>> : never
type OutputOfAction<A> = A extends ActionDefinition<any, infer O> ? z.infer<O> : never

// ParamType, ActionInvocation, ActionChain, and OutputOfActionChain remain similar
export type ParamType<Actions, T> =
	| T
	| ActionChain<Actions extends Record<string, ActionDefinition<any, any>> ? Actions : never, T>

export type ActionInvocation<
	Actions extends Record<string, ActionDefinition<any, any>>,
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

export type ActionChain<
	Actions extends Record<string, ActionDefinition<any, any>>,
	ExpectedOutput = unknown
> = {
	[K in keyof Actions]: OutputOfAction<Actions[K]> extends ExpectedOutput
		? ActionInvocation<Actions, K>
		: never
}[keyof Actions]

export type OutputOfActionChain<
	Actions extends Record<string, ActionDefinition<any, any>>,
	Chain extends ActionChain<Actions>
> = Chain extends ActionInvocation<Actions, infer ActionName>
	? OutputOfAction<Actions[ActionName]>
	: never

type ActionUnionType<Actions extends Record<string, ActionDefinition<any, any>>> = {
	[K in keyof Actions]: {
		action: K
		params: {
			[P in keyof InputOfAction<Actions[K]>]:
				| InputOfAction<Actions[K]>[P]
				| ActionChain<Actions, InputOfAction<Actions[K]>[P]>
		}
	}
}[keyof Actions]

type TopLevelSchemaType<Actions extends Record<string, ActionDefinition<any, any>>> = {
	execution: ActionUnionType<Actions>
}

export function createActionsExecutor<Actions extends Record<string, ActionDefinition<any, any>>>(
	actions: Actions
) {
	function getOutputSchemaName(schema: z.ZodTypeAny): string {
		if (schema.description) return schema.description
		throw new Error('Output schema has no description. Please use .describe() on your output schema.')
	}

	const actionsByOutputName: Record<string, string[]> = {}
	const actionSchemas: Record<string, z.ZodTypeAny> = {}

	for (const [name, action] of Object.entries(actions)) {
		const outName = getOutputSchemaName(action.schema.output)
		if (!actionsByOutputName[outName]) {
			actionsByOutputName[outName] = []
		}
		actionsByOutputName[outName].push(name)
	}

	const outputUnions: Record<string, z.ZodTypeAny> = {}

	for (const outName of Object.keys(actionsByOutputName)) {
		outputUnions[outName] = z
			.lazy(() =>
				z.union(
					actionsByOutputName[outName].map(n => actionSchemas[n]) as [z.ZodTypeAny, ...z.ZodTypeAny[]]
				)
			)
			.describe(`ActionUnionThatOutputs_${outName}`)
	}

	function paramSchemaForType(paramSchema: z.ZodTypeAny): z.ZodTypeAny {
		const outName = paramSchema.description
		if (outName && outputUnions[outName]) {
			return z.union([paramSchema, outputUnions[outName]])
		}

		if (paramSchema instanceof z.ZodString && outputUnions.string) {
			return z.union([paramSchema, outputUnions.string])
		}
		if (paramSchema instanceof z.ZodNumber && outputUnions.number) {
			return z.union([paramSchema, outputUnions.number])
		}
		if (paramSchema instanceof z.ZodBoolean && outputUnions.boolean) {
			return z.union([paramSchema, outputUnions.boolean])
		}

		return paramSchema
	}

	for (const [name, action] of Object.entries(actions)) {
		const shape = action.schema.input.shape
		const paramsShape: Record<string, z.ZodTypeAny> = {}
		for (const [key, val] of Object.entries(shape)) {
			paramsShape[key] = paramSchemaForType(val)
		}

		actionSchemas[name] = z
			.object({
				action: z.literal(name),
				params: z.object(paramsShape).strict()
			})
			.describe(name)
	}

	const ActionUnion = z
		.lazy(() => z.union(Object.values(actionSchemas) as [z.ZodTypeAny, ...z.ZodTypeAny[]]))
		.describe('ActionUnion')

	const schemaBase = z
		.object({
			execution: ActionUnion
		})
		.strict()
		.describe('TopLevelSchema')

	// Cast schema to the precise inferred type
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

	return { execute, schema }
}
