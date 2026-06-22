import React from "react"

type LinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href?: string | { pathname?: string }
  as?: unknown
  replace?: boolean
  scroll?: boolean
  shallow?: boolean
  passHref?: boolean
  prefetch?: boolean
  locale?: string | false
  legacyBehavior?: boolean
}

const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(function Link({ href, children, ...props }, ref) {
  const target = typeof href === "string" ? href : href?.pathname ?? "#"
  return <a {...props} ref={ref} href={target}>{children}</a>
})

export default Link
