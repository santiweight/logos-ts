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
