import crypto from 'node:crypto'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { ActionDefinition } from './types'

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
function hashSchema(schemaJson: any): string {
	const jsonString = JSON.stringify(schemaJson, Object.keys(schemaJson).sort())
	const hash = crypto.createHash('sha256').update(jsonString).digest('hex')
	return hash.slice(0, 8)
}

const schemaNameCache = new WeakMap<z.ZodTypeAny, string>()

export function getStableTypeName(schema: z.ZodTypeAny): string {
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
	schemaNameCache.set(schema, 'unknown')
	return 'unknown'
}

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
export function createJsonSchema<Actions extends Record<string, ActionDefinition<any, any>>>(
	actions: Actions
) {
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

	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	const definitions: Record<string, any> = {}

	for (const actionName in actions) {
		const action = actions[actionName] ?? (undefined as never)
		const inputObject = action.schema.input
		// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		const paramProperties: Record<string, any> = {}
		const requiredParams = Object.keys(inputObject.shape)

		for (const [paramName, paramSchema] of Object.entries(inputObject.shape)) {
			const paramJsonSchema = zodToJsonSchema(paramSchema as z.ZodType, { $refStrategy: 'none' })
			const paramTypeName = getStableTypeName(paramSchema as z.ZodType)
			const hasActionUnion =
				actionsByOutputType[paramTypeName] && actionsByOutputType[paramTypeName].length > 0
			const unionRef = hasActionUnion ? { $ref: actionUnionRefFor(paramTypeName) } : undefined

			if (paramSchema instanceof z.ZodObject) {
				const anyOfSchemas = [paramJsonSchema]
				if (unionRef) {
					anyOfSchemas.push(unionRef)
				}
				paramProperties[paramName] = { anyOf: anyOfSchemas }
			} else {
				const anyOfSchemas = [paramJsonSchema]
				if (unionRef) {
					anyOfSchemas.push(unionRef)
				}
				paramProperties[paramName] = { anyOf: anyOfSchemas }
			}
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
