import { z } from 'zod'
import { createAction, createActionsExecutor } from './types'

const stringToNumber = createAction({
	name: 'stringToNumber',
	schema: {
		input: z.object({ text: z.string() }),
		output: z.number()
	},
	execute: ({ text }) => Number(text)
})

const numberToString = createAction({
	name: 'numberToString',
	schema: {
		input: z.object({ num: z.number() }),
		output: z.string()
	},
	execute: ({ num }) => num.toString()
})

const ContactSchema = z.object({
	name: z.string(),
	email: z.string(),
	guy: z.boolean()
})

const createContact = createAction({
	name: 'createContact',
	schema: {
		input: z.object({ name: z.string(), email: z.string(), guy: z.boolean() }),
		output: ContactSchema
	},
	execute: ({ name, email, guy }) => ({ name, email, guy })
})

const contactToString = createAction({
	name: 'contactToString',
	schema: {
		input: z.object({ contact: ContactSchema }),
		output: z.string()
	},
	execute: ({ contact }) => `${contact.name} <${contact.email}> guy: ${contact.guy}`
})

const { execute, schema, json_schema } = createActionsExecutor({
	stringToNumber,
	numberToString,
	createContact,
	contactToString
})

const chain: z.infer<typeof schema> = {
	action: 'stringToNumber',
	params: {
		text: {
			action: 'numberToString',
			params: {
				number: 3
			}
		}
	}
}

execute(chain)

console.log(schema.safeParse(chain)) // Should succeed
console.log(execute(chain)) // "Alice <alice@example.com> guy: true"

console.log(JSON.stringify(json_schema, null, 2))
