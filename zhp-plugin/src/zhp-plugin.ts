import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, isAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'zhp-plugin'
export const inject = ['tools']

const logPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'logs', 'llm-prompt.log')
let nextCallId = 0

function writeLog(payload: Record<string, unknown>): void {
  appendFileSync(logPath, `${JSON.stringify(payload)}\n`)
}

export function apply(ctx: Context) {
  mkdirSync(dirname(logPath), { recursive: true })
  console.log(`[zhp-plugin] llm dumps → ${logPath}`)

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

  // Dump request options, then wrap the stream to dump the assembled result.
  ctx.on('llm/stream', (options, next) => {
    const callId = ++nextCallId
    writeLog({
      kind: 'request',
      callId,
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
    })
    console.log(`[zhp-plugin] request #${callId} (${options.messages.length} messages, ${options.tools?.length ?? 0} tools) → ${logPath}`)

    const inner = next()
    return (async function* () {
      const assembler = new BlockAssembler()
      try {
        for await (const chunk of inner) {
          assembler.push(chunk)
          yield chunk
        }
        writeLog({
          kind: 'result',
          callId,
          at: new Date().toISOString(),
          provider: options.provider,
          model: options.model,
          finish: assembler.finish,
          usage: assembler.usage,
          content: assembler.blocks(),
        })
        console.log(`[zhp-plugin] result #${callId} (${assembler.blocks().length} blocks, finish=${assembler.finish.kind}) → ${logPath}`)
      } catch (error) {
        writeLog({
          kind: 'error',
          callId,
          at: new Date().toISOString(),
          provider: options.provider,
          model: options.model,
          error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
          content: assembler.interruptedBlocks(),
        })
        console.log(`[zhp-plugin] error #${callId} → ${logPath}`)
        throw error
      }
    })()
  })
}
