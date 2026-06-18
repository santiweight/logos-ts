// Eval oracle for the generic "write component stories" goal. Copied into
// <workspace>/frontend at check time so the agent never sees this file.
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("ValueOrDash stories", () => {
  const storyFile = () => readFileSync(resolve(process.cwd(), "components/ValueOrDash.stories.tsx"), "utf8")

  it("uses typed Storybook exports for the target component", () => {
    const text = storyFile()

    expect(text).toContain("Meta")
    expect(text).toContain("StoryObj")
    expect(text).toContain("component: ValueOrDash")
  })

  it("covers filled and empty value states without production data", () => {
    const text = storyFile()
    const storyExports = [...text.matchAll(/export const \w+\s*:/g)].map((match) => match[0])

    expect(storyExports.length).toBeGreaterThanOrEqual(4)
    expect(text).toMatch(/value:\s*["'`][^"'`]+["'`]/)
    expect(text).toMatch(/value:\s*null/)
    expect(text).toMatch(/value:\s*undefined/)
    expect(text).toMatch(/value:\s*["'`]["'`]/)
  })
})
