import * as userPreviewModule from "./preview.logos-user"
import { withLogosComments } from "./.logos/CommentLayer"

const userDefault = (userPreviewModule as any).default ?? {}
const userDecorators = [
  ...((userPreviewModule as any).decorators ?? []),
  ...(userDefault.decorators ?? []),
]

const preview = {
  ...userPreviewModule,
  ...userDefault,
  decorators: [...userDecorators, withLogosComments],
}

export default preview
