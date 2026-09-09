// Dev-only proxy. Its whole job is to keep ANTHROPIC_API_KEY out of the browser
// bundle: the SPA talks to localhost, this talks to Anthropic. Not an app server
// — do not grow it into one, and do not deploy it.
import 'dotenv/config'
import Anthropic from '@anthropic-ai/sdk'
import cors from 'cors'
import express from 'express'
import { SYSTEM_PROMPT } from './systemPrompt.mjs'

const PORT = Number(process.env.SEQFLOW_PROXY_PORT ?? 8787)
const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-opus-5'

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('\n  ANTHROPIC_API_KEY is not set. Put it in .env.local:\n')
  console.error('    ANTHROPIC_API_KEY=sk-ant-...\n')
  process.exit(1)
}

const client = new Anthropic()
const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

app.post('/api/generate', async (req, res) => {
  const { prompt, currentDsl } = req.body ?? {}
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'Missing `prompt`.' })
  }

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: currentDsl?.trim()
            ? `Current diagram:\n\n${currentDsl}\n\n---\n\nRequest: ${prompt}`
            : prompt,
        },
      ],
    })

    const dsl = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim()

    res.json({ dsl, model: message.model, stopReason: message.stop_reason })
  } catch (error) {
    console.error('[seqflow-proxy]', error)
    res.status(error?.status ?? 500).json({ error: error?.message ?? String(error) })
  }
})

app.listen(PORT, '127.0.0.1', () => {
  console.log(`  SeqFlow AI proxy on http://127.0.0.1:${PORT} using ${MODEL}`)
})
