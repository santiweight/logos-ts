import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve, join } from "node:path"

const TSX = resolve(__dirname, "../node_modules/.bin/tsx")
const ARCHMODE = resolve(__dirname, "archmode.ts")

function run(cmd: string, dir: string, recFile: string) {
  execFileSync(TSX, [ARCHMODE, cmd, dir, recFile], { encoding: "utf8" })
}

function setupFixture(files: Record<string, string>): { dir: string; recFile: string } {
  const id = `archmode-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const dir = resolve(__dirname, `../.test-fixtures/${id}`)
  mkdirSync(dir, { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    const p = join(dir, name)
    mkdirSync(resolve(p, ".."), { recursive: true })
    writeFileSync(p, content)
  }
  const recFile = resolve(dir, ".bodies.json")
  return { dir, recFile }
}

function readFile(dir: string, name: string): string {
  return readFileSync(join(dir, name), "utf8")
}

let fixtures: string[] = []
function tracked(f: { dir: string; recFile: string }) {
  fixtures.push(f.dir)
  return f
}

afterEach(() => {
  for (const d of fixtures) rmSync(d, { recursive: true, force: true })
  fixtures = []
})

// ---------------------------------------------------------------------------
// Single-file basics
// ---------------------------------------------------------------------------
describe("single-file roundtrip", () => {
  it("fibonacci function", () => {
    const src = `export function fib(n: number): number {
  if (n <= 1) return n
  return fib(n - 1) + fib(n - 2)
}
`
    const { dir, recFile } = tracked(setupFixture({ "fib.ts": src }))

    run("strip", dir, recFile)
    const stripped = readFile(dir, "fib.ts")
    expect(stripped).toContain("declare")
    expect(stripped).not.toContain("return fib(n - 1)")

    run("splice", dir, recFile)
    const restored = readFile(dir, "fib.ts")
    expect(restored).toContain("return fib(n - 1) + fib(n - 2)")
    expect(restored).not.toContain("declare")
  })

  it("GCD function", () => {
    const src = `export function gcd(a: number, b: number): number {
  while (b !== 0) {
    const t = b
    b = a % b
    a = t
  }
  return a
}
`
    const { dir, recFile } = tracked(setupFixture({ "gcd.ts": src }))

    run("strip", dir, recFile)
    const stripped = readFile(dir, "gcd.ts")
    expect(stripped).toContain("declare function gcd")
    expect(stripped).not.toContain("while (b !== 0)")

    run("splice", dir, recFile)
    const restored = readFile(dir, "gcd.ts")
    expect(restored).toContain("while (b !== 0)")
  })

  it("const arrow function", () => {
    const src = `export const add = (a: number, b: number): number => a + b
`
    const { dir, recFile } = tracked(setupFixture({ "add.ts": src }))

    run("strip", dir, recFile)
    const stripped = readFile(dir, "add.ts")
    expect(stripped).toContain("declare")
    expect(stripped).not.toContain("=> a + b")

    run("splice", dir, recFile)
    const restored = readFile(dir, "add.ts")
    expect(restored).toContain("=> a + b")
    expect(restored).not.toContain("declare")
  })

  it("class with methods and properties", () => {
    const src = `export class Counter {
  private count: number = 0

  increment(): void {
    this.count++
  }

  decrement(): void {
    this.count--
  }

  getCount(): number {
    return this.count
  }
}
`
    const { dir, recFile } = tracked(setupFixture({ "counter.ts": src }))

    run("strip", dir, recFile)
    const stripped = readFile(dir, "counter.ts")
    expect(stripped).toContain("declare class Counter")
    expect(stripped).not.toContain("this.count++")
    expect(stripped).not.toContain("this.count--")

    run("splice", dir, recFile)
    const restored = readFile(dir, "counter.ts")
    expect(restored).toContain("this.count++")
    expect(restored).toContain("this.count--")
    expect(restored).toContain("return this.count")
  })

  it("multiple declarations in one file", () => {
    const src = `export function fib(n: number): number {
  if (n <= 1) return n
  return fib(n - 1) + fib(n - 2)
}

export const PI = 3.14159

export class MathHelper {
  static factorial(n: number): number {
    if (n <= 1) return 1
    return n * MathHelper.factorial(n - 1)
  }
}
`
    const { dir, recFile } = tracked(setupFixture({ "math.ts": src }))

    run("strip", dir, recFile)
    const stripped = readFile(dir, "math.ts")
    expect(stripped).toContain("declare function fib")
    expect(stripped).toContain("declare const PI")
    expect(stripped).toContain("declare class MathHelper")
    expect(stripped).not.toContain("return fib(n - 1)")
    expect(stripped).not.toContain("3.14159")

    run("splice", dir, recFile)
    const restored = readFile(dir, "math.ts")
    expect(restored).toContain("return fib(n - 1) + fib(n - 2)")
    expect(restored).toContain("3.14159")
    expect(restored).toContain("MathHelper.factorial(n - 1)")
  })

  it("preserves interfaces and type aliases (no stripping)", () => {
    const src = `export interface Point {
  x: number
  y: number
}

export type Direction = "up" | "down" | "left" | "right"

export function move(p: Point, d: Direction): Point {
  switch (d) {
    case "up": return { x: p.x, y: p.y + 1 }
    case "down": return { x: p.x, y: p.y - 1 }
    case "left": return { x: p.x - 1, y: p.y }
    case "right": return { x: p.x + 1, y: p.y }
  }
}
`
    const { dir, recFile } = tracked(setupFixture({ "point.ts": src }))

    run("strip", dir, recFile)
    const stripped = readFile(dir, "point.ts")
    expect(stripped).toContain("export interface Point")
    expect(stripped).toContain("x: number")
    expect(stripped).toContain('export type Direction = "up"')
    expect(stripped).toContain("declare function move")
    expect(stripped).not.toContain("p.x + 1")

    run("splice", dir, recFile)
    const restored = readFile(dir, "point.ts")
    expect(restored).toContain("export interface Point")
    expect(restored).toContain('export type Direction = "up"')
    expect(restored).toContain("p.x + 1")
  })
})

// ---------------------------------------------------------------------------
// Multi-file cases
// ---------------------------------------------------------------------------
describe("multi-file roundtrip", () => {
  it("cross-file imports preserved", () => {
    const types = `export interface User {
  id: string
  name: string
  email: string
}

export interface Post {
  id: string
  authorId: string
  title: string
  body: string
}
`
    const store = `import type { User, Post } from "./types"

const users: User[] = []
const posts: Post[] = []

export function addUser(u: User): void {
  users.push(u)
}

export function addPost(p: Post): void {
  posts.push(p)
}

export function getUserPosts(userId: string): Post[] {
  return posts.filter(p => p.authorId === userId)
}

export function getUser(id: string): User | undefined {
  return users.find(u => u.id === id)
}
`
    const api = `import { addUser, addPost, getUserPosts, getUser } from "./store"
import type { User, Post } from "./types"

export function createUser(name: string, email: string): User {
  const user: User = { id: String(Date.now()), name, email }
  addUser(user)
  return user
}

export function createPost(authorId: string, title: string, body: string): Post {
  const post: Post = { id: String(Date.now()), authorId, title, body }
  addPost(post)
  return post
}

export function getUserFeed(userId: string): { user: User | undefined; posts: Post[] } {
  return { user: getUser(userId), posts: getUserPosts(userId) }
}
`
    const { dir, recFile } = tracked(setupFixture({
      "types.ts": types,
      "store.ts": store,
      "api.ts": api,
    }))

    run("strip", dir, recFile)

    const strippedStore = readFile(dir, "store.ts")
    expect(strippedStore).toContain("declare function addUser")
    expect(strippedStore).toContain("declare function getUserPosts")
    expect(strippedStore).not.toContain("users.push(u)")

    const strippedApi = readFile(dir, "api.ts")
    expect(strippedApi).toContain("declare function createUser")
    expect(strippedApi).not.toContain("String(Date.now())")

    // Types file should be untouched
    const strippedTypes = readFile(dir, "types.ts")
    expect(strippedTypes).toBe(types)

    run("splice", dir, recFile)

    const restoredStore = readFile(dir, "store.ts")
    expect(restoredStore).toContain("users.push(u)")
    expect(restoredStore).toContain("posts.filter(p => p.authorId === userId)")
    // organizeImports may reorder — just check both names are imported
    expect(restoredStore).toMatch(/import type \{.*User.*Post.*\}|import type \{.*Post.*User.*\}/)

    const restoredApi = readFile(dir, "api.ts")
    expect(restoredApi).toContain("String(Date.now())")
    expect(restoredApi).toContain("addUser(user)")
  })

  it("simulated arch agent: move function between files", () => {
    const mathSrc = `export function add(a: number, b: number): number {
  return a + b
}

export function multiply(a: number, b: number): number {
  return a * b
}
`
    const mainSrc = `import { add, multiply } from "./math"

export function compute(x: number, y: number): number {
  return add(multiply(x, y), x)
}
`
    const { dir, recFile } = tracked(setupFixture({
      "math.ts": mathSrc,
      "main.ts": mainSrc,
    }))

    run("strip", dir, recFile)

    // Simulate agent moving `multiply` from math.ts to a new file arithmetic.ts
    const strippedMath = readFile(dir, "math.ts")
    const withoutMultiply = strippedMath.replace(/^export declare function multiply.*$/m, "").trim() + "\n"
    writeFileSync(join(dir, "math.ts"), withoutMultiply)
    writeFileSync(join(dir, "arithmetic.ts"), `export declare function multiply(a: number, b: number): number\n`)

    run("splice", dir, recFile)

    // add should be restored in math.ts
    const restoredMath = readFile(dir, "math.ts")
    expect(restoredMath).toContain("return a + b")

    // multiply should be restored in arithmetic.ts (moved there by the agent)
    const restoredArith = readFile(dir, "arithmetic.ts")
    expect(restoredArith).toContain("return a * b")
    expect(restoredArith).not.toContain("declare")
  })

  it("simulated arch agent: add new declaration to existing file", () => {
    const src = `export function greet(name: string): string {
  return "Hello, " + name
}
`
    const { dir, recFile } = tracked(setupFixture({ "greet.ts": src }))

    run("strip", dir, recFile)

    // Agent adds a new function declaration
    const stripped = readFile(dir, "greet.ts")
    writeFileSync(join(dir, "greet.ts"), stripped + `\nexport declare function farewell(name: string): string\n`)

    run("splice", dir, recFile)

    const restored = readFile(dir, "greet.ts")
    // Original should be restored
    expect(restored).toContain('return "Hello, " + name')
    // New declaration stays as declare (no body to restore — expected)
    expect(restored).toContain("farewell")
  })

  it("simulated arch agent: create entirely new file", () => {
    const src = `export function existing(): string {
  return "I exist"
}
`
    const { dir, recFile } = tracked(setupFixture({ "existing.ts": src }))

    run("strip", dir, recFile)

    // Agent creates a brand new file
    writeFileSync(join(dir, "newfile.ts"), `export declare function brandNew(x: number): number\n`)

    run("splice", dir, recFile)

    const restored = readFile(dir, "existing.ts")
    expect(restored).toContain('return "I exist"')

    // New file — splice can't restore a body, so declare stays
    const newFile = readFile(dir, "newfile.ts")
    expect(newFile).toContain("declare function brandNew")
  })

  it("many type signatures: interfaces, generics, unions", () => {
    const types = `export interface Config<T> {
  key: string
  value: T
  metadata?: Record<string, unknown>
}

export type Result<T, E = Error> = { ok: true; data: T } | { ok: false; error: E }

export interface Repository<T extends { id: string }> {
  findById(id: string): T | undefined
  findAll(): T[]
  save(item: T): void
  delete(id: string): boolean
}
`
    const impl = `import type { Config, Result, Repository } from "./types"

export interface Item {
  id: string
  name: string
  value: number
}

export class ItemRepository implements Repository<Item> {
  private items: Item[] = []

  findById(id: string): Item | undefined {
    return this.items.find(i => i.id === id)
  }

  findAll(): Item[] {
    return [...this.items]
  }

  save(item: Item): void {
    const idx = this.items.findIndex(i => i.id === item.id)
    if (idx >= 0) this.items[idx] = item
    else this.items.push(item)
  }

  delete(id: string): boolean {
    const idx = this.items.findIndex(i => i.id === id)
    if (idx < 0) return false
    this.items.splice(idx, 1)
    return true
  }
}

export function parseConfig<T>(raw: string): Result<Config<T>> {
  try {
    const parsed = JSON.parse(raw)
    if (!parsed.key) return { ok: false, error: new Error("missing key") }
    return { ok: true, data: parsed as Config<T> }
  } catch (e) {
    return { ok: false, error: e as Error }
  }
}

export const DEFAULT_CONFIG: Config<string> = {
  key: "default",
  value: "none",
  metadata: {},
}
`
    const { dir, recFile } = tracked(setupFixture({
      "types.ts": types,
      "impl.ts": impl,
    }))

    run("strip", dir, recFile)

    const strippedImpl = readFile(dir, "impl.ts")
    expect(strippedImpl).toContain("declare class ItemRepository")
    expect(strippedImpl).toContain("declare function parseConfig")
    expect(strippedImpl).toContain("declare const DEFAULT_CONFIG")
    expect(strippedImpl).not.toContain("JSON.parse(raw)")
    expect(strippedImpl).not.toContain('key: "default"')

    // Types should be untouched
    expect(readFile(dir, "types.ts")).toBe(types)

    run("splice", dir, recFile)

    const restoredImpl = readFile(dir, "impl.ts")
    expect(restoredImpl).toContain("JSON.parse(raw)")
    expect(restoredImpl).toContain("this.items.find(i => i.id === id)")
    expect(restoredImpl).toContain("this.items.splice(idx, 1)")
    expect(restoredImpl).toContain('key: "default"')
    expect(restoredImpl).not.toContain("declare class")
    expect(restoredImpl).not.toContain("declare function")
    expect(restoredImpl).not.toContain("declare const")
  })

  it("simulated arch agent: rename a function", () => {
    const src = `export function calculateTotal(items: number[]): number {
  return items.reduce((sum, n) => sum + n, 0)
}

export function formatCurrency(amount: number): string {
  return "$" + amount.toFixed(2)
}
`
    const { dir, recFile } = tracked(setupFixture({ "billing.ts": src }))

    run("strip", dir, recFile)

    // Agent renames calculateTotal -> sumItems
    let stripped = readFile(dir, "billing.ts")
    stripped = stripped.replace("calculateTotal", "sumItems")
    writeFileSync(join(dir, "billing.ts"), stripped)

    run("splice", dir, recFile)

    const restored = readFile(dir, "billing.ts")
    // formatCurrency should be restored (name unchanged)
    expect(restored).toContain('return "$" + amount.toFixed(2)')

    // sumItems: the body was stored under "calculateTotal", so splice
    // won't find it by "sumItems" — this is a known limitation.
    // The declaration stays as `declare`.
    // This test documents the current behavior.
    expect(restored).toContain("sumItems")
  })

  it("simulated arch agent: split file into multiple", () => {
    const src = `export interface Shape {
  area(): number
}

export class Circle implements Shape {
  constructor(public radius: number) {}
  area(): number {
    return Math.PI * this.radius ** 2
  }
}

export class Rectangle implements Shape {
  constructor(public width: number, public height: number) {}
  area(): number {
    return this.width * this.height
  }
}

export function totalArea(shapes: Shape[]): number {
  return shapes.reduce((sum, s) => sum + s.area(), 0)
}
`
    const { dir, recFile } = tracked(setupFixture({ "shapes.ts": src }))

    run("strip", dir, recFile)

    // Agent splits: Circle -> circle.ts, Rectangle -> rectangle.ts, totalArea stays
    const strippedShapes = readFile(dir, "shapes.ts")

    // Extract declarations
    const circleMatch = strippedShapes.match(/export declare class Circle[\s\S]*?^}/m)
    const rectMatch = strippedShapes.match(/export declare class Rectangle[\s\S]*?^}/m)

    expect(circleMatch).toBeTruthy()
    expect(rectMatch).toBeTruthy()

    // Write split files
    writeFileSync(join(dir, "circle.ts"), `import type { Shape } from "./shapes"\n\n${circleMatch![0]}\n`)
    writeFileSync(join(dir, "rectangle.ts"), `import type { Shape } from "./shapes"\n\n${rectMatch![0]}\n`)

    // Remove Circle and Rectangle from shapes.ts, keep interface + totalArea
    let remaining = strippedShapes
      .replace(/export declare class Circle[\s\S]*?^}/m, "")
      .replace(/export declare class Rectangle[\s\S]*?^}/m, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim() + "\n"
    writeFileSync(join(dir, "shapes.ts"), remaining)

    run("splice", dir, recFile)

    // Circle body should be restored in circle.ts
    const restoredCircle = readFile(dir, "circle.ts")
    expect(restoredCircle).toContain("Math.PI * this.radius ** 2")

    // Rectangle body should be restored in rectangle.ts
    const restoredRect = readFile(dir, "rectangle.ts")
    expect(restoredRect).toContain("this.width * this.height")

    // totalArea should be restored in shapes.ts
    const restoredShapes = readFile(dir, "shapes.ts")
    expect(restoredShapes).toContain("shapes.reduce((sum, s) => sum + s.area(), 0)")
  })

  it("duplicate names across files are skipped (not stripped)", () => {
    const a = `export function helper(): string {
  return "from a"
}
`
    const b = `export function helper(): string {
  return "from b"
}
`
    const { dir, recFile } = tracked(setupFixture({ "a.ts": a, "b.ts": b }))

    run("strip", dir, recFile)

    // Both should be untouched — names collide so strip skips them
    expect(readFile(dir, "a.ts")).toBe(a)
    expect(readFile(dir, "b.ts")).toBe(b)
  })

  it("React-style const component with props", () => {
    const src = `import { type FC } from "react"

export interface ButtonProps {
  label: string
  onClick?: () => void
  disabled?: boolean
}

export const Button: FC<ButtonProps> = ({ label, onClick, disabled }) => {
  return (
    <button onClick={onClick} disabled={disabled}>
      {label}
    </button>
  )
}
`
    const { dir, recFile } = tracked(setupFixture({ "Button.tsx": src }))

    run("strip", dir, recFile)
    const stripped = readFile(dir, "Button.tsx")
    expect(stripped).toContain("declare const Button")
    expect(stripped).not.toContain("<button")

    run("splice", dir, recFile)
    const restored = readFile(dir, "Button.tsx")
    expect(restored).toContain("<button onClick={onClick}")
    expect(restored).toContain("{label}")
    expect(restored).not.toContain("declare")
  })
})
