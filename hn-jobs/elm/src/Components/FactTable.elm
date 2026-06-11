module Components.FactTable exposing (viewFactTable, viewFactTableRow)

{- | Fact table component for job detail view.
   Renders two-column table with labels and values.
   Mirrors the structure from /app/job/[slug]/page.tsx
-}

import Html exposing (Html, span, table, tbody, td, text, th, tr)
import Html.Attributes exposing (class)


{- | Single fact table row with label and content.

   Parameters:
   - label: Left column label (e.g. "Company", "Salary")
   - content: Right column HTML content
-}
viewFactTableRow : String -> Html msg -> Html msg
viewFactTableRow label content =
    tr []
        [ th [] [ text label ]
        , td [] [ content ]
        ]


{- | Render a fact table wrapping a list of rows.

   Parameters:
   - rows: List of row HTML elements
-}
viewFactTable : List (Html msg) -> Html msg
viewFactTable rows =
    table [ class "fact-table" ]
        [ tbody [] rows ]


{- | Helper to render a text value or muted dash.
-}
valueOrMuted : Maybe String -> Html msg
valueOrMuted value =
    case value of
        Just str ->
            text str

        Nothing ->
            span [ class "muted-2" ] [ text "—" ]
