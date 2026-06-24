import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { resolve } from "node:path"

const CONFIG_PATH = resolve(homedir(), ".logos", "config.json")

export class LogosSecrets {
  readonly anthropicApiKey: string | undefined

  constructor(configPath = CONFIG_PATH) {
    try {
      const raw = JSON.parse(readFileSync(configPath, "utf8"))
      const key = raw?.anthropic_api_key
      this.anthropicApiKey = typeof key === "string" && key.trim() ? key.trim() : undefined
    } catch {
      this.anthropicApiKey = undefined
    }
  }
}
