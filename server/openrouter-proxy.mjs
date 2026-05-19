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
        max_tokens: 220,
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

    sendJson(response, 200, {
      model: MODEL,
      text: data?.choices?.[0]?.message?.content?.trim() || 'Модель не вернула текст.',
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
        'Ты инженер-электрик и AI-помощник в дипломном веб-калькуляторе. Отвечай на русском языке очень кратко: ровно 3 нумерованных пункта, по 1 предложению в каждом. Без вступления, markdown-таблиц и лишних предупреждений.',
    },
    {
      role: 'user',
      content: [
        'Проанализируй расчет короткого замыкания.',
        `Напряжение: ${payload.voltage} В`,
        `Мощность источника: ${payload.sourcePower} кВА`,
        `Сопротивление линии: ${payload.lineResistance} Ом/км`,
        `Длина кабеля: ${payload.cableLength} м`,
        `Эквивалентное сопротивление источника: ${payload.sourceResistance} Ом`,
        `Сопротивление кабельной линии: ${payload.cableResistance} Ом`,
        `Суммарное сопротивление: ${payload.totalResistance} Ом`,
        `Ток короткого замыкания: ${payload.shortCircuitCurrent} А`,
        `Ударный ток: ${payload.peakCurrent} А`,
        '',
        'Ответ строго по плану:',
        '1. Откуда взялся результат.',
        '2. Какие параметры больше всего повлияли.',
        '3. Почему ток получился большим или маленьким.',
        '',
        'Пример стиля: Основной вклад в увеличение тока КЗ внесло низкое сопротивление линии и высокая мощность источника.',
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
