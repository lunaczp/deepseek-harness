import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { isAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'zhp-plugin'
export const inject = ['tools']

const logPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'logs', 'llm-prompt.log')

export function apply(ctx: Context) {
  mkdirSync(dirname(logPath), { recursive: true })
  console.log(`[zhp-plugin] llm prompt dumps → ${logPath}`)

  ctx.tools.register(defineTool({
    name: 'greet',
    description: 'Greet someone by name.',
    parameters: {
      name: { type: 'string', required: true, description: 'The name to greet' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      return `Hello, ${args.name}!`
    },
  }))

  // Dump the exact GenerateOptions the adapter is about to see (messages + tools).
  ctx.on('llm/stream', (options, next) => {
    const payload = {
      at: new Date().toISOString(),
      agentLoop: isAgentLoopRequest(options),
      provider: options.provider,
      model: options.model,
      purpose: options.purpose,
      sessionId: options.sessionId,
      reasoningEffort: options.reasoningEffort,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      system: options.system,
      messages: options.messages,
      tools: options.tools,
    }
    appendFileSync(logPath, `${JSON.stringify(payload)}\n`)
    console.log(`[zhp-plugin] wrote prompt dump (${payload.messages.length} messages, ${payload.tools?.length ?? 0} tools) → ${logPath}`)
    return next()
  })
}
