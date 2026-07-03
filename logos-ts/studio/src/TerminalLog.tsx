import Ansi from "ansi-to-react"

export function TerminalLog({ lines }: { lines: string[] }) {
  return (
    <Ansi className="terminal-log-code" linkify>
      {stripOsc8(lines.join("\n"))}
    </Ansi>
  )
}

function stripOsc8(input: string): string {
  return input.replace(/\u001b]8;[^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "")
}
