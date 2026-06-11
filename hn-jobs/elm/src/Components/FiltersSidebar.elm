module Components.FiltersSidebar exposing (Model, Msg, init, update, view)

{- | Filters sidebar component with collapsible toggle.
   Mirrors /components/FiltersSidebar.tsx

   On desktop the sidebar is always visible; on mobile it collapses
   behind a toggle button.
-}

import Html exposing (Html, aside, button, div, span, text)
import Html.Attributes exposing (aria-expanded, class)
import Html.Events exposing (onClick)


{- | Component model.
-}
type alias Model =
    { open : Bool
    }


{- | Component messages.
-}
type Msg
    = Toggle


{- | Initialize sidebar in closed state.
-}
init : Model
init =
    { open = False }


{- | Update sidebar state.
-}
update : Msg -> Model -> Model
update msg model =
    case msg of
        Toggle ->
            { model | open = not model.open }


{- | Render the sidebar with toggle button and collapsible content.

   Parameters:
   - activeCount: Number of active filters (displayed in button label)
   - content: Child HTML (search form and filter panels)
   - model: Current sidebar state
-}
view : Int -> Html msg -> Model -> Html Msg
view activeCount content model =
    aside [ class "filters-sidebar" ]
        [ button
            [ class "filters-toggle"
            , onClick Toggle
            , aria-expanded model.open
            ]
            [ if activeCount > 0 then
                span [ class "filters-active-dot" ] []
              else
                Html.text ""
            , text
                ("Filters"
                    ++ (if activeCount > 0 then
                            " (" ++ String.fromInt activeCount ++ ")"
                        else
                            ""
                       )
                    ++ " "
                    ++ (if model.open then
                            "▲"
                        else
                            "▼"
                       )
                )
            ]
        , div
            [ class
                ("filters-content"
                    ++ (if model.open then
                            " open"
                        else
                            ""
                       )
                )
            ]
            [ content ]
        ]
