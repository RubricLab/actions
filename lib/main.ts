import { createHash } from 'node:crypto'
import { z } from 'zod'

// ============= Action and Type Definitions =============

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

// ============= Automatic Naming Helpers =============

// Generate a signature string based on the schema structure
function generateSignature(schema: z.ZodTypeAny): string {
	const def = schema._def

	switch (def.typeName) {
		case z.ZodFirstPartyTypeKind.ZodString:
			return 'string'
		case z.ZodFirstPartyTypeKind.ZodNumber:
			return 'number'
		case z.ZodFirstPartyTypeKind.ZodBoolean:
			return 'boolean'
		case z.ZodFirstPartyTypeKind.ZodLiteral:
			return `literal_${JSON.stringify(def.value)}`
		case z.ZodFirstPartyTypeKind.ZodObject: {
			const shape = def.shape()
			const entries = Object.entries(shape)
				.map(([k, v]) => `${k}-${generateSignature(v)}`)
				.sort()
			return 'object_' + entries.join('_')
		}
		case z.ZodFirstPartyTypeKind.ZodUnion: {
			const options = def.options.map((opt: z.ZodTypeAny) => generateSignature(opt)).sort()
			return 'union_' + options.join('_or_')
		}
		// Add cases for array, enum, optional, nullable, etc., if needed.
		default:
			return 'unknown'
	}
}

// Create a stable short hash from the signature
function shortHash(str: string): string {
	return createHash('sha1').update(str).digest('hex').slice(0, 8)
}

// Generate a stable name for the schema
function stableName(schema: z.ZodTypeAny): string {
	const signature = generateSignature(schema)
	return `Schema_${shortHash(signature)}`
}

// A function that ensures the schema is described with a stable name if not already described
function stableDescribe(schema: z.ZodTypeAny): z.ZodTypeAny {
	if (schema._def.description) return schema
	const name = stableName(schema)
	return schema.describe(name)
}

// Create a union safely
function makeNonEmptyUnion(schemas: z.ZodTypeAny[]): z.ZodTypeAny {
	if (schemas.length === 0) {
		throw new Error('No schemas provided for union.')
	}
	if (schemas.length === 1) {
		return schemas[0]!
	}
	return z.union(schemas as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
}

export function makeCustomResponseFormat<ParsedT>(
	jsonSchema: any, // The JSON schema definition
	parser: (content: string) => ParsedT
): {
	__output: ParsedT
	$brand: 'auto-parseable-response-format'
	$parseRaw(content: string): ParsedT
	type: 'json_schema'
	json_schema: {
		name: string
		strict: true
		schema: any
	}
} {
	const response_format = {
		type: 'json_schema',
		json_schema: {
			name: 'execution',
			strict: true,
			schema: jsonSchema
		}
	}

	const obj = { ...response_format }

	Object.defineProperties(obj, {
		$brand: {
			value: 'auto-parseable-response-format',
			enumerable: false
		},
		$parseRaw: {
			value: parser,
			enumerable: false
		}
	})

	return obj as any
}

// ============= Main Executor Factory =============

export function createActionsExecutor<Actions extends Record<string, ActionDefinition<any, any>>>(
	actions: Actions
) {
	function getOutputSchemaName(schema: z.ZodTypeAny): string {
		// Instead of requiring .describe(), we generate a name from its structure
		// We'll use the signature itself or a hash.
		// But we must use some stable naming for output type unions.
		return stableName(schema) // This gives a unique name even for output schema
	}

	const actionsByOutputName: Record<string, string[]> = {}
	const actionSchemas: Record<string, z.ZodTypeAny> = {}

	// Group actions by their output schema name
	for (const [name, action] of Object.entries(actions)) {
		const outName = getOutputSchemaName(action.schema.output)
		if (!actionsByOutputName[outName]) {
			actionsByOutputName[outName] = []
		}
		actionsByOutputName[outName].push(name)
	}

	const outputUnions: Record<string, z.ZodTypeAny> = {}

	// Create lazy unions for actions producing the same output
	for (const outName in actionsByOutputName) {
		outputUnions[outName] = z.lazy(() => {
			const schemaArray = actionsByOutputName[outName].map(n => actionSchemas[n])
			return stableDescribe(makeNonEmptyUnion(schemaArray))
		})
	}

	function paramSchemaForType(paramSchema: z.ZodTypeAny): z.ZodTypeAny {
		const sig = generateSignature(paramSchema)

		// Try to match known primitives
		if (sig === 'string' && outputUnions['string']) {
			return stableDescribe(z.union([paramSchema, outputUnions['string']]))
		}
		if (sig === 'number' && outputUnions['number']) {
			return stableDescribe(z.union([paramSchema, outputUnions['number']]))
		}
		if (sig === 'boolean' && outputUnions['boolean']) {
			return stableDescribe(z.union([paramSchema, outputUnions['boolean']]))
		}

		// If it's a described schema (like a contact), we identified its output union by stableName
		const outName = stableName(paramSchema)
		if (outputUnions[outName]) {
			return stableDescribe(z.union([paramSchema, outputUnions[outName]]))
		}

		// Otherwise, just describe the param schema itself
		return stableDescribe(paramSchema)
	}

	// Build each action's schema
	for (const [name, action] of Object.entries(actions)) {
		const shape = action.schema.input.shape
		const paramsShape: Record<string, z.ZodTypeAny> = {}

		for (const key in shape) {
			const val = shape[key]
			paramsShape[key] = paramSchemaForType(val)
		}

		actionSchemas[name] = stableDescribe(
			z.object({
				action: z.literal(name),
				params: z.object(paramsShape).strict()
			})
		)
	}

	// Create the main ActionUnion
	const ActionUnion = z.lazy(() => {
		const schemaArray = Object.values(actionSchemas)
		return stableDescribe(makeNonEmptyUnion(schemaArray))
	})

	const schemaBase = z.object({ execution: ActionUnion }).strict()

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

	// TODO, Generate this programatically and generically

	const customJsonSchema = {
		type: 'object',
		properties: {
			execution: {
				$ref: '#/definitions/ActionUnion'
			}
		},
		required: ['execution'],
		additionalProperties: false,
		definitions: {
			ActionUnion: {
				anyOf: [
					{ $ref: '#/definitions/getFirstContactFromSearchAction' },
					{ $ref: '#/definitions/getFirstFBContactFromSearchAction' },
					{ $ref: '#/definitions/sendEmailAction' }
				]
			},
			getFirstContactFromSearchAction: {
				type: 'object',
				properties: {
					action: {
						type: 'string',
						const: 'getFirstContactFromSearch'
					},
					params: {
						type: 'object',
						properties: {
							search: { type: 'string' }
						},
						required: ['search'],
						additionalProperties: false
					}
				},
				required: ['action', 'params'],
				additionalProperties: false
			},
			getFirstFBContactFromSearchAction: {
				type: 'object',
				properties: {
					action: {
						type: 'string',
						const: 'getFirstFBContactFromSearch'
					},
					params: {
						type: 'object',
						properties: {
							search: { type: 'string' }
						},
						required: ['search'],
						additionalProperties: false
					}
				},
				required: ['action', 'params'],
				additionalProperties: false
			},
			sendEmailAction: {
				type: 'object',
				properties: {
					action: {
						type: 'string',
						const: 'sendEmail'
					},
					params: {
						type: 'object',
						properties: {
							to: {
								anyOf: [
									{ $ref: '#/definitions/contact' },
									{ $ref: '#/definitions/getFirstContactFromSearchAction' }
								]
							},
							content: { type: 'string' }
						},
						required: ['to', 'content'],
						additionalProperties: false
					}
				},
				required: ['action', 'params'],
				additionalProperties: false
			},
			contact: {
				type: 'object',
				properties: {
					type: {
						type: 'string',
						const: 'contactId'
					},
					id: {
						type: 'string'
					}
				},
				required: ['type', 'id'],
				additionalProperties: false
			}
		},
		$schema: 'http://json-schema.org/draft-07/schema#'
	}

	const response_format = makeCustomResponseFormat<z.infer<typeof schema>>(
		customJsonSchema,
		content => {
			return schema.parse(JSON.parse(content))
		}
	)

	return { execute, schema, response_format }
}
