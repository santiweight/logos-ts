module Components.JobTable exposing (viewJobTable)

{- | Job directory table component.
   Renders table with columns: Company, Role, Location, Salary, Tech, Apply, Details.
-}

import Components.JobRow exposing (viewJobRow)
import Html exposing (Html, table, tbody, td, text, th, thead, tr)
import Html.Attributes exposing (class, colSpan)
import Types exposing (Job)


{- | Render a table of jobs.

   Parameters:
   - jobs: List of Job records to display
-}
viewJobTable : List Job -> Html msg
viewJobTable jobs =
    table [ class "data" ]
        [ thead []
            [ tr []
                [ th [] [ text "Company" ]
                , th [] [ text "Role" ]
                , th [] [ text "Location" ]
                , th [] [ text "Salary" ]
                , th [] [ text "Tech" ]
                , th [] [ text "Apply" ]
                , th [] [ text "Details" ]
                ]
            ]
        , tbody []
            (if List.isEmpty jobs then
                [ tr []
                    [ td [ colSpan 7, class "muted", Html.Attributes.style "padding" "12px" ]
                        [ text "No postings match. Try clearing filters, or run an ingest if the database is empty (npm run ingest)." ]
                    ]
                ]
             else
                List.map viewJobRow jobs
            )
        ]
