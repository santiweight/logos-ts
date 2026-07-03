import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { Markdown } from "./Markdown"

afterEach(cleanup)

describe("Markdown", () => {
  it("renders plain text as a paragraph", () => {
    render(<Markdown>Hello, world!</Markdown>)
    expect(screen.getByText("Hello, world!")).toBeTruthy()
    expect(screen.getByText("Hello, world!").tagName).toBe("P")
  })

  it("renders bold text with a <strong> tag", () => {
    render(<Markdown>This is **bold** text</Markdown>)
    const strongElement = screen.getByText("bold")
    expect(strongElement.tagName).toBe("STRONG")
  })

  it("renders italic text with an <em> tag", () => {
    render(<Markdown>This is *italic* text</Markdown>)
    const emElement = screen.getByText("italic")
    expect(emElement.tagName).toBe("EM")
  })

  it("renders inline code with a <code> tag", () => {
    render(<Markdown>Use `const x = 1` in your code</Markdown>)
    const codeElement = screen.getByText("const x = 1")
    expect(codeElement.tagName).toBe("CODE")
  })

  it("renders a markdown list as <ul>/<li> elements", () => {
    const listMarkdown = `- Item one
- Item two
- Item three`
    render(<Markdown>{listMarkdown}</Markdown>)
    const listElement = screen.getByRole("list")
    expect(listElement.tagName).toBe("UL")
    const items = screen.getAllByRole("listitem")
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent("Item one")
    expect(items[1]).toHaveTextContent("Item two")
    expect(items[2]).toHaveTextContent("Item three")
  })

  it("renders a fenced code block inside a <pre> element", () => {
    const codeBlockMarkdown = "```javascript\nconst x = 42;\nconsole.log(x);\n```"
    render(<Markdown>{codeBlockMarkdown}</Markdown>)
    const codeElement = screen.getByText(/const x = 42/)
    expect(codeElement.closest("pre")).not.toBeNull()
  })

  it("renders markdown links as <a> tags", () => {
    render(<Markdown>Check out [this link](https://example.com)</Markdown>)
    const linkElement = screen.getByRole("link", { name: "this link" })
    expect(linkElement.tagName).toBe("A")
    expect(linkElement).toHaveAttribute("href", "https://example.com")
  })

  it("wraps output in a div with className md-body", () => {
    const { container } = render(<Markdown>Some content</Markdown>)
    const wrapperDiv = container.querySelector(".md-body")
    expect(wrapperDiv).toBeTruthy()
    expect(wrapperDiv?.tagName).toBe("DIV")
  })
})
