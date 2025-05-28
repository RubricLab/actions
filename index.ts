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
	execute: (input: any) => Promise<Output>
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
