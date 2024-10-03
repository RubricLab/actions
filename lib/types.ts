import type { z } from 'zod'

export type ActionSchema = z.ZodTypeAny

export interface ActionContext {
	userId: string
}

interface BaseAction<T extends ActionSchema, R> {
	schema: T
	handler: (params: unknown, context: ActionContext) => Promise<R>
}

export interface Action<T extends ActionSchema, R> extends BaseAction<T, R> {
	handler: (params: z.infer<T>, context: ActionContext) => Promise<R>
}

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
export type HandlerReturnType<H> = H extends (...args: any) => Promise<infer R> ? R : never
