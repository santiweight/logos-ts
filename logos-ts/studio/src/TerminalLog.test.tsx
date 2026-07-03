import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { TerminalLog } from "./TerminalLog"

afterEach(cleanup)

describe("TerminalLog", () => {
  it("renders ANSI truecolor spans through ansi-to-react", () => {
    const { container } = render(
      <pre>
        <TerminalLog lines={["before \u001b[38;2;255;71;133mpink\u001b[39m after"]} />
      </pre>
    )

    expect(container.textContent).toBe("before pink after")
    expect(screen.getByText("pink")).toHaveStyle({ color: "rgb(255, 71, 133)" })
  })

  it("linkifies visible URLs in terminal output", () => {
    const { container } = render(
      <pre>
        <TerminalLog
          lines={[
            "Telemetry: \u001b]8;;https://storybook.js.org/telemetry\u0007https://storybook.js.org/telemetry\u001b]8;;\u0007",
          ]}
        />
      </pre>
    )

    expect(container.textContent).toBe("Telemetry: https://storybook.js.org/telemetry")
    expect(screen.getByRole("link", { name: "https://storybook.js.org/telemetry" })).toHaveAttribute(
      "href",
      "https://storybook.js.org/telemetry"
    )
  })
})
