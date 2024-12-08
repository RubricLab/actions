import { z } from 'zod'

/**
 * Strongly typed ActionDefinition using ZodRawShape for input schema.
 */
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

/** InputOfAction & OutputOfAction helper types */
type InputOfAction<A> = A extends ActionDefinition<infer S, any> ? z.infer<z.ZodObject<S>> : never

type OutputOfAction<A> = A extends ActionDefinition<any, infer O> ? z.infer<O> : never

/**
 * ParamType: a parameter can be a direct value or a chain producing that value.
 */
export type ParamType<Actions, T> = T | ActionChain<Actions, T>

/**
 * An invocation of a specific action.
 */
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

/**
 * An ActionChain that produces a specific ExpectedOutput:
 * It's a union of all actions whose output matches ExpectedOutput
 */
export type ActionChain<
	Actions extends Record<string, ActionDefinition<any, any>>,
	ExpectedOutput = unknown
> = {
	[K in keyof Actions]: OutputOfAction<Actions[K]> extends ExpectedOutput
		? ActionInvocation<Actions, K>
		: never
}[keyof Actions]

/** Extract output type from an action chain */
export type OutputOfActionChain<
	Actions extends Record<string, ActionDefinition<any, any>>,
	Chain extends ActionChain<Actions>
> = Chain extends ActionInvocation<Actions, infer ActionName>
	? OutputOfAction<Actions[ActionName]>
	: never

/**
 * Create a Zod schema for validating chains.
 * Using a z.lazy to handle recursion, and union all actions.
 */
export function createChainSchema<Actions extends Record<string, ActionDefinition<any, any>>>(
	actions: Actions
): z.ZodType<ActionChain<Actions>> {
	const chainSchema: z.ZodType<ActionChain<Actions>> = z.lazy(() => {
		const variants = Object.keys(actions).map(actionName => {
			const action = actions[actionName]
			const inputShape = action.schema.input.shape
			const paramSchemas = Object.fromEntries(
				Object.entries(inputShape).map(([paramName, paramSchema]) => {
					return [paramName, z.union([paramSchema, chainSchema])]
				})
			)

			return z.object({
				action: z.literal(actionName),
				params: z.object(paramSchemas)
			})
		})

		return z.union(variants) as z.ZodType<ActionChain<Actions>>
	})

	return chainSchema
}
