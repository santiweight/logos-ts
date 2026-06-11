module Components.JobRow exposing (viewJobRow)

{- | Job table row component.
   Mirrors /frontend/components/JobRow.tsx
-}

import Format exposing (formatCompanyName, formatSalary, hostLabel)
import Html exposing (Html, a, div, span, td, text, tr)
import Html.Attributes exposing (class, href, rel, target)
import Types exposing (Job, ParseConfidence(..))


{- | Render a single job row. The Job record must contain all fields
   needed for formatting (roles, tags, visa, intern, salary fields, etc.).
-}
viewJobRow : Job -> Html msg
viewJobRow job =
    let
        tags =
            job.tags

        salary =
            formatSalary job.salaryMin job.salaryMax job.salaryCurrency job.salaryPeriod

        company =
            formatCompanyName job.company

        websiteLabel =
            hostLabel job.websiteUrl

        companyLabel =
            Maybe.or company websiteLabel

        roleLines =
            if List.length job.roles > 0 then
                job.roles
            else
                case job.role of
                    Just r ->
                        [ r ]

                    Nothing ->
                        []

        hiringFacts =
            List.filterMap identity
                [ if job.visa then
                    Just "visa sponsorship"
                  else
                    Nothing
                , if job.intern then
                    Just "interns welcome"
                  else
                    Nothing
                ]
    in
    tr []
        [ -- Company cell
          td []
            [ case ( companyLabel, job.websiteUrl ) of
                ( Just label, Just url ) ->
                    a
                        [ href url
                        , target "_blank"
                        , rel "noopener noreferrer"
                        , class
                            (if company /= Nothing then
                                "conf-" ++ parseConfidenceToString job.parseConfidence
                             else
                                "muted-2"
                            )
                        ]
                        [ text label ]

                ( Just label, Nothing ) ->
                    span
                        [ class
                            (if company /= Nothing then
                                "conf-" ++ parseConfidenceToString job.parseConfidence
                             else
                                "muted-2"
                            )
                        ]
                        [ text label ]

                ( Nothing, _ ) ->
                    span [ class "muted-2" ] [ text "—" ]
            ]
        , -- Role cell
          td []
            [ if List.length roleLines > 0 then
                div [ class "line-list role-list" ]
                    (List.map (\role -> div [] [ text role ]) roleLines)
              else
                span [ class "muted-2" ] [ text "—" ]
            , if List.length hiringFacts > 0 then
                div [ class "row-facts" ]
                    (List.map (\fact -> span [] [ text fact ]) hiringFacts)
              else
                Html.text ""
            ]
        , -- Location cell
          td [ class "tag" ]
            [ case job.locationDisplay of
                Just loc ->
                    text loc

                Nothing ->
                    span [ class "muted-2" ] [ text "—" ]
            ]
        , -- Salary cell
          td [ class "num" ]
            [ case salary of
                Just sal ->
                    text sal

                Nothing ->
                    span [ class "muted-2" ] [ text "—" ]
            , if job.equity then
                span [ class "muted-2 small" ] [ text " +eq" ]
              else
                Html.text ""
            ]
        , -- Tags cell
          td [ class "tags" ]
            (List.take 4 tags |> List.map (\t -> span [ class "t" ] [ text t ]))
        , -- Apply cell
          td [ class "small" ]
            [ case ( job.applyUrl, job.applyEmail ) of
                ( Just url, _ ) ->
                    a [ href url, target "_blank", rel "noopener noreferrer" ]
                        [ text "apply ↗" ]

                ( Nothing, Just email ) ->
                    a [ href ("mailto:" ++ email) ]
                        [ text "email ↗" ]

                ( Nothing, Nothing ) ->
                    span [ class "muted-2" ] [ text "—" ]
            ]
        , -- Details cell
          td [ class "small" ]
            [ a [ href ("/job/" ++ String.fromInt job.id) ]
                [ text "details" ]
            ]
        ]


parseConfidenceToString : ParseConfidence -> String
parseConfidenceToString confidence =
    case confidence of
        Parsed ->
            "parsed"

        Partial ->
            "partial"

        RawOnly ->
            "raw-only"
