export type PreviewRenderer = "portable" | "storybook"

export interface PreviewPanelProps {
  storyId: string
  renderer: PreviewRenderer
  storybookUrl?: string
  renderKey: string
}

export function PreviewPanel({
  storyId,
  renderer,
  storybookUrl = "",
  renderKey,
}: PreviewPanelProps) {
  const params = new URLSearchParams({ storyId, logosReload: renderKey })
  const src = renderer === "portable"
    ? `/portable-story.html?${params.toString()}`
    : `${storybookUrl}/iframe.html?id=${storyId}&viewMode=story&logosReload=${encodeURIComponent(renderKey)}`

  return (
    <section aria-label="Preview panel">
      <header>{storyId}</header>
      <iframe className="story-frame" src={src} title={storyId} />
    </section>
  )
}
