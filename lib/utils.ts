import crypto from 'node:crypto'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { ActionChain, ActionDefinition, OutputOfActionChain } from './types'

function hashSchema(schemaJson: any): string {
	const jsonString = JSON.stringify(schemaJson, Object.keys(schemaJson).sort())
	const hash = crypto.createHash('sha256').update(jsonString).digest('hex')
	return hash.slice(0, 8)
}

const schemaNameCache = new WeakMap<z.ZodTypeAny, string>()

function getStableTypeName(schema: z.ZodTypeAny): string {
	if (schemaNameCache.has(schema)) {
		return schemaNameCache.get(schema) ?? (undefined as never)
	}

	if (schema instanceof z.ZodString) {
		schemaNameCache.set(schema, 'string')
		return 'string'
	}
	if (schema instanceof z.ZodNumber) {
		schemaNameCache.set(schema, 'number')
		return 'number'
	}
	if (schema instanceof z.ZodBoolean) {
		schemaNameCache.set(schema, 'boolean')
		return 'boolean'
	}
	if (schema instanceof z.ZodVoid) {
		schemaNameCache.set(schema, 'void')
		return 'void'
	}
	if (schema instanceof z.ZodObject) {
		const jsonSchema = zodToJsonSchema(schema, { $refStrategy: 'none' })
		const hash = hashSchema(jsonSchema)
		const typeName = `object_${hash}`
		schemaNameCache.set(schema, typeName)
		return typeName
	}

	// fallback
	schemaNameCache.set(schema, 'unknown')
	return 'unknown'
}

function createJsonSchema<Actions extends Record<string, ActionDefinition<any, any>>>(
	actions: Actions
) {
	// Group actions by output type name
	const actionsByOutputType: Record<string, string[]> = {}
	for (const actionName in actions) {
		const action = actions[actionName] ?? (undefined as never)
		const outputTypeName = getStableTypeName(action.schema.output)
		if (!actionsByOutputType[outputTypeName]) {
			actionsByOutputType[outputTypeName] = []
		}
		actionsByOutputType[outputTypeName].push(actionName)
	}

	function actionUnionRefFor(outputTypeName: string) {
		return `#/definitions/ActionUnionThatOutputs_${outputTypeName}`
	}

	const definitions: Record<string, any> = {}

	for (const actionName in actions) {
		const action = actions[actionName] ?? (undefined as never)
		const inputObject = action.schema.input
		const paramProperties: Record<string, any> = {}
		const requiredParams = Object.keys(inputObject.shape)

		for (const [paramName, paramSchema] of Object.entries(inputObject.shape)) {
			const paramJsonSchema = zodToJsonSchema(paramSchema, { $refStrategy: 'none' })
			const paramTypeName = getStableTypeName(paramSchema)

			const anyOfSchemas = [paramJsonSchema]
			if (actionsByOutputType[paramTypeName] && actionsByOutputType[paramTypeName].length > 0) {
				anyOfSchemas.push({ $ref: actionUnionRefFor(paramTypeName) })
			}

			paramProperties[paramName] = { anyOf: anyOfSchemas }
		}

		definitions[actionName] = {
			type: 'object',
			properties: {
				action: { type: 'string', const: actionName },
				params: {
					type: 'object',
					properties: paramProperties,
					required: requiredParams,
					additionalProperties: false
				}
			},
			required: ['action', 'params'],
			additionalProperties: false
		}
	}

	for (const outputTypeName in actionsByOutputType) {
		const refs = actionsByOutputType[outputTypeName]?.map(name => ({ $ref: `#/definitions/${name}` }))
		definitions[`ActionUnionThatOutputs_${outputTypeName}`] = { anyOf: refs }
	}

	const allActionsRefs = Object.keys(actions).map(name => ({ $ref: `#/definitions/${name}` }))
	definitions.ActionUnion = { anyOf: allActionsRefs }

	const finalSchema = {
		type: 'object',
		properties: {
			execution: { $ref: '#/definitions/ActionUnion' }
		},
		required: ['execution'],
		additionalProperties: false,
		definitions,
		$schema: 'http://json-schema.org/draft-07/schema#'
	}

	return {
		type: 'json_schema' as const,
		json_schema: {
			name: 'schema',
			strict: true,
			schema: finalSchema
		}
	}
}

function createChainSchema<Actions extends Record<string, ActionDefinition<any, any>>>(
	actions: Actions
): z.ZodType<ActionChain<Actions>> {
	const chainSchema: z.ZodType<ActionChain<Actions>> = z.lazy(() => {
		const variants = Object.keys(actions).map(actionName => {
			const action = actions[actionName] ?? (undefined as never)
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

export function createAction<S extends z.ZodRawShape, Out extends z.ZodTypeAny>(def: {
	name: string
	schema: { input: z.ZodObject<S>; output: Out }
	execute: (args: z.infer<z.ZodObject<S>>) => z.infer<Out>
}): ActionDefinition<S, Out> {
	return def
}

export function createActionsExecutor<Actions extends Record<string, ActionDefinition<any, any>>>(
	actions: Actions
) {
	const schema = createChainSchema(actions)
	const json_schema = createJsonSchema(actions)

	function execute<Chain extends ActionChain<Actions>>(
		invocation: Chain
	): OutputOfActionChain<Actions, Chain> {
		const { action: actionName, params } = invocation
		const action = actions[actionName] ?? (undefined as never)

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
		return action.execute(validatedInput)
	}

	return { execute, schema, json_schema }
}
