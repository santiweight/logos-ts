# Vinyl Collection User Stories

## Product Shape

The vinyl collection app is a focused home-library browser. It helps a collector answer practical questions quickly: what is in the collection, where it lives, what should be played now, and which records match a mood, shelf, artist, or maintenance note.

The app should remain small and inspectable for Logos. The primary flows are browsing, narrowing, sorting, and selecting records rather than editing inventory.

## Usage Patterns

1. Crate browsing: a user opens the app, scans the full collection, and expects a default featured record plus collection stats.
2. Mood filtering: a user chooses a shelf such as `Evening` or `Essentials` to match the listening context and expects the visible count and selected detail panel to follow the filtered crate.
3. Artist or note search: a user remembers part of an artist, album, genre, or note, types a query, and expects only matching cards to remain.
4. Cross-filter search: a user combines query, genre, and shelf filters to find a specific pressing without unrelated records leaking into the result.
5. Empty search recovery: a user types a bad query and needs a clear empty state while the controls remain available.
6. Rating sort: a user wants the strongest records first and expects ties to be deterministic.
7. Recent sort: a user wants to see what has been played lately, with ISO date ordering matching the app copy.
8. Artist sort: a user alphabetizes the crate to locate a known artist.
9. Pressing age sort: a user sorts by year to compare newer and older pressings.
10. Selection: a user clicks a cover and expects the now-playing panel and selected state to update together.
11. Responsive inspection: a user or reviewer opens the app on phone width and expects controls, cards, and the now-playing panel to remain reachable without horizontal overflow.
12. Temporary filter hiding: a user selects a record, narrows the crate until that record is hidden, and expects the selection to reappear when the filter is cleared.
13. Empty fixture review: a demo author loads the view with no records and expects honest empty-copy rather than a misleading search failure.
14. Invalid embed props: a demo author passes a stale featured record, genre, or shelf and expects the app to fall back to usable controls.
15. Keyboard selection: a user tabs through covers and expects native button keyboard activation to update the now-playing panel.
16. Storybook review: Logos can load default, shelf-focused, search-focused, empty-result, empty-collection, and invalid-prop stories as stable review states.

## Test Mapping

- `collection.test.ts` covers pure helper behavior, deterministic sorting, empty collections, and filter option generation.
- `CollectionView.test.tsx` covers component-level user stories with React Testing Library, including stale props, empty data, and selection recovery after filters hide the chosen record.
- `collection.e2e.test.ts` runs Playwright against the Vite app for full browser flows, keyboard selection, responsive layout checks, and major interaction regressions.
- `CollectionView.stories.tsx` preserves stable Logos review states for default, shelf-focused, search-focused, empty-result, empty-collection, and invalid-prop scenarios.
