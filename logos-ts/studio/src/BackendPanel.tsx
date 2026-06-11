import { CommentCtx, DiffCtx, Row } from "./arch"
import type { BackendFile, BackendSel, BackendMethod, CommentApi, DiffStatus, TestRef } from "./types"

interface Props {
  backend: BackendFile[]
  selection: BackendSel
  comments: Record<string, CommentApi["comments"][string]>
  onComment: CommentApi["onComment"]
  diff: Record<string, DiffStatus>
}

const TestRow = ({ t }: { t: TestRef }) => (
  <Row
    tag="test"
    tagClass="test"
    title={t.name}
    desc={t.description}
    code={t.code}
    indent
    target={`test:${t.file}::${t.name}`}
    label={`test · ${t.name}`}
  />
)

function MethodBlock({ m, className }: { m: BackendMethod; className: string }) {
  return (
    <>
      <Row
        tag="method"
        tagClass="method"
        title={m.signature}
        code={m.code}
        target={`method:${className}.${m.name}`}
        label={`· ${m.name}`}
      />
      {m.tests.map((t) => (
        <TestRow key={t.name} t={t} />
      ))}
    </>
  )
}

export function BackendPanel({ backend, selection, comments, onComment, diff }: Props) {
  const item = backend.flatMap((f) => f.items).find((i) => i.name === selection.symbol)
  if (!item) return <div className="empty">Select a backend node.</div>

  const header = (label: string) => (
    <header className="content-header">
      <span className="crumb">{label}</span>
    </header>
  )

  const body =
    item.kind === "function" ? (
      <section className="content">
        {header(`ƒ ${item.name}`)}
        <div className="content-body">
          <div className="rows">
            <Row
              tag="impl"
              tagClass="impl"
              title={item.signature}
              code={item.code}
              target={`fn:${item.name}`}
              label={`ƒ ${item.name}`}
            />
            {item.tests.map((t) => (
              <TestRow key={t.name} t={t} />
            ))}
          </div>
          <div className="deps">deps → {item.deps.join(" · ") || "—"}</div>
        </div>
      </section>
    ) : (
      <section className="content">
        {header(`⬚ ${item.name}`)}
        <div className="content-body">
          <div className="rows">
            <Row
              tag="class"
              tagClass="cls"
              title={`class ${item.name}`}
              code={item.code}
              target={`cls:${item.name}`}
              label={`⬚ ${item.name}`}
            />
            {item.tests.map((t) => (
              <TestRow key={t.name} t={t} />
            ))}
            {item.methods.map((m) => (
              <MethodBlock key={m.name} m={m} className={item.name} />
            ))}
          </div>
          <div className="deps">deps → {item.deps.join(" · ") || "—"}</div>
        </div>
      </section>
    )

  return (
    <CommentCtx.Provider value={{ comments, onComment }}>
      <DiffCtx.Provider value={diff}>{body}</DiffCtx.Provider>
    </CommentCtx.Provider>
  )
}
