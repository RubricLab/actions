import type { AnyZodObject, ZodType, z } from 'zod'
import { createChainSchema, createJsonSchema } from './utils'

export type ActionDefinition<InputSchema extends AnyZodObject, OutputSchema extends z.ZodType> = {
	name: string
	schema: {
		input: InputSchema
		output: OutputSchema
	}
	execute: (args: z.infer<InputSchema>) => z.infer<OutputSchema>
}

/** A record of named actions */
export type GenericActions = Record<string, ActionDefinition<AnyZodObject, ZodType>>

/** Create an action with full type inference for input and output. */
export function createAction<
	InputSchema extends AnyZodObject,
	OutputSchema extends z.ZodType
>(action: {
	name: string
	schema: {
		input: InputSchema
		output: OutputSchema
	}
	execute: (args: z.infer<InputSchema>) => z.infer<OutputSchema>
}): ActionDefinition<InputSchema, OutputSchema> {
	return action
}

/**
 * ParamType: a parameter can be a direct value or an action chain producing that value.
 */
export type ParamType<Actions extends GenericActions, T> = T | ActionChain<Actions, T>

/**
 * ActionInvocation: a call to a specific action with given params.
 */
export type ActionInvocation<Actions extends GenericActions, ActionName extends keyof Actions> = {
	action: ActionName
	params: {
		[P in keyof z.infer<Actions[ActionName]['schema']['input']>]: ParamType<
			Actions,
			z.infer<Actions[ActionName]['schema']['input']>[P]
		>
	}
}

/**
 * ActionChain: a union of all actions that produce `ExpectedOutput`.
 * Each action in that union can have parameters that are either direct values or further action chains.
 */
export type ActionChain<Actions extends GenericActions, ExpectedOutput = unknown> = {
	[K in keyof Actions]: z.infer<Actions[K]['schema']['output']> extends ExpectedOutput
		? ActionInvocation<Actions, K>
		: never
}[keyof Actions]

export type OutputOfActionChain<
	Actions extends GenericActions,
	Chain extends ActionChain<Actions>
> = Chain extends ActionInvocation<Actions, infer ActionName>
	? z.infer<Actions[ActionName]['schema']['output']>
	: never

/**
 * createActionsExecutor: Given a set of actions:
 *  - Produces a `schema` that validates action chains
 *  - Produces a `json_schema` for external tooling
 *  - Provides an `execute` function to run action chains
 */
export function createActionsExecutor<Actions extends GenericActions>(actions: Actions) {
	const schema = createChainSchema(actions)
	const json_schema = createJsonSchema(actions)

	function execute<Chain extends ActionChain<Actions>>(
		invocation: Chain
	): OutputOfActionChain<Actions, Chain> {
		const { action: actionName, params } = invocation
		const action = actions[actionName] ?? (undefined as never)

		// Recursively resolve parameters
		const input: Record<string, unknown> = {}
		for (const key in params) {
			const param = params[key]
			if (param && typeof param === 'object' && 'action' in param) {
				input[key] = execute(param as ActionChain<Actions>)
			} else {
				input[key] = param
			}
		}

		const validatedInput = action.schema.input.parse(input)
		return action.execute(validatedInput) as OutputOfActionChain<Actions, Chain>
	}

	return { execute, schema, json_schema }
}
