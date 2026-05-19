const MODEL = 'poolside/laguna-m.1:free'

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Метод не поддерживается' })
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return response.status(500).json({
      error: 'OPENROUTER_API_KEY не задан в переменных окружения Vercel',
    })
  }

  try {
    const payload = request.body
    const completion = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': request.headers.origin || 'https://vercel.app',
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
      return response.status(completion.status).json({
        error: data?.error?.message || responseText || 'OpenRouter вернул ошибку',
      })
    }

    const text = extractMessageText(data)
    if (!text) {
      return response.status(502).json({
        error:
          data?.error?.message ||
          `OpenRouter ответил без текста. finish_reason: ${data?.choices?.[0]?.finish_reason || 'не указан'}`,
        model: MODEL,
      })
    }

    return response.status(200).json({
      model: MODEL,
      text,
    })
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : 'Не удалось выполнить AI-анализ',
    })
  }
}

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
