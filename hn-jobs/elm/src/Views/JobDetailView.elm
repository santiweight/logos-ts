module Views.JobDetailView exposing (view)

{- | Job detail page view.
   Mirrors /app/job/[slug]/page.tsx
-}

import Components.FactTable exposing (viewFactTable, viewFactTableRow)
import Components.HeaderNav exposing (viewHeaderNav)
import Format exposing (formatCompanyName, formatSalary, hostLabel)
import Html exposing (Html, a, code, div, h2, li, p, span, text, ul)
import Html.Attributes exposing (class, href, rel, target)
import Types exposing (ApplyMethod(..), Job, ParseConfidence(..))


{- | Render the job detail page.

   Parameters:
   - currentPath: Current URL path
   - job: The full Job record to display
   - threadMonth: Month string for the thread (e.g. "2026-05")
-}
view : String -> Job -> String -> Html msg
view currentPath job threadMonth =
    let
        company =
            formatCompanyName job.company

        salary =
            formatSalary job.salaryMin job.salaryMax job.salaryCurrency job.salaryPeriod

        roleLines =
            if List.length job.roles > 0 then
                job.roles
            else
                case job.role of
                    Just r ->
                        [ r ]

                    Nothing ->
                        []
    in
    div []
        [ viewHeaderNav currentPath
        , p [ class "results-info" ]
            [ a [ href "/" ] [ text "← All postings" ]
            , text "  ·  "
            , a [ href ("/?month=" ++ threadMonth) ]
                [ text (formatMonth threadMonth ++ " thread") ]
            ]
        , h2 [ Html.Attributes.style "margin" "0 0 2px", Html.Attributes.style "fontSize" "18px" ]
            [ text (company |> Maybe.withDefault "Job posting")
            , if job.parseConfidence /= Parsed then
                span [ class "muted-2 small" ]
                    [ text
                        (" (auto-parsed"
                            ++ (if job.parseConfidence == RawOnly then
                                    " — see raw text"
                                else
                                    ""
                               )
                            ++ ")"
                        )
                    ]
              else
                Html.text ""
            ]
        , case job.role of
            Just r ->
                p [ class "muted", Html.Attributes.style "margin" "0 0 12px" ] [ text r ]

            Nothing ->
                Html.text ""
        , viewFactTable
            (List.concat
                [ case company of
                    Just c ->
                        [ viewFactTableRow "Company" (text c) ]

                    Nothing ->
                        []
                , case job.websiteUrl of
                    Just url ->
                        [ viewFactTableRow "Website"
                            (a [ href url, target "_blank", rel "noopener noreferrer" ]
                                [ text (hostLabel (Just url) |> Maybe.withDefault url)
                                , text " ↗"
                                ]
                            )
                        ]

                    Nothing ->
                        []
                , if List.length job.roles > 1 then
                    [ viewFactTableRow "Roles"
                        (ul [ Html.Attributes.style "margin" "0", Html.Attributes.style "paddingLeft" "16px" ]
                            (List.map (\r -> li [] [ text r ]) job.roles)
                        )
                    ]
                  else if job.role /= Nothing then
                    [ viewFactTableRow "Role" (text (job.role |> Maybe.withDefault "")) ]
                  else
                    []
                , case job.employmentType of
                    Just et ->
                        [ viewFactTableRow "Type" (text et) ]

                    Nothing ->
                        []
                , if List.length job.roleFamilies > 0 || job.seniority /= Nothing then
                    [ viewFactTableRow "Role taxonomy"
                        (div [ class "tags" ]
                            (List.concat
                                [ List.map (\f -> a [ href ("/?family=" ++ encodeURIComponent f), class "t" ] [ text f ])
                                    job.roleFamilies
                                , case job.seniority of
                                    Just s ->
                                        [ a [ href ("/?seniority=" ++ encodeURIComponent s), class "t" ] [ text s ] ]

                                    Nothing ->
                                        []
                                ]
                            )
                        )
                    ]
                  else
                    []
                , if List.length job.roleSpecialties > 0 then
                    [ viewFactTableRow "Specialties"
                        (text (String.join ", " job.roleSpecialties))
                    ]
                  else
                    []
                , [ viewFactTableRow "Location"
                    (div []
                        [ text (job.locationDisplay |> Maybe.withDefault "—")
                        , if job.hybrid && (job.locationDisplay |> Maybe.map (String.contains "hybrid") |> Maybe.withDefault False |> not) then
                            span [ class "pill hybrid" ] [ text "hybrid" ]
                          else
                            Html.text ""
                        ]
                    )
                  ]
                , [ viewFactTableRow "Salary"
                    (case salary of
                        Just sal ->
                            div []
                                [ span [ class "val" ] [ text sal ]
                                , if job.equity then
                                    span [ class "muted small" ] [ text " + equity" ]
                                  else
                                    Html.text ""
                                , case job.salaryText of
                                    Just st ->
                                        if st /= sal then
                                            span [ class "muted-2 small" ]
                                                [ text (" (\"" ++ st ++ "\")") ]
                                        else
                                            Html.text ""

                                    Nothing ->
                                        Html.text ""
                                ]

                        Nothing ->
                            if job.equity then
                                text "Equity mentioned"
                            else
                                span [ class "muted-2" ] [ text "—" ]
                    )
                  ]
                , [ viewFactTableRow "Apply via"
                    (div []
                        [ text (applyMethodLabel job.applyMethod)
                        , case job.applyUrl of
                            Just url ->
                                div []
                                    [ text " — "
                                    , a [ href url, target "_blank", rel "noopener noreferrer" ]
                                        [ text url ]
                                    ]

                            Nothing ->
                                Html.text ""
                        , case job.applyEmail of
                            Just email ->
                                div []
                                    [ text
                                        (if job.applyUrl /= Nothing then
                                            " · "
                                         else
                                            " — "
                                        )
                                    , a [ href ("mailto:" ++ email) ] [ text email ]
                                    ]

                            Nothing ->
                                Html.text ""
                        ]
                    )
                  ]
                , [ viewFactTableRow "Hiring notes"
                    (text
                        (let
                            notes =
                                List.concat
                                    [ if job.visa then
                                        [ "Sponsors visas. " ]
                                      else
                                        []
                                    , if job.intern then
                                        [ "Interns welcome. " ]
                                      else
                                        []
                                    ]
                         in
                         if List.isEmpty notes then
                            "—"
                         else
                            String.concat notes
                        )
                    )
                  ]
                , if List.length job.tags > 0 then
                    [ viewFactTableRow "Tech"
                        (div [ class "tags" ]
                            (List.map (\t -> a [ href ("/?tag=" ++ encodeURIComponent t), class "t" ] [ text t ])
                                job.tags
                            )
                        )
                    ]
                  else
                    []
                , if List.length job.locations > 0 then
                    [ viewFactTableRow "Parsed locations"
                        (text (String.join ", " job.locations))
                    ]
                  else
                    []
                , if List.length job.locationRegions > 0 then
                    [ viewFactTableRow "Regions"
                        (text (String.join ", " job.locationRegions))
                    ]
                  else
                    []
                , [ viewFactTableRow "Posted by" (text job.author) ]
                , [ viewFactTableRow "Posted" (text (formatDate job.postedAt)) ]
                , [ viewFactTableRow "Source"
                    (a [ href job.hnUrl, target "_blank", rel "noopener noreferrer" ]
                        [ text "View on Hacker News ↗" ]
                    )
                  ]
                ]
            )
        , h2 [ class "section" ] [ text "Original posting" ]
        , div [ class "raw-body" ] [ text job.rawText ]
        ]


{- | Convert ApplyMethod to display string.
-}
applyMethodLabel : ApplyMethod -> String
applyMethodLabel method =
    case method of
        Link ->
            "Application link"

        Email ->
            "Email"

        HnReply ->
            "Reply on Hacker News"

        Other ->
            "See posting"


{- | Format date string (stub: assumes ISO format, output as-is for now).
-}
formatDate : String -> String
formatDate dateStr =
    dateStr


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


{- | Simple URI component encoding.
-}
encodeURIComponent : String -> String
encodeURIComponent str =
    String.replace " " "%20" str
