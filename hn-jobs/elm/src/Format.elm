module Format exposing (formatCompanyName, hostLabel, formatSalary)

{- | Pure presentation formatters for job display.
   Mirrors /frontend/format.ts
-}

import Url


{- | Format company name by trimming whitespace.
   Returns Nothing if null or empty after trimming.
-}
formatCompanyName : Maybe String -> Maybe String
formatCompanyName company =
    company
        |> Maybe.map String.trim
        |> Maybe.andThen (\s -> if String.isEmpty s then Nothing else Just s)


{- | Extract hostname from a URL, removing www. prefix.
   Returns Nothing if URL is null or invalid.
-}
hostLabel : Maybe String -> Maybe String
hostLabel url =
    case url of
        Nothing ->
            Nothing

        Just urlString ->
            case Url.fromString urlString of
                Just parsed ->
                    parsed.host
                        |> String.dropLeft 4
                        |> \host ->
                            if String.startsWith "www." host then
                                String.dropLeft 4 host
                            else
                                host
                        |> Just

                Nothing ->
                    Nothing


{- | Format salary range with symbol, abbreviated thousands, and period suffix.
   Returns Nothing if both min and max are Nothing.

   Examples:
   - formatSalary (Just 100000) (Just 150000) (Just "USD") (Just "year")
     -> Just "$100k–150k"
   - formatSalary (Just 50) Nothing (Just "USD") (Just "hour")
     -> Just "$50/hr"
-}
formatSalary : Maybe Int -> Maybe Int -> Maybe String -> Maybe String -> Maybe String
formatSalary min max currency period =
    if min == Nothing && max == Nothing then
        Nothing

    else
        let
            sym =
                case currency of
                    Just "USD" ->
                        "$"

                    Just curr ->
                        curr ++ " "

                    Nothing ->
                        "$"

            k n =
                if modBy 1000 n == 0 then
                    String.fromInt (n // 1000) ++ "k"
                else
                    String.fromInt n

            range =
                case ( min, max ) of
                    ( Just minVal, Just maxVal ) ->
                        k minVal ++ "–" ++ k maxVal

                    ( Just minVal, Nothing ) ->
                        k minVal

                    ( Nothing, Just maxVal ) ->
                        k maxVal

                    ( Nothing, Nothing ) ->
                        ""

            suffix =
                case period of
                    Just "hour" ->
                        "/hr"

                    Just "month" ->
                        "/mo"

                    _ ->
                        ""
        in
        Just (sym ++ range ++ suffix)
