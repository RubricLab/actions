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

export type AnyAction = ReturnType<typeof createAction<Record<string, z.ZodType>, z.ZodType>>

export type ActionMap = Record<string, AnyAction>

export function createActionProxy<Name extends string, Action extends AnyAction>({
	name,
	input
}: {
	name: Name
	input: Action['schema']['input']
}) {
	return z.strictObject({
		action: z.literal(`action_${name}` as const),
		params: z.object(input)
	})
}
