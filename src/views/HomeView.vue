<script setup>
import { computed, reactive, ref } from 'vue'

const form = reactive({
  voltage: 400,
  sourcePower: 1000,
  lineResistance: 0.08,
  cableLength: 60,
})

const peakFactor = 1.8
const aiModel = 'poolside/laguna-m.1:free'
const aiEndpoint = '/api/ai-explain'

const aiLoading = ref(false)
const aiError = ref('')
const remoteAiExplanation = ref('')

const numeric = computed(() => ({
  voltage: Number(form.voltage),
  sourcePower: Number(form.sourcePower),
  lineResistance: Number(form.lineResistance),
  cableLength: Number(form.cableLength),
}))

const sourceResistance = computed(() => {
  const { voltage, sourcePower } = numeric.value
  if (voltage <= 0 || sourcePower <= 0) return 0

  const powerVa = sourcePower * 1000
  return (voltage * voltage) / powerVa
})

const cableResistance = computed(() => {
  const { lineResistance, cableLength } = numeric.value
  if (lineResistance <= 0 || cableLength <= 0) return 0

  return lineResistance * cableLength
})

const totalResistance = computed(() => sourceResistance.value + cableResistance.value)

const shortCircuitCurrent = computed(() => {
  const { voltage } = numeric.value
  if (voltage <= 0 || totalResistance.value <= 0) return 0

  return voltage / totalResistance.value
})

const peakCurrent = computed(() => shortCircuitCurrent.value * peakFactor)

const isReady = computed(() =>
  Object.values(numeric.value).every((value) => Number.isFinite(value) && value > 0),
)

const dominantFactors = computed(() => {
  const total = totalResistance.value
  if (total <= 0) return []

  return [
    {
      label: 'кабельная линия',
      value: cableResistance.value / total,
      detail: `${formatOhm(cableResistance.value)} Ом`,
    },
    {
      label: 'источник питания',
      value: sourceResistance.value / total,
      detail: `${formatOhm(sourceResistance.value)} Ом`,
    },
  ].sort((a, b) => b.value - a.value)
})

const localAiExplanation = computed(() => {
  if (!isReady.value || totalResistance.value <= 0) {
    return 'Введите положительные значения напряжения, мощности источника, сопротивления линии и длины кабеля. После этого система сформирует объяснение результата.'
  }

  const mainFactor = dominantFactors.value[0]
  const secondFactor = dominantFactors.value[1]
  const currentLevel =
    shortCircuitCurrent.value >= 5000
      ? 'большим'
      : shortCircuitCurrent.value >= 1000
        ? 'средним'
        : 'относительно небольшим'
  const reason =
    cableResistance.value > sourceResistance.value
      ? 'Сопротивление кабельной линии и ее длина увеличили общее сопротивление, поэтому ток ограничился.'
      : 'Основной вклад в увеличение тока КЗ внесло низкое сопротивление источника, связанное с высокой мощностью.'

  return `1. Результат получен по формуле Iкз = U / Zсум, где Zсум складывается из сопротивления источника и кабельной линии.
2. Больше всего повлиял параметр "${mainFactor.label}" (${Math.round(mainFactor.value * 100)}%), затем "${secondFactor.label}" (${Math.round(secondFactor.value * 100)}%).
3. Ток получился ${currentLevel}: ${reason}`
})

const displayedAiExplanation = computed(() => remoteAiExplanation.value || localAiExplanation.value)

async function requestAiExplanation() {
  if (!isReady.value || aiLoading.value) return

  aiLoading.value = true
  aiError.value = ''

  try {
    const response = await fetch(aiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...numeric.value,
        sourceResistance: roundForAi(sourceResistance.value),
        cableResistance: roundForAi(cableResistance.value),
        totalResistance: roundForAi(totalResistance.value),
        shortCircuitCurrent: roundForAi(shortCircuitCurrent.value),
        peakCurrent: roundForAi(peakCurrent.value),
      }),
    })

    const data = await parseJsonResponse(response)
    if (!response.ok) {
      throw new Error(data?.error || 'AI-сервис временно недоступен')
    }

    if (!data?.text) {
      throw new Error('AI-модель ответила без текста. Попробуйте другую free-модель OpenRouter.')
    }

    remoteAiExplanation.value = data.text
  } catch (error) {
    aiError.value =
      error instanceof Error
        ? error.message
        : 'Не удалось получить ответ от AI-модели.'
  } finally {
    aiLoading.value = false
  }
}

async function parseJsonResponse(response) {
  const rawText = await response.text()

  if (!rawText) {
    throw new Error(
      'AI-сервер вернул пустой ответ. Локально проверьте npm run dev:api, а на Vercel - переменную OPENROUTER_API_KEY.',
    )
  }

  try {
    return JSON.parse(rawText)
  } catch {
    throw new Error(`AI-сервер вернул не JSON: ${rawText.slice(0, 140)}`)
  }
}

function roundForAi(value) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : 0
}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return '0'

  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value)
}

function formatCurrent(value) {
  if (value >= 1000) return `${formatNumber(value / 1000)} кА`

  return `${formatNumber(value)} А`
}

function formatOhm(value) {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 4,
    minimumFractionDigits: 4,
  }).format(value)
}
</script>

<template>
  <main class="page-shell">
    <section class="intro-section">
      <div>
        <h1>Онлайн калькулятор для вычислительных параметров тока короткого замыкания с применением ИИ</h1>
        <p class="lead">
          Расчетная модель оценивает ток КЗ и ударный ток, а AI-модуль OpenRouter
          объясняет результат на основе введенных электрических параметров.
        </p>
      </div>

      <div class="formula-strip" aria-label="Расчетные формулы">
        <span>Iкз = U / Zсум</span>
        <span>Zсум = Zист + Rлинии x L</span>
        <span>iуд = 1.8 x Iкз</span>
      </div>
    </section>

    <section class="workspace">
      <form class="input-panel" @submit.prevent>
        <div class="panel-heading">
          <p class="section-kicker">Входные параметры</p>
          <h2>Электрическая сеть</h2>
        </div>

        <label class="field">
          <span>Напряжение, В</span>
          <input v-model.number="form.voltage" type="number" min="1" step="1" />
        </label>

        <label class="field">
          <span>Мощность источника, кВА</span>
          <input v-model.number="form.sourcePower" type="number" min="1" step="10" />
        </label>

        <label class="field">
          <span>Сопротивление линии, Ом/км</span>
          <input v-model.number="form.lineResistance" type="number" min="0.001" step="0.001" />
        </label>

        <label class="field">
          <span>Длина кабеля, м</span>
          <input v-model.number="form.cableLength" type="number" min="1" step="1" />
        </label>
      </form>

      <section class="result-panel" aria-live="polite">
        <div class="panel-heading">
          <p class="section-kicker">Результат</p>
          <h2>Расчет короткого замыкания</h2>
        </div>

        <div class="metric-grid">
          <article class="metric primary">
            <span>Ток короткого замыкания</span>
            <strong>{{ formatCurrent(shortCircuitCurrent) }}</strong>
          </article>

          <article class="metric">
            <span>Ударный ток</span>
            <strong>{{ formatCurrent(peakCurrent) }}</strong>
          </article>

          <article class="metric">
            <span>Суммарное сопротивление</span>
            <strong>{{ formatOhm(totalResistance) }} Ом</strong>
          </article>

          <article class="metric">
            <span>Сопротивление источника</span>
            <strong>{{ formatOhm(sourceResistance) }} Ом</strong>
          </article>
        </div>
      </section>
    </section>

    <section class="insight-layout">
      <section class="ai-panel explanation">
        <div class="panel-heading ai-heading">
          <div>
            <p class="section-kicker">OpenRouter AI</p>
            <h2>Объяснение результата</h2>
          </div>
          <span class="model-badge">{{ aiModel }}</span>
        </div>

        <p class="explanation-text">{{ displayedAiExplanation }}</p>

        <div class="ai-actions">
          <button type="button" class="ai-button" :disabled="!isReady || aiLoading" @click="requestAiExplanation">
            {{ aiLoading ? 'AI анализирует...' : 'Сгенерировать AI-анализ' }}
          </button>
          <span class="ai-note">
            {{ remoteAiExplanation ? 'Ответ получен от Laguna через OpenRouter' : 'Пока показано локальное объяснение' }}
          </span>
        </div>

        <p v-if="aiError" class="ai-error">{{ aiError }}</p>

        <div class="factor-bars" v-if="dominantFactors.length">
          <div v-for="factor in dominantFactors" :key="factor.label" class="factor">
            <div class="factor-row">
              <span>{{ factor.label }}</span>
              <b>{{ Math.round(factor.value * 100) }}%</b>
            </div>
            <div class="bar" :aria-label="`${factor.label}: ${Math.round(factor.value * 100)}%`">
              <span :style="{ width: `${Math.max(factor.value * 100, 4)}%` }"></span>
            </div>
            <small>{{ factor.detail }}</small>
          </div>
        </div>
      </section>
    </section>
  </main>
</template>
