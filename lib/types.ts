import type { z } from 'zod'

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

// Extract input and output types for convenience
type InputOfAction<A> = A extends ActionDefinition<infer S, any> ? z.infer<z.ZodObject<S>> : never
type OutputOfAction<A> = A extends ActionDefinition<any, infer O> ? z.infer<O> : never

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
