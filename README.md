# @rubriclab/actions
The Actions package aims to provide a powerful and simple way to define actions (which are essentially API primitives) and execute them safely with JSON serializable payloads.

It is part of Rubric's architecture for Generative UI when used with:
- [@rubriclab/actions](https://github.com/rubriclab/actions)
- [@rubriclab/blocks](https://github.com/rubriclab/blocks)
- [@rubriclab/chains](https://github.com/rubriclab/chains)
- [@rubriclab/agents](https://github.com/rubriclab/agents)
- [@rubriclab/events](https://github.com/rubriclab/events)

## [Demo](https://chat.rubric.sh)

## Get Started
### Installation
`bun add @rubriclab/actions`

> @rubriclab scope packages are not built, they are all raw typescript. If using in a next.js app, make sure to transpile.

```ts
// next.config.ts
import type { NextConfig } from  'next' 
export default {
	transpilePackages: ['@rubriclab/actions'],
	reactStrictMode: true
} satisfies  NextConfig
```

> If using inside the monorepo (@rubric), simply add `{"@rubriclab/actions": "*"}` to dependencies and then run `bun i`

### Define Actions
To get started, define a few actions.

```ts
import { createAction } from '@rubriclab/actions'
import { z } from 'zod'

const convertStringToNumber = createAction({
	schema: {
		input: {
			str: z.string()
		},
		output: z.number()
	},
	execute: ({ str }) => Number(str)
})

export const actions = { convertStringToNumber }
```

### Create an Executor
Pass all your actions into an executor to get a function to execute it.

```ts
'use server'

import { createActionExecutor } from '@rubriclab/actions'
import { actions } from './actions'

export const { execute } = createActionExecutor({ actions })
```

### Execute an Action

```ts
const number = await execute({ action: 'convertStringToNumber' params: { str: '2' } })
```
