import { Component, StrictMode, type ComponentType, type ErrorInfo, type ReactNode } from "react"
import { createRoot } from "react-dom/client"

interface PortableStoryModule {
  PortableStory: ComponentType
  storyId: string
  storyTitle: string
}

const params = new URLSearchParams(window.location.search)
const storyModule = await import(
  /* @vite-ignore */
  `/@id/__x00__virtual:logos-portable-story?${params.toString()}`
) as PortableStoryModule
const { PortableStory, storyId, storyTitle } = storyModule

let snapshotHtml: string | null = null

function applySnapshot(): void {
  if (snapshotHtml == null) return
  const root = document.getElementById("portable-story-root")
  if (!root) return
  root.innerHTML = snapshotHtml
  window.parent?.postMessage({ type: "logos:snapshot-rendered", storyId, storyTitle }, "*")
}

window.addEventListener("message", (e) => {
  if (e.data?.type !== "logos:render-snapshot") return
  snapshotHtml = e.data.html ?? ""
  applySnapshot()
})

interface ErrorBoundaryState {
  error: Error | null
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[logos-portable-story] render failed", error, info)
    window.parent?.postMessage({
      type: "logos:portable-story-error",
      storyId,
      message: error.message,
      stack: error.stack,
    }, "*")
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
          <h1>Story render failed</h1>
          <pre style={{ whiteSpace: "pre-wrap" }}>{this.state.error.stack ?? this.state.error.message}</pre>
        </main>
      )
    }
    return this.props.children
  }
}

function Frame(): ReactNode {
  return (
    <section data-portable-story-rendered={storyId} data-portable-story-title={storyTitle}>
      <PortableStory />
    </section>
  )
}

const root = document.getElementById("portable-story-root")
if (!root) throw new Error("portable story root was not found")

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <Frame />
    </ErrorBoundary>
  </StrictMode>
)

window.parent?.postMessage({ type: "logos:portable-story-loaded", storyId, storyTitle }, "*")
