# Investment Portfolio User Stories

This demo models a focused read-only portfolio review workflow. It does not add transactions, market feeds, account linking, or advice features.

## Primary Users

- Self-directed investor reviewing allocation, gains, and cash before rebalancing.
- Advisor or household CFO scanning concentrated positions and explaining current exposure.
- Returning user on mobile checking a specific ticker or broad asset class.

## Usage Patterns

1. Portfolio overview
   - Open the dashboard.
   - Confirm total value, daily change, total gain, and cash.
   - Compare allocation rows against the holdings table.
   - Covered by `views/PortfolioView.test.tsx` and `portfolio.e2e.test.ts`.

2. Search a known holding
   - Search by ticker, company/fund name, asset class, or note text.
   - Review the reduced table and selected holding details.
   - Covered by React user tests and Playwright search tests.

3. Filter for a sleeve
   - Choose an asset class such as `Stock`, `ETF`, `Bond`, `Cash`, or `Crypto`.
   - Sort that subset by value, gain, weight, or symbol.
   - Confirm the holding count and selected detail stay coherent.
   - Covered by React and Playwright filter/sort tests.

4. Inspect a holding
   - Select a row with mouse or keyboard.
   - Confirm value, price, average cost, gain/loss, and notes update.
   - Covered by React keyboard tests and Playwright selection tests.

5. Empty or edge data
   - Search for a string with no matches.
   - Confirm an empty table message appears and the detail panel does not show stale data.
   - Render with no holdings to confirm zero-value summaries and empty allocation state.
   - Covered by React and Playwright empty-state tests.

6. Responsive review
   - Use the app on a narrow viewport.
   - Confirm controls remain usable, summary cards wrap, and the wide table scrolls inside its panel.
   - Covered by Playwright mobile viewport tests.

7. Embedded review recovery
   - Render with stale asset-class or selected-holding props from an old story fixture.
   - Normalize filters to `All` and show a real selected holding rather than an empty table caused by invalid props.
   - Covered by React user tests and Storybook `InvalidEmbeddedState`.
