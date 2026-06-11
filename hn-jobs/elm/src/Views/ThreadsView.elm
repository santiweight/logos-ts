module Views.ThreadsView exposing (view)

{- | Threads listing page view.
   Mirrors /app/threads/page.tsx
-}

import Components.HeaderNav exposing (viewHeaderNav)
import Html exposing (Html, a, code, div, p, text)
import Html.Attributes exposing (class, href, rel, target)
import Types exposing (Thread)


{- | Render the threads listing page.

   Parameters:
   - currentPath: Current URL path
   - threads: List of Thread records to display
-}
view : String -> List Thread -> Html msg
view currentPath threads =
    div []
        [ viewHeaderNav currentPath
        , p [ class "results-info" ]
            [ text
                (String.fromInt (List.length threads)
                    ++ " monthly thread"
                    ++ (if List.length threads == 1 then
                            ""
                        else
                            "s"
                       )
                    ++ " indexed."
                )
            ]
        , if List.isEmpty threads then
            p [ class "muted" ]
                [ text "No threads yet. Run "
                , code [] [ text "npm run ingest" ]
                , text " to pull the latest \"Who is hiring?\" thread from Hacker News."
                ]
          else
            Html.text ""
        , div []
            (List.map viewThreadItem threads)
        ]


{- | Render a single thread item in the feed.
-}
viewThreadItem : Thread -> Html msg
viewThreadItem thread =
    div [ class "feed-item" ]
        [ div [ class "feed-title" ]
            [ a [ href ("/?month=" ++ thread.month) ]
                [ text (formatMonth thread.month) ]
            , text (" · " ++ String.fromInt thread.jobCount ++ " postings")
            ]
        , div [ class "feed-meta" ]
            [ text thread.title
            , text (" · posted " ++ formatDate (thread.lastIngestedAt |> Maybe.withDefault thread.month))
            , text " · "
            , a
                [ href ("https://news.ycombinator.com/item?id=" ++ thread.hnId)
                , target "_blank"
                , rel "noopener noreferrer"
                ]
                [ text "HN thread ↗" ]
            ]
        ]


{- | Format month string as human-readable (e.g. "2026-05" → "May 2026").
-}
formatMonth : String -> String
formatMonth monthStr =
    case String.split "-" monthStr of
        [ year, month ] ->
            let
                monthName =
                    case month of
                        "01" ->
                            "January"

                        "02" ->
                            "February"

                        "03" ->
                            "March"

                        "04" ->
                            "April"

                        "05" ->
                            "May"

                        "06" ->
                            "June"

                        "07" ->
                            "July"

                        "08" ->
                            "August"

                        "09" ->
                            "September"

                        "10" ->
                            "October"

                        "11" ->
                            "November"

                        "12" ->
                            "December"

                        _ ->
                            month
            in
            monthName ++ " " ++ year

        _ ->
            monthStr


{- | Format date string (stub: returns as-is for now).
-}
formatDate : String -> String
formatDate dateStr =
    dateStr
