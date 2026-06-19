import { dirname, isAbsolute, relative, sep } from "node:path"

function slash(path: string): string {
  return path.split(sep).join("/")
}

function withoutTsExtension(path: string): string {
  return path.replace(/\.(d\.)?[cm]?tsx?$/, "")
}

function packageSpecifierFromNodeModules(path: string): string | null {
  const parts = slash(path).split("/")
  const index = parts.lastIndexOf("node_modules")
  if (index < 0) return null
  const rest = parts.slice(index + 1)
  const first = rest[0]
  if (!first) return null

  if (first === "@types") {
    const typePackage = rest[1]
    if (!typePackage) return null
    const packageName = typePackage.includes("__") ? `@${typePackage.replace("__", "/")}` : typePackage
    const subpath = rest.slice(2).join("/")
    return withoutTsExtension(subpath && subpath !== "index" ? `${packageName}/${subpath}` : packageName)
  }

  const packageName = first.startsWith("@") && rest[1] ? `${first}/${rest[1]}` : first
  const subpath = rest.slice(packageName.startsWith("@") ? 2 : 1).join("/")
  return withoutTsExtension(subpath && subpath !== "index" ? `${packageName}/${subpath}` : packageName)
}

function relativeModuleSpecifier(fromFile: string, toPath: string): string {
  const rel = slash(withoutTsExtension(relative(dirname(fromFile), toPath)))
  return rel.startsWith(".") ? rel : `./${rel}`
}

export function normalizeTypeImportPaths(text: string, absRoot: string, contextFile: string): string {
  return text.replace(/(import\(\s*["'])(\/[^"']+)(["']\s*\))/g, (match, prefix: string, specifier: string, suffix: string) => {
    if (!isAbsolute(specifier)) return match

    const packageSpecifier = packageSpecifierFromNodeModules(specifier)
    if (packageSpecifier != null) return `${prefix}${packageSpecifier}${suffix}`

    const relFromRoot = relative(absRoot, specifier)
    if (relFromRoot.startsWith("..") || isAbsolute(relFromRoot)) return match

    return `${prefix}${relativeModuleSpecifier(contextFile, specifier)}${suffix}`
  })
}
