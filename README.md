# @rubriclab/actions
This package is part of a 3 package system that represents Rubric's framework for Generative UI. See also: 
- @rubriclab/blocks
- @rubriclab/ui

The Actions package aims to provide a powerful and simple way to define actions (which are essentially API primitives) and chain them together in a typesafe way.

It is designed to be awesome for developers (providing really simple and powerful DX with excellent typesafety) and powerful for AI systems - allowing structured output models to export chains reliably.

## Get Started
### Installation
`bun add @rubriclab/actions`

> @rubriclab scope packages are not built, they are all raw typescript. If using in a next.js app, make sure to transpile.

```ts
// next.config.ts
import type { NextConfig } from  'next' 
export default {
	transpilePackages: ['@rubriclab/auth'],
	reactStrictMode: true
} satisfies  NextConfig
```

### Define Actions
To get started, define a few actions.

```ts
import { createAction } from '@rubriclab/actions'
import { z } from 'zod'

const convertStringToNumber = createAction({
	schema: {
		input: z.object({
			str: z.string()
		}),
		output: z.number()
	},
	execute: ({ str }) => Number(str)
})

const convertNumberToString = createAction({
	schema: {
		input: z.object({
			num: z.number()
		}),
		output: z.string()
	},
	execute: ({ num }) => num.toString()
})
```

### Create an Executor
Pass all your actions into an executor to get an executor, zod schema, and a response_format (json schema for AI)

```ts
const { execute, schema, response_format } = createActionsExecutor({
	convertStringToNumber,
	convertNumberToString
})
```

### Execute a chain
Now that your actions are set up, you have typesafe chain execution.

```ts
const validSingle = execute({
	action: 'convertStringToNumber',
	params: {
		str: "2"
	}
})
const validChain = execute({
	action: 'convertStringToNumber',
	params: {
		str: {
			action: 'convertNumberToString',
			params: {
				num: 2
			}
		}
	}
})
```

### Check if a chain is valid
#### At Build Time
The type `z.infer<typeof schema>` validates chains

```ts
const invalidChain: z.infer<typeof schema> = {
	action: 'convertStringToNumber',
	params: {
		str: {
			// you should see a TS issue here.
			action: 'convertStringToNumber',
			params: {
				num: '2'
			}
		}
	}
}
```

The input to execute() is also checked

```ts
 const invalidChain = execute({
	action: 'convertStringToNumber',
	params: {
		str: {
			// you should see a TS issue here.
			action: 'convertStringToNumber',
			params: {
				num: '2'
			}
		}
	}
})
```

#### At Run Time
You can parse at run time using zod:
`schema.parse(invalidChain)`
`schema.safeParse(invalidChain)`


### Usage with AI
Use the response_format object for structured outputs.

```ts
const  completion = await  new  openai().beta.chat.completions.parse({
	model: 'gpt-4o-2024-08-06',
	messages: [
		{
			role: 'system',
			content: 'You are an actions executor. Your job is to create a single chain of actions that accomplishes the request.'
		},
		{
			role: 'user',
			content: 'parse 4 into a string and then back into a number 3 times.'
		}
	],
	// the response_format works out of the box with structured outputs.
	response_format
})
const { execution } = schema.parse(completion.choices[0]?.message.parsed)
console.dir(execution, { depth: null })
console.log(execute(execution))
```

### Advanced usage

#### Large amounts of actions
In theory, you can define lots and lots of actions and still get good outputs from AI. Log `response_format` to see that it is very flat and scalable!


#### Similar Objects
Out of the box, actions can be chained if they share IO primitives. For example, you can chain `convertStringToNumber` with `convertNumberToString` since the output of each is a primitive (`z.number()` and `z.string()` respectively) that corresponds to an input field of the other.
In more realistic scenarios, you will have more complex output types, for example, a contact.

```ts
const Contact = z.object({
	id: z.string(),
	name: z.string(),
	email: z.string(),
	image: z.string()
})
```

Notice that `id` could create problems, since it's seemingly compatible with any string. You wouldn't want AI or a developer to accidentally pass in a hallucinated string, an id from a different service, or the result of another action that returns a string that isn't actually a valid id.

In these cases, you can define a locked down type, such as a `GoogleContactID`:

```ts
const GoogleContactId = z.object({
	type: z.literal('googleContactId'),
	id: z.string()
})
```

Then you can enforce that this ID is specific to actions that use it:

```ts
const getFirstGoogleContactFromSearch = createAction({
	schema: {
		input: z.object({
			search: z.string()
		}),
		output: GoogleContactId
	},
	execute: ({ search }) => ({
		type: 'googleContactId'  as  const,
		id: '...'
	})
})

// a similar but not identical contact
const getFirstFacebookContactFromSearch = createAction({
	schema: {
		input: z.object({
			search: z.string()
		}),
		output: z.object({
			type: z.literal('facebookContactId'),
			id: z.string()
		})
	},
	execute: ({ search }) => ({
		type: 'googleContactId'  as  const,
		id: '...'
	})
})

const sendEmail = createAction({
	schema: {
		input: z.object({
			// only accept google contacts
			to: GoogleContactId,
			content: z.string()
		}),
		output: z.boolean()
	},
	execute: ({ to, content }) => {
		console.log(`Sending email to ${to.id}: ${content}`)
		return true
	}
})
```

In this example, `sendEmail` will only be chainable with `getFirstGoogleContactFromSearch`. There will be a ts issue trying to send an email to a Facebook contact, and AI will not be able to erroneously chain.
Under the hood, we use a hashing mechanism to ensure that objects retain their exact uniqueness. Log `response_format` to see how that works!
