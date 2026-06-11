import type { FC } from "react"

interface HeaderNavProps {
  pathname: string
}

export const HeaderNav: FC<HeaderNavProps> = ({ pathname }) => {
  function active(path: string): boolean {
    if (path === "/") return pathname === "/" || pathname.startsWith("/job/")
    return pathname === path || pathname.startsWith(path + "/")
  }

  return (
    <nav>
      <a href="/" className={active("/") ? "active" : ""}>Jobs</a>
      <a href="/threads" className={active("/threads") ? "active" : ""}>Threads</a>
    </nav>
  )
}
