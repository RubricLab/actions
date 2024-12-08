import {
	type ActionChain,
	type ActionDefinition,
	type OutputOfActionChain,
	createChainSchema
} from './types'
import { createJsonSchema } from './utils'

export function createActionsExecutor<Actions extends Record<string, ActionDefinition<any, any>>>(
	actions: Actions
) {
	const schema = createChainSchema(actions)
	const json_schema = createJsonSchema(actions)

	function execute<Chain extends ActionChain<Actions>>(
		invocation: Chain
	): OutputOfActionChain<Actions, Chain> {
		const { action: actionName, params } = invocation
		const action = actions[actionName]

		const input: Record<string, unknown> = {}
		for (const key in params) {
			const param = params[key]
			if (param && typeof param === 'object' && 'action' in param) {
				// Nested chain
				input[key] = execute(param as ActionChain<Actions>)
			} else {
				// Direct value
				input[key] = param
			}
		}

		const validatedInput = action.schema.input.parse(input)
		return action.execute(validatedInput)
	}

	return { execute, schema, json_schema }
}
