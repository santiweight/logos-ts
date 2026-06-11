module Components.ValueOrDash exposing (valueOrDash)

{- | Helper to render a Maybe value or a dash if Nothing.
-}

import Html exposing (Html, span, text)
import Html.Attributes exposing (class)


valueOrDash : Maybe String -> Html msg
valueOrDash value =
    case value of
        Just str ->
            text str

        Nothing ->
            span [ class "muted-2" ] [ text "—" ]
