// The three logos-ts data structures, per spec.

// ---- #1 Architecture ----

export interface Param {
  name: string
  type: string
}

export interface Field {
  name: string
  type: string
}

export interface FunctionModel {
  kind: "function"
  name: string
  args: Param[]
  retTy: string
  body: string
}

export interface ClassModel {
  kind: "class"
  name: string
  fields: Field[]
  functions: FunctionModel[]
}

export type Decl = FunctionModel | ClassModel

export interface TestModel {
  name: string
  body: string
}

// Architecture: list[class | function] + tests
export interface Architecture {
  items: Decl[]
  tests: TestModel[]
}

// ---- #2 Dependency analysis ----

// name -> set of names it references
export type DependencyTree = Map<string, Set<string>>

// ---- #3 Stories ----

// story (id) -> component name it implements
export type StoryMap = Map<string, string>
