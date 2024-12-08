import { z } from 'zod'
import { createActionsExecutor } from './main'
import { createAction } from './types'

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

const contactSchema = z.object({ name: z.string(), email: z.string(), guy: z.boolean() })

const createContact = createAction({
	name: 'createContact',
	schema: {
		input: z.object({ name: z.string(), email: z.string(), guy: z.boolean() }),
		output: contactSchema
	},
	execute: ({ name, email, guy }) => ({ name, email, guy })
})

const contactToString = createAction({
	name: 'contactToString',
	schema: {
		input: z.object({ contact: contactSchema }),
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

const validChain = {
	action: 'stringToNumber',
	params: {
		text: {
			action: 'numberToString',
			params: {
				num: 3
			}
		}
	}
} as z.infer<typeof schema>

console.log(schema.safeParse(validChain)) // should succeed
console.log(execute(validChain)) // 3

// JSON schema example
console.log(JSON.stringify(json_schema, null, 2))

// Example of runtime error if mismatch:
// Suppose we do this:
const invalidChain = {
	action: 'stringToNumber',
	params: {
		text: {
			action: 'createContact',
			params: {
				name: 'Alice',
				email: 'alice@example.com',
				guy: true
			}
		}
	}
} as z.infer<typeof schema>

// Structurally valid, but will fail at execution time because `text` expects a string but we get a Contact object.
try {
	execute(invalidChain)
} catch (err) {
	console.error('Execution failed as expected:', err)
}
