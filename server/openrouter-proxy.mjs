import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const PORT = Number(process.env.AI_PROXY_PORT || 8787)
const MODEL = 'poolside/laguna-m.1:free'

loadLocalEnv()

const server = createServer(async (request, response) => {
  setCorsHeaders(response)

  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
    return
  }

  if (request.method !== 'POST' || request.url !== '/api/ai-explain') {
    sendJson(response, 404, { error: 'Маршрут не найден' })
    return
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    sendJson(response, 500, { error: 'OPENROUTER_API_KEY не задан в .env.local' })
    return
  }

  try {
    const payload = JSON.parse(await readRequestBody(request))
    const completion = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:5173',
        'X-Title': 'Short Circuit AI Calculator',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: buildMessages(payload),
        temperature: 0.25,
        max_tokens: 2500,
        reasoning: {
          effort: 'none',
          exclude: true,
        },
      }),
    })

    const responseText = await completion.text()
    const data = parseJson(responseText)

    if (!completion.ok) {
      sendJson(response, completion.status, {
        error: data?.error?.message || responseText || 'OpenRouter вернул ошибку',
      })
      return
    }

    const text = extractMessageText(data)
    if (!text) {
      sendJson(response, 502, {
        error:
          data?.error?.message ||
          `OpenRouter ответил без текста. finish_reason: ${data?.choices?.[0]?.finish_reason || 'не указан'}`,
        model: MODEL,
      })
      return
    }

    sendJson(response, 200, {
      model: MODEL,
      text,
    })
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : 'Не удалось выполнить AI-анализ',
    })
  }
})

server.listen(PORT, () => {
  console.log(`AI proxy is running: http://localhost:${PORT}/api/ai-explain`)
})

function buildMessages(payload) {
  return [
    {
      role: 'system',
      content:
        'Отвечай только финальным текстом на русском языке. Не показывай рассуждения. Формат: ровно 3 нумерованных пункта, каждый пункт - одно короткое предложение.',
    },
    {
      role: 'user',
      content: [
        'Объясни расчет тока короткого замыкания.',
        `U=${payload.voltage} В; Sист=${payload.sourcePower} кВА; Rлинии=${payload.lineResistance} Ом/км; L=${payload.cableLength} м.`,
        `Zист=${payload.sourceResistance} Ом; Zкаб=${payload.cableResistance} Ом; Zсум=${payload.totalResistance} Ом.`,
        `Iкз=${payload.shortCircuitCurrent} А; iуд=${payload.peakCurrent} А.`,
        '1. Откуда взялся результат.',
        '2. Какие параметры больше всего повлияли.',
        '3. Почему ток получился большим или маленьким.',
      ].join('\n'),
    },
  ]
}

function readRequestBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
      if (body.length > 100_000) {
        request.destroy()
        rejectBody(new Error('Слишком большой запрос'))
      }
    })
    request.on('end', () => resolveBody(body))
    request.on('error', rejectBody)
  })
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(payload))
}

function parseJson(text) {
  if (!text) return {}

  try {
    return JSON.parse(text)
  } catch {
    return { error: { message: text } }
  }
}

function extractMessageText(data) {
  const content = data?.choices?.[0]?.message?.content

  if (typeof content === 'string') {
    return content.trim()
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (typeof part?.text === 'string') return part.text
        return ''
      })
      .join('')
      .trim()
  }

  return ''
}

function setCorsHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function loadLocalEnv() {
  const envPath = resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return

  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex === -1) continue

    const key = trimmed.slice(0, separatorIndex).trim()
    const value = trimmed.slice(separatorIndex + 1).trim()
    if (!process.env[key]) process.env[key] = value
  }
}
