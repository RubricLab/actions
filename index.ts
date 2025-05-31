import z from 'zod/v4'

export function createAction<I extends Record<string, z.ZodType>, O extends z.ZodType>({
	schema,
	execute
}: {
	schema: { input: I; output: O }
	execute: (input: { [K in keyof I]: z.infer<I[K]> }) => Promise<z.infer<O>>
}) {
	return {
		type: 'action' as const,
		schema,
		execute
	}
}

type ActionWithoutExecuteArgs<
	Input extends Record<string, z.ZodType>,
	Output extends z.ZodType
> = Omit<ReturnType<typeof createAction<Input, Output>>, 'execute'> & {
	// biome-ignore lint/suspicious/noExplicitAny: this is required to support generic functions that need to extend a placeholder for Actions.
	execute: (input: any) => Promise<z.infer<Output>>
}

export type AnyAction = ActionWithoutExecuteArgs<Record<string, z.ZodType>, z.ZodType>

export function createActionProxy<Name extends string, Input extends Record<string, z.ZodType>>({
	name,
	input
}: {
	name: Name
	input: Input
}) {
	return z.object({
		action: z.literal(name),
		params: z.object(input)
	})
}

export function createActionExecutor<ActionMap extends Record<string, AnyAction>>({
	actions
}: {
	actions: ActionMap
}) {
	return {
		async execute<ActionKey extends keyof ActionMap & string>({
			action,
			params
		}: {
			action: ActionKey
			params: {
				[K in keyof ActionMap[ActionKey]['schema']['input']]: z.infer<
					ActionMap[ActionKey]['schema']['input'][K]
				>
			}
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
			>,
		__Actions: async () => undefined as unknown as ActionMap
	}
}
