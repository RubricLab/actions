import { z } from 'zod'
import type { Action, ActionContext, HandlerReturnType } from './types'

export function createAction<T extends z.ZodTypeAny, R>(config: {
	schema: T
	handler: (params: z.infer<T>, context: ActionContext) => Promise<R>
}): Action<T, R> {
	return config
}
export function createActionsSchemas<
	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	AP extends Record<string, Action<any, any>>
>(actions: AP) {
	type ActionName = keyof AP
	return {
		actionsSchemas: z.discriminatedUnion(
			'action',
			Object.entries(actions).map(([actionName, actionConfig]) =>
				z.object({
					action: z.literal(actionName as ActionName),
					params: actionConfig.schema
				})
			) as [
				z.ZodObject<{
					action: z.ZodLiteral<ActionName>
					params: (typeof actions)[ActionName]['schema']
				}>,
				...z.ZodObject<{
					action: z.ZodLiteral<ActionName>
					params: (typeof actions)[ActionName]['schema']
				}>[]
			]
		)
	}
}

export function createActionsActions<
	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	AP extends Record<string, Action<any, any>>
>(actions: AP) {
	type ActionName = keyof AP

	const actionSchemas = z.discriminatedUnion(
		'action',
		Object.entries(actions).map(([actionName, actionConfig]) =>
			z.object({
				action: z.literal(actionName as ActionName),
				params: actionConfig.schema
			})
		) as [
			z.ZodObject<{
				action: z.ZodLiteral<ActionName>
				params: (typeof actions)[ActionName]['schema']
			}>,
			...z.ZodObject<{
				action: z.ZodLiteral<ActionName>
				params: (typeof actions)[ActionName]['schema']
			}>[]
		]
	)

	return {
		actionSchemas,
		async executeAction<A extends keyof AP>({
			action,
			params,
			context
		}: {
			action: A
			params: z.infer<AP[A]['schema']>
			context: ActionContext
		}): Promise<HandlerReturnType<AP[A]['handler']>> {
			const actionConfig = actions[action]
			if (!actionConfig) {
				throw new Error(`Action not found: ${String(action)}`)
			}
			const validatedParams = actionConfig.schema.parse(params)
			return actionConfig.handler(validatedParams, context)
		}
	}
}
