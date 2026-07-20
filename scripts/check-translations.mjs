import { readFile } from 'node:fs/promises'

function flatten(value, prefix = '') {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return child && typeof child === 'object' && !Array.isArray(child)
      ? flatten(child, path)
      : [path]
  })
}

const [english, chinese] = await Promise.all([
  readFile(new URL('../messages/en.json', import.meta.url), 'utf8').then(JSON.parse),
  readFile(new URL('../messages/zh.json', import.meta.url), 'utf8').then(JSON.parse),
])

const enKeys = new Set(flatten(english))
const zhKeys = new Set(flatten(chinese))
const missingChinese = [...enKeys].filter((key) => !zhKeys.has(key)).sort()
const missingEnglish = [...zhKeys].filter((key) => !enKeys.has(key)).sort()

if (missingChinese.length || missingEnglish.length) {
  if (missingChinese.length) console.error(`Missing Chinese keys:\n${missingChinese.join('\n')}`)
  if (missingEnglish.length) console.error(`Missing English keys:\n${missingEnglish.join('\n')}`)
  process.exitCode = 1
} else {
  console.log(`Translation keys are aligned (${enKeys.size} keys).`)
}
