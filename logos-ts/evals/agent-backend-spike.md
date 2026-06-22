# Agent Backend Spike, 2026-06-22

Goal: compare faster eval-agent execution paths for the current Logos eval harness.

## Harness Changes Tested

- Added selectable backends: `claude-cli`, `claude-cli-safe`, `claude-cli-bare`, `claude-sdk`, and `codex-cli`.
- Added `pnpm dlx @openai/codex` fallback when `codex` is not installed on `PATH`.
- Added `LOGOS_CODEX_MODEL` passthrough for `gpt-5.5` / `gpt-5.4-mini`.
- Added `--materializer memory`, which caches source fixture files in-process before writing each trial workspace.
- Excluded `.git` metadata from eval workspaces; copied gitfile pointers confused Codex sandbox permission handling.
- Fixed eval case discovery so it ignores generated `evals/cases/runs/**`.
- Added a legacy `frontend` check-cwd fallback for HN Jobs cases whose fixture now lives at repo root.

## Experiment Matrix

All commands were run from `logos-ts/` after installing `demos/hn-jobs/node_modules` once so eval workspaces can symlink dependencies.

| Case | Backend | Materializer | Model | Official result | Useful signal | Wall time |
| --- | --- | --- | --- | --- | --- | --- |
| `direct-apply-filter-arch` | `claude-cli` | `copy` | `sonnet` | `0/1` | behavior and regression passed; typecheck failed on pre-existing unrelated errors | 129.61s |
| `direct-apply-filter-arch` | `claude-cli-safe` | `memory` | `sonnet` | `0/1` | same as baseline | 127.79s |
| `direct-apply-filter-arch` | `claude-sdk` | `memory` | `sonnet` | `0/1` | same as baseline; SDK telemetry and prompt-cache reads visible | 183.92s |
| `direct-apply-filter-arch` | `codex-cli` | `memory` | `gpt-5.5` | `1/1` | passed by also fixing unrelated stale typecheck/test failures; broad scope | 178.87s |
| `direct-apply-filter-arch` | `codex-cli` | `memory` | `gpt-5.4-mini` | `0/1` | behavior and regression passed; narrower scope; typecheck still failed on pre-existing errors | 158.74s |
| `backend-fuzzy-search-arch-impl` | `claude-cli` | `copy` | `sonnet` | `1/1` | clean pass | 251.11s |
| `backend-fuzzy-search-arch-impl` | `claude-cli-safe` | `memory` | `sonnet` | `1/1` | clean pass | 248.12s |

Additional setup/probing:

- `rename-company-header --backend claude-cli-safe --materializer memory` edited the intended workspace in about 17s, but the UI oracle is stale and imports old `frontend`/`JobTable` paths.
- Initial `codex-cli` failed until the adapter learned to fall back through `pnpm dlx @openai/codex`.
- Before `.git` exclusion, Codex repeatedly warned about stale worktree gitdir pointers from the copied fixture.

## Findings

1. `claude-cli-safe` is viable but not materially faster in these runs.
   It passed the same useful checks as baseline. The measured improvement was only about 1-3 seconds on 2-4 minute evals.

2. The in-memory materializer works, but agent latency dominates.
   It removes repeated source-tree reads/copy filtering, but these evals spend nearly all time inside the agent passes and checks.

3. `claude-sdk` is viable and gives much better observability, but it was slower on the direct-apply eval.
   The SDK stream exposes session IDs, model usage, cache creation/read tokens, and costs. That is useful for future optimization, even though this trial was slower than CLI.

4. `codex-cli` is viable through `pnpm dlx @openai/codex`.
   `gpt-5.4-mini` was faster than `gpt-5.5` on the same case and stayed closer to scope, but still did not clear the official typecheck gate because that gate has pre-existing unrelated errors.

5. Raw `gpt-5.5` Codex improved the official pass rate on `direct-apply-filter-arch`, but by broadening scope.
   It fixed unrelated typecheck/test placeholder issues, which made the eval pass but is risky for product behavior. This should be treated as "higher eval score under current gate", not a clean backend win.

6. Several evals cannot currently answer backend-quality questions.
   UI evals such as `rename-company-header`, `bold-role-element`, `posted-date-column`, and `empty-state-message` still target an old `frontend` layout and old component/oracle imports.

## Conclusion

The evals are not globally better yet.

The harness is better because it can now run multiple backends and measure them, including Claude SDK and Codex CLI. The most promising path is `codex-cli` with `gpt-5.4-mini` for speed-sensitive trials, plus stricter prompts/check gates to prevent unrelated repairs. `claude-cli-safe` is a low-risk replacement candidate, but the measured latency gain was negligible. The memory materializer is correct but not enough by itself.

Before claiming improved eval quality, fix stale eval gates:

- Remove or isolate pre-existing project-wide typecheck failures from capability evals.
- Refresh UI oracles to the current HN Jobs app structure.
- Add changed-file or allowed-scope reporting so broad repairs do not masquerade as agent quality.
