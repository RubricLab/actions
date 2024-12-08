const t = {
	type: 'json_schema',
	json_schema: {
		name: 'execution',
		strict: true,
		schema: {
			type: 'object',
			properties: {
				execution: {
					anyOf: [
						{
							type: 'object',
							properties: {
								action: {
									type: 'string',
									const: 'getFirstContactFromSearch'
								},
								params: {
									type: 'object',
									properties: {
										search: {
											type: 'string',
											description: 'Schema_ecb25204'
										}
									},
									required: ['search'],
									additionalProperties: false
								}
							},
							required: ['action', 'params'],
							additionalProperties: false,
							description: 'Schema_a56c5ded'
						},
						{
							type: 'object',
							properties: {
								action: {
									type: 'string',
									const: 'sendEmail'
								},
								params: {
									type: 'object',
									properties: {
										to: {
											anyOf: [
												{
													type: 'object',
													properties: {
														type: {
															type: 'string',
															const: 'contactId'
														},
														id: {
															type: 'string'
														}
													},
													required: ['type', 'id'],
													additionalProperties: false,
													description: 'contact'
												},
												{
													$ref: '#/definitions/execution_properties_execution_anyOf_0'
												}
											],
											description: 'Schema_9cc1a0dd'
										},
										content: {
											type: 'string',
											description: 'Schema_ecb25204'
										}
									},
									required: ['to', 'content'],
									additionalProperties: false
								}
							},
							required: ['action', 'params'],
							additionalProperties: false,
							description: 'Schema_0ab25ca2'
						},
						{
							type: 'object',
							properties: {
								action: {
									type: 'string',
									const: 'getFirstFBContactFromSearch'
								},
								params: {
									type: 'object',
									properties: {
										search: {
											type: 'string',
											description: 'Schema_ecb25204'
										}
									},
									required: ['search'],
									additionalProperties: false
								}
							},
							required: ['action', 'params'],
							additionalProperties: false,
							description: 'Schema_addcb399'
						}
					],
					description: 'Schema_09f261b4'
				}
			},
			required: ['execution'],
			additionalProperties: false,
			definitions: {
				execution_properties_execution_anyOf_0: {
					type: 'object',
					properties: {
						action: {
							$ref: '#/definitions/execution_properties_execution_anyOf_0_properties_action'
						},
						params: {
							$ref: '#/definitions/execution_properties_execution_anyOf_0_properties_params'
						}
					},
					required: ['action', 'params'],
					additionalProperties: false,
					description: 'Schema_a56c5ded'
				},
				execution_properties_execution_anyOf_0_properties_action: {
					type: 'string',
					const: 'getFirstContactFromSearch'
				},
				execution_properties_execution_anyOf_0_properties_params: {
					type: 'object',
					properties: {
						search: {
							$ref:
								'#/definitions/execution_properties_execution_anyOf_0_properties_params_properties_search'
						}
					},
					required: ['search'],
					additionalProperties: false
				},
				execution_properties_execution_anyOf_0_properties_params_properties_search: {
					type: 'string',
					description: 'Schema_ecb25204'
				},
				execution: {
					type: 'object',
					properties: {
						execution: {
							anyOf: [
								{
									type: 'object',
									properties: {
										action: {
											type: 'string',
											const: 'getFirstContactFromSearch'
										},
										params: {
											type: 'object',
											properties: {
												search: {
													type: 'string',
													description: 'Schema_ecb25204'
												}
											},
											required: ['search'],
											additionalProperties: false
										}
									},
									required: ['action', 'params'],
									additionalProperties: false,
									description: 'Schema_a56c5ded'
								},
								{
									type: 'object',
									properties: {
										action: {
											type: 'string',
											const: 'sendEmail'
										},
										params: {
											type: 'object',
											properties: {
												to: {
													anyOf: [
														{
															type: 'object',
															properties: {
																type: {
																	type: 'string',
																	const: 'contactId'
																},
																id: {
																	type: 'string'
																}
															},
															required: ['type', 'id'],
															additionalProperties: false,
															description: 'contact'
														},
														{
															$ref: '#/definitions/execution_properties_execution_anyOf_0'
														}
													],
													description: 'Schema_9cc1a0dd'
												},
												content: {
													type: 'string',
													description: 'Schema_ecb25204'
												}
											},
											required: ['to', 'content'],
											additionalProperties: false
										}
									},
									required: ['action', 'params'],
									additionalProperties: false,
									description: 'Schema_0ab25ca2'
								},
								{
									type: 'object',
									properties: {
										action: {
											type: 'string',
											const: 'getFirstFBContactFromSearch'
										},
										params: {
											type: 'object',
											properties: {
												search: {
													type: 'string',
													description: 'Schema_ecb25204'
												}
											},
											required: ['search'],
											additionalProperties: false
										}
									},
									required: ['action', 'params'],
									additionalProperties: false,
									description: 'Schema_addcb399'
								}
							],
							description: 'Schema_09f261b4'
						}
					},
					required: ['execution'],
					additionalProperties: false
				}
			},
			$schema: 'http://json-schema.org/draft-07/schema#'
		}
	}
}
