import type { Meta, StoryObj } from "@storybook/react-vite"
import { Line } from "./AgentPanel"
import type { AgentMsg } from "./AgentPanel"

const meta: Meta<typeof Line> = {
  title: "studio/Line",
  component: Line,
  args: { prevIsThinking: false },
}
export default meta

type Story = StoryObj<typeof Line>

// Status message (e.g. "reading project context…")
export const Status: Story = {
  args: {
    m: { type: "status", message: "reading project context…" } satisfies AgentMsg,
  },
}

// Queued message
export const Queued: Story = {
  args: {
    m: { type: "queued", message: "goal queued — waiting for running agent to finish" } satisfies AgentMsg,
  },
}

// Stderr output
export const Stderr: Story = {
  args: {
    m: { type: "stderr", message: "Warning: cannot resolve module './utils'" } satisfies AgentMsg,
  },
}

// Error message
export const ErrorMsg: Story = {
  name: "Error",
  args: {
    m: { type: "error", message: "agent process exited with code 1" } satisfies AgentMsg,
  },
}

// Done / finished line (no exit code)
export const Done: Story = {
  args: {
    m: { type: "done" } satisfies AgentMsg,
  },
}

// Done with non-zero exit code
export const DoneWithExitCode: Story = {
  args: {
    m: { type: "done", code: 1 } satisfies AgentMsg,
  },
}

// Raw line output
export const Raw: Story = {
  args: {
    m: { type: "raw", line: "  → compiled 12 files in 340 ms" } satisfies AgentMsg,
  },
}

// System init event
export const SystemInit: Story = {
  args: {
    m: { type: "event", event: { type: "system", subtype: "init", model: "claude-sonnet-4-20250514" } } satisfies AgentMsg,
  },
}

// Thinking indicator — first thinking_tokens event (prevIsThinking=false)
export const ThinkingStart: Story = {
  args: {
    m: { type: "event", event: { type: "system", subtype: "thinking_tokens", estimated_tokens: 21, estimated_tokens_delta: 21 } } satisfies AgentMsg,
    prevIsThinking: false,
  },
}

// Subsequent thinking_tokens events should render nothing (prevIsThinking=true)
export const ThinkingContinued: Story = {
  args: {
    m: { type: "event", event: { type: "system", subtype: "thinking_tokens", estimated_tokens: 200, estimated_tokens_delta: 100 } } satisfies AgentMsg,
    prevIsThinking: true,
  },
}

// Compacting context status
export const CompactingContext: Story = {
  args: {
    m: { type: "event", event: { type: "system", subtype: "status", status: "compacting" } } satisfies AgentMsg,
  },
}

// Assistant text block
export const AssistantText: Story = {
  args: {
    m: {
      type: "event",
      event: {
        type: "assistant",
        message: {
          content: [{ type: "text", text: "I'll refactor the helper to handle arrow functions assigned to const." }],
        },
      },
    } satisfies AgentMsg,
  },
}

// Assistant text block — long content
export const AssistantTextLong: Story = {
  args: {
    m: {
      type: "event",
      event: {
        type: "assistant",
        message: {
          content: [
            {
              type: "text",
              text: "Looking at the current implementation, I can see that the extractFunctions helper only handles regular function declarations but misses arrow functions assigned to const variables. I'll update it to cover both cases by checking for VariableStatement nodes whose initializer is an ArrowFunction.",
            },
          ],
        },
      },
    } satisfies AgentMsg,
  },
}

// Tool-use with file_path input
export const ToolUseRead: Story = {
  args: {
    m: {
      type: "event",
      event: {
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "studio/src/App.tsx" } }] },
      },
    } satisfies AgentMsg,
  },
}

// Tool-use with command input
export const ToolUseBash: Story = {
  args: {
    m: {
      type: "event",
      event: {
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Bash", input: { command: "pnpm tsc --noEmit" } }] },
      },
    } satisfies AgentMsg,
  },
}

// Tool-use with prompt input
export const ToolUsePrompt: Story = {
  args: {
    m: {
      type: "event",
      event: {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "mcp__test-runner__test_results", input: { prompt: "wait for tests" } }],
        },
      },
    } satisfies AgentMsg,
  },
}

// Result event with cost
export const Result: Story = {
  args: {
    m: { type: "event", event: { type: "result", total_cost_usd: 0.042 } } satisfies AgentMsg,
  },
}

// Result event without cost
export const ResultNoCost: Story = {
  args: {
    m: { type: "event", event: { type: "result" } } satisfies AgentMsg,
  },
}

// Unknown / unhandled event type — renders nothing
export const UnknownEvent: Story = {
  args: {
    m: { type: "event", event: { type: "user", message: { role: "user", content: [] } } } satisfies AgentMsg,
  },
}

// Multiple content blocks in one assistant message
export const AssistantMixedBlocks: Story = {
  args: {
    m: {
      type: "event",
      event: {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Let me read the file first." },
            { type: "tool_use", name: "Read", input: { file_path: "src/architecture.ts" } },
          ],
        },
      },
    } satisfies AgentMsg,
  },
}
