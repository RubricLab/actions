import z from 'zod/v4'

export function createAction<I extends z.ZodType, O extends z.ZodType>({
	schema,
	execute,
	description
}: {
	schema: { input: I; output: O }
	execute: (input: z.infer<I>) => Promise<z.infer<O>>
	description: string | undefined
}) {
	return {
		description,
		execute,
		schema,
		type: 'action' as const
	}
}

type ActionWithoutExecuteArgs<Input extends z.ZodType, Output extends z.ZodType> = Omit<
	ReturnType<typeof createAction<Input, Output>>,
	'execute'
> & {
	// biome-ignore lint/suspicious/noExplicitAny: this is required to support generic functions that need to extend a placeholder for Actions.
	execute: (input: any) => Promise<z.infer<Output>>
}

export type AnyAction = ActionWithoutExecuteArgs<z.ZodType, z.ZodType>

export function createActionProxy<Name extends string, Input extends z.ZodType>({
	name,
	input
}: {
	name: Name
	input: Input
}) {
	return z.object({
		action: z.literal(name),
		params: input
	})
}

export function createActionExecutor<ActionMap extends Record<string, AnyAction>>({
	actions
}: {
	actions: ActionMap
}) {
	return {
		__Actions: async () => undefined as unknown as ActionMap,
		async execute<ActionKey extends keyof ActionMap & string>({
			action,
			params
		}: {
			action: ActionKey
			params: z.infer<ActionMap[ActionKey]['schema']['input']>
		}) {
			const { execute } = actions[action] ?? (undefined as never)
			return (await execute(params)) as z.infer<ActionMap[ActionKey]['schema']['output']>
		},
		getActionDefs: async () =>
			Object.fromEntries(
				Object.entries(actions).map(([name, { schema }]) => [name, schema])
			) as Record<
				keyof ActionMap,
				{
					input: ActionMap[keyof ActionMap]['schema']['input']
					output: ActionMap[keyof ActionMap]['schema']['output']
				}
			>
	}
}

export function createActionDocs<ActionMap extends Record<string, AnyAction>>({
	actions
}: {
	actions: ActionMap
}) {
	return Object.entries(actions)
		.map(
			([
				name,
				{
					schema: { input, output },
					description
				}
			]) => `## ${String(name)}
### Description:
${description ?? 'No description provided'}
### Input Schema:
${JSON.stringify(
	z.toJSONSchema(
		createActionProxy({
			input,
			name
		})
	),
	null,
	2
)}
### Output Schema:
${JSON.stringify(z.toJSONSchema(output), null, 2)}`
		)
		.join('\n\n')
}
