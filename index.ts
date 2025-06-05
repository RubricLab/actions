import z from 'zod/v4'
import type { $strict } from 'zod/v4/core'

export function createAction<I extends Record<string, z.ZodType>, O extends z.ZodType>({
	schema,
	execute,
	description
}: {
	schema: { input: I; output: O }
	execute: (input: z.infer<z.ZodObject<I, $strict>>) => Promise<z.infer<O>>
	description: string | undefined
}) {
	return {
		type: 'action' as const,
		schema,
		execute,
		description
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
			name,
			input
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
