import { z } from 'zod'

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

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
type InputOfAction<A> = A extends ActionDefinition<infer S, any> ? z.infer<z.ZodObject<S>> : never

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
type OutputOfAction<A> = A extends ActionDefinition<any, infer O> ? z.infer<O> : never

export type ParamType<Actions, T> =
	| T
	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	| ActionChain<Actions extends Record<string, ActionDefinition<any, any>> ? Actions : never, T>

export type ActionInvocation<
	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
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
	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	Actions extends Record<string, ActionDefinition<any, any>>,
	ExpectedOutput = unknown
> = {
	[K in keyof Actions]: OutputOfAction<Actions[K]> extends ExpectedOutput
		? ActionInvocation<Actions, K>
		: never
}[keyof Actions]

export type OutputOfActionChain<
	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	Actions extends Record<string, ActionDefinition<any, any>>,
	Chain extends ActionChain<Actions>
> = Chain extends ActionInvocation<Actions, infer ActionName>
	? OutputOfAction<Actions[ActionName]>
	: never

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
export function createChainSchema<Actions extends Record<string, ActionDefinition<any, any>>>(
	actions: Actions
): z.ZodType<ActionChain<Actions>> {
	const chainSchema: z.ZodType<ActionChain<Actions>> = z.lazy(() => {
		const variants = Object.keys(actions).map(actionName => {
			const action = actions[actionName] ?? (undefined as never)
			const inputShape = action.schema.input.shape
			const paramSchemas = Object.fromEntries(
				Object.entries(inputShape).map(([paramName, paramSchema]) => {
					return [paramName, z.union([paramSchema as z.ZodTypeAny, chainSchema])]
				})
			)

			return z.object({
				action: z.literal(actionName),
				params: z.object(paramSchemas)
			})
		})

		return z.union(
			variants as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]
		) as z.ZodType<ActionChain<Actions>>
	})

	return chainSchema
}
