import { z } from 'zod'
import {
	type ActionChain,
	type ActionDefinition,
	ActionInvocation,
	type OutputOfActionChain,
	createAction
} from './types'

// We will create a more elaborate schema construction function
export function createActionsExecutor<Actions extends Record<string, ActionDefinition<any, any>>>(
	actions: Actions
) {
	/**
	 * First, gather all actions and their outputs. We want to:
	 * - Create a map from output type -> list of actions producing that type.
	 * - Create a zod schema for each action invocation.
	 */

	// Extract output schema mapping
	type AnyAction = Actions[keyof Actions]

	// Get a unique signature for each output schema so we can group actions by output type.
	// For simplicity, we attempt a naive approach:
	// - If the output is a primitive (string, number, boolean), use that type as the key.
	// - If the output is an object schema, use a string describing it.
	// In a real scenario, you'd want a robust hashing.
	function outputTypeKey(schema: z.ZodTypeAny): string {
		const def = schema._def
		if (schema instanceof z.ZodString) return 'string'
		if (schema instanceof z.ZodNumber) return 'number'
		if (schema instanceof z.ZodBoolean) return 'boolean'
		// For object schemas, we can try to name them by their shape keys or a hash.
		// Here we just say it's an object and append some stable identifier.
		if (schema instanceof z.ZodObject) {
			const shapeKeys = Object.keys(schema.shape)
			// A stable pseudo-identifier from keys:
			return 'object_' + shapeKeys.join('_')
		}
		// Fallback:
		return 'unknown'
	}

	const actionSchemas: Record<string, z.ZodTypeAny> = {}
	const outputToActionsMap: Record<string, string[]> = {}

	// Step 1: Identify all actions and group by output type
	for (const [name, action] of Object.entries(actions)) {
		const key = outputTypeKey(action.schema.output)
		if (!outputToActionsMap[key]) {
			outputToActionsMap[key] = []
		}
		outputToActionsMap[key].push(name)
	}

	/**
	 * We'll create placeholders (z.lazy) for each "ActionUnionThatOutputs_..." schema.
	 * These are unions of actions that produce a given output type.
	 */

	const outputUnionSchemas: Record<string, z.ZodTypeAny> = {}

	for (const [outKey, actionNames] of Object.entries(outputToActionsMap)) {
		// We'll create a lazy reference that will later be filled in after we create each action schema
		outputUnionSchemas[outKey] = z
			.lazy(() =>
				z.union(
					actionNames.map(actionName => actionSchemas[actionName]) as [z.ZodTypeAny, ...z.ZodTypeAny[]]
				)
			)
			.describe(`ActionUnionThatOutputs_${outKey}`)
	}

	/**
	 * Now create each action schema. Each action schema is:
	 * {
	 *   action: literal(actionName),
	 *   params: { ... }
	 * }
	 * For each param, we union the original schema with the appropriate output union if needed.
	 * That means:
	 * - We know the param schema from action.schema.input.
	 * - If it's a string param, we do z.union([z.string(), outputUnionSchemas['string']])
	 * - If it's a number param, similarly for 'number'
	 * - If it's a contact object, we identify its output key and union with that.
	 */

	function paramSchemaForType(paramSchema: z.ZodTypeAny): z.ZodTypeAny {
		const paramOutKey = outputTypeKey(paramSchema)
		const unionSchema = outputUnionSchemas[paramOutKey]
		// If we have a matching union schema, we can allow chaining
		if (unionSchema) {
			return z.union([paramSchema, unionSchema])
		}
		// Otherwise, just return the param schema as-is
		return paramSchema
	}

	for (const [name, action] of Object.entries(actions)) {
		const inputShape = action.schema.input.shape
		const paramSchemas: Record<string, z.ZodTypeAny> = {}

		for (const [paramName, paramType] of Object.entries(inputShape)) {
			paramSchemas[paramName] = paramSchemaForType(paramType)
		}

		actionSchemas[name] = z
			.object({
				action: z.literal(name),
				params: z.object(paramSchemas).strict()
			})
			.describe(name)
	}

	/**
	 * Now that each action schema is created, the lazy unions referencing them should resolve properly.
	 * The top-level chain schema (ActionUnion) will be a union of all action schemas.
	 */

	const ActionUnion = z
		.lazy(() => z.union(Object.values(actionSchemas) as [z.ZodTypeAny, ...z.ZodTypeAny[]]))
		.describe('ActionUnion')

	const schema = z
		.object({
			execution: ActionUnion
		})
		.strict()
		.describe('TopLevelSchema')

	function execute<Chain extends ActionChain<Actions>>(
		invocation: Chain
	): OutputOfActionChain<Actions, Chain> {
		// Validate first
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
