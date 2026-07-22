import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('Skills Registry E2E fixture', () => {
  it('uses a local fixture only in test mode while preserving the production URL', () => {
    const registry = read('src/lib/skill-registry.ts')
    const playwright = read('playwright.config.ts')
    const fixture = read('tests/fixtures/awesome-openclaw/README.md')

    expect(registry).toContain("process.env.MISSION_CONTROL_TEST_MODE === '1'")
    expect(registry).toContain('MC_AWESOME_OPENCLAW_README_FIXTURE')
    expect(registry).toContain('https://raw.githubusercontent.com/VoltAgent/awesome-openclaw-skills/main/README.md')
    expect(playwright).toContain("MC_AWESOME_OPENCLAW_README_FIXTURE: 'tests/fixtures/awesome-openclaw/README.md'")
    expect(fixture).toContain('fixture-author/git-workflow/SKILL.md')
  })
})
