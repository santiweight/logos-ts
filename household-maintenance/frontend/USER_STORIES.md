# Household Maintenance User Stories

## Product Shape

The household maintenance demo is a compact operations queue for a home. It is not an editing tool; it focuses on scanning upcoming work, isolating risky tasks, and selecting one task for practical context.

This gives Logos a different app profile from a collection browser or finance dashboard: status-heavy operational data, due-date sorting, detail panels, empty states, and responsive queue layout.

## Usage Patterns

1. Daily scan: a user opens the app and checks total tasks, overdue count, critical count, and the first due task.
2. Risk triage: a user filters to `Overdue` or sorts by `Priority` to handle critical work first.
3. Zone planning: a user filters to `Basement`, `Kitchen`, or `Exterior` to batch work in one part of the home.
4. Vendor recall: a user searches by vendor or note, such as `plumbing` or `battery`, to find context quickly.
5. Empty recovery: a user searches for a task the home does not have and needs a clear empty state while controls remain usable.
6. Selection: a user selects an asset and expects owner, vendor, due date, status, and notes to update together.
7. Stable sort: due-date, priority, asset, and zone sorts should be deterministic.
8. Responsive review: a user or reviewer opens the app at phone width and expects no horizontal overflow.
9. Storybook review: Logos can inspect default, critical-backlog, zone-focused, and empty-search states.
10. Embedded review recovery: stale zone, status, or selected-task props should normalize to useful defaults.
11. Empty queue: an empty home fixture should explain that no tasks exist, not imply that filters are wrong.

## Test Mapping

- `maintenance.test.ts` covers filtering, sorting, summary, unique zone generation, and due-date labels.
- `MaintenanceView.test.tsx` covers user-level interactions, stale prop recovery, empty queues, and selection recovery against the React component.
- `maintenance.e2e.test.ts` starts the real Vite app and covers desktop, mobile, keyboard, selection recovery, and empty-state flows in Chromium.
- `MaintenanceView.stories.tsx` keeps stable Storybook states for Logos inspection, including empty and invalid embedded states.
