import type { Meta, StoryObj } from "@storybook/react-vite"
import { AgentPanel, type AgentMsg } from "./AgentPanel"

const meta: Meta<typeof AgentPanel> = {
  title: "studio/AgentPanel",
  component: AgentPanel,
}
export default meta

type Story = StoryObj<typeof AgentPanel>

// Empty state — no agent activity yet, shows placeholder text.
export const Empty: Story = {
  args: {
    events: [],
    running: false,
    onClose: () => {},
  },
}

// Agent actively running with a mix of status, tool-use, and text events.
export const Running: Story = {
  args: {
    events: [
      { type: "event", event: { type: "system", subtype: "init", model: "claude-sonnet-4-20250514" } },
      { type: "status", message: "reading project context…" },
      {
        type: "event",
        event: {
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", name: "Read", input: { file_path: "src/architecture.ts" } },
            ],
          },
        },
      },
      {
        type: "event",
        event: {
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "I'll refactor the extractFunctions helper to handle arrow functions assigned to const." },
            ],
          },
        },
      },
      {
        type: "event",
        event: {
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", name: "Edit", input: { file_path: "src/architecture.ts" } },
            ],
          },
        },
      },
    ] satisfies AgentMsg[],
    running: true,
    onClose: () => {},
  },
}

// Agent finished with a result event showing cost.
export const Completed: Story = {
  args: {
    events: [
      { type: "event", event: { type: "system", subtype: "init", model: "claude-sonnet-4-20250514" } },
      { type: "status", message: "analyzing dependencies…" },
      {
        type: "event",
        event: {
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "Done. Updated 3 files to use the new FileEntry model." },
            ],
          },
        },
      },
      { type: "event", event: { type: "result", total_cost_usd: 0.042 } },
      { type: "done" },
    ] satisfies AgentMsg[],
    running: false,
    onClose: () => {},
  },
}

// Agent run that ended with an error.
export const Error: Story = {
  args: {
    events: [
      { type: "event", event: { type: "system", subtype: "init", model: "claude-sonnet-4-20250514" } },
      { type: "status", message: "starting agent…" },
      { type: "stderr", message: "Error: ENOENT: no such file or directory, open '/tmp/fork-abc/tsconfig.json'" },
      { type: "error", message: "agent process exited with code 1" },
    ] satisfies AgentMsg[],
    running: false,
    onClose: () => {},
  },
}

// ---- Bug fix verification stories ----

// Bug 3: Thinking indicator — consecutive thinking_tokens events should collapse
// into a single "⟳ thinking…" line instead of showing nothing.
function thinkingTokens(est: number, delta: number): AgentMsg {
  return { type: "event", event: { type: "system", subtype: "thinking_tokens", estimated_tokens: est, estimated_tokens_delta: delta } }
}

export const ThinkingPhase: Story = {
  args: {
    events: [
      { type: "status", message: "preparing workspace instance…" },
      { type: "status", message: "building architecture context…" },
      { type: "status", message: "starting agent…" },
      { type: "event", event: { type: "system", subtype: "init", model: "claude-sonnet-4-6" } },
      {
        type: "event",
        event: { type: "assistant", message: { content: [{ type: "text", text: "Let me read the App.tsx file to understand its current structure." }] } },
      },
      {
        type: "event",
        event: { type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "studio/src/App.tsx" } }] } },
      },
      // Tool result (invisible but present)
      { type: "event", event: { type: "user", message: { role: "user", content: [{ tool_use_id: "toolu_1", type: "tool_result", content: "..." }] } } },
      // Extended thinking phase — should show ONE "thinking…" indicator, not 330 blank lines
      thinkingTokens(21, 21),
      thinkingTokens(42, 21),
      thinkingTokens(100, 58),
      thinkingTokens(200, 100),
      thinkingTokens(400, 200),
      thinkingTokens(600, 200),
      thinkingTokens(751, 151),
      thinkingTokens(774, 23),
      thinkingTokens(806, 32),
      thinkingTokens(818, 12),
      // Agent responds after thinking
      {
        type: "event",
        event: { type: "assistant", message: { content: [{ type: "text", text: "I'll extract the render portion of App into an exported StudioLayout component." }] } },
      },
      {
        type: "event",
        event: { type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "studio/src/App.tsx" } }] } },
      },
    ] satisfies AgentMsg[],
    running: true,
    goal: { id: "goal-1", text: "Split this out into the main page view", label: "Split App Out Into Main", mode: "code", status: "running" } as any,
    onClose: () => {},
  },
}

// Bug 3: Compaction indicator — the "compacting" status event should show
// "▸ compacting context…" instead of nothing.
export const CompactingContext: Story = {
  args: {
    events: [
      { type: "status", message: "starting agent…" },
      { type: "event", event: { type: "system", subtype: "init", model: "claude-sonnet-4-6" } },
      {
        type: "event",
        event: { type: "assistant", message: { content: [{ type: "text", text: "Let me read the file." }] } },
      },
      {
        type: "event",
        event: { type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "studio/src/App.tsx" } }] } },
      },
      thinkingTokens(200, 200),
      thinkingTokens(400, 200),
      {
        type: "event",
        event: { type: "assistant", message: { content: [{ type: "text", text: "I'll extract the render portion into a StudioLayout component." }] } },
      },
      // Context compaction
      { type: "event", event: { type: "system", subtype: "status", status: "compacting" } },
      // After compaction, agent re-reads
      thinkingTokens(50, 50),
      thinkingTokens(100, 50),
      {
        type: "event",
        event: { type: "assistant", message: { content: [{ type: "text", text: "Reading the current App.tsx to work from the actual source." }] } },
      },
      {
        type: "event",
        event: { type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "studio/src/App.tsx" } }] } },
      },
    ] satisfies AgentMsg[],
    running: true,
    goal: { id: "goal-1", text: "Split this out into the main page view", label: "Split App Out Into Main", mode: "code", status: "running" } as any,
    onClose: () => {},
  },
}

// Bug 2: SSE reconnection — shows the retry status message after a disconnect.
export const SSEReconnected: Story = {
  args: {
    events: [
      { type: "status", message: "starting agent…" },
      { type: "event", event: { type: "system", subtype: "init", model: "claude-sonnet-4-6" } },
      {
        type: "event",
        event: { type: "assistant", message: { content: [{ type: "text", text: "I'll add the loading state to the search component." }] } },
      },
      {
        type: "event",
        event: { type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "app/directory/page.tsx" } }] } },
      },
      thinkingTokens(100, 100),
      thinkingTokens(300, 200),
      // SSE disconnected and reconnected — history reloaded
      { type: "status", message: "agent stream disconnected; retrying…" },
      // After reconnect, agent continues (re-attached to running agent)
      { type: "status", message: "attached to running agent" },
      {
        type: "event",
        event: { type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "app/directory/page.tsx" } }] } },
      },
      {
        type: "event",
        event: { type: "assistant", message: { content: [{ type: "text", text: "Added a loading spinner that shows during search." }] } },
      },
    ] satisfies AgentMsg[],
    running: true,
    goal: { id: "goal-2", text: "Add loading state during search", label: "Add Loading State", mode: "code", status: "running" } as any,
    onClose: () => {},
  },
}

// Bug 1: Historical events loaded on page refresh — shows what the panel
// looks like after boot recovery loads past events for a running goal.
export const BootRecovery: Story = {
  args: {
    events: [
      // All these were loaded from the session API on page refresh
      { type: "status", message: "preparing workspace instance…" },
      { type: "status", message: "building architecture context…" },
      { type: "status", message: "starting agent…" },
      { type: "event", event: { type: "system", subtype: "init", model: "claude-sonnet-4-6" } },
      {
        type: "event",
        event: { type: "assistant", message: { content: [{ type: "text", text: "I'll refactor the FiltersSidebar component." }] } },
      },
      {
        type: "event",
        event: { type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "src/components/FiltersSidebar.tsx" } }] } },
      },
      thinkingTokens(200, 200),
      thinkingTokens(500, 300),
      {
        type: "event",
        event: { type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "src/components/FiltersSidebar.tsx" } }] } },
      },
      {
        type: "event",
        event: { type: "assistant", message: { content: [{ type: "text", text: "Updated the sidebar to support collapsible sections." }] } },
      },
      thinkingTokens(100, 100),
      // Agent is still running — new events will stream in via SSE
    ] satisfies AgentMsg[],
    running: true,
    goal: { id: "goal-3", text: "Make sidebar sections collapsible", label: "Collapsible Sidebar", mode: "code", status: "running" } as any,
    onClose: () => {},
  },
}
