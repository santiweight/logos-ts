module Components.SearchableFilter exposing (Model, Msg, init, update, view, viewStatic)

{- | Searchable filter panel component.
   Mirrors /components/SearchableFilter.tsx

   This component manages its own search query state. The parent provides
   FilterItems (with label, href, count, active), and SearchableFilter
   handles in-list text filtering while delegating navigation to hrefs.

   Model-based variant (with search state):
   - init : returns initial model
   - update : handle search input changes
   - view : render with state

   Static variant (viewStatic) takes FilterItem list and renders without state,
   useful when parent handles all state.
-}

import Html exposing (Html, a, div, h3, input, li, span, text, ul)
import Html.Attributes exposing (class, placeholder, type_, value)
import Html.Events exposing (onInput)
import Types exposing (FilterItem)


{- | Component model containing the search query.
-}
type alias Model =
    { query : String
    }


{- | Component messages.
-}
type Msg
    = SetQuery String


{- | Initialize component with empty query.
-}
init : Model
init =
    { query = "" }


{- | Update component state.
-}
update : Msg -> Model -> Model
update msg model =
    case msg of
        SetQuery q ->
            { model | query = q }


{- | Render searchable filter with internal state management.

   Parameters:
   - title: Section title (e.g. "Role", "Tech")
   - items: List of FilterItem
   - searchable: Whether to show search box
   - clearHref: Optional href for "clear" button
   - model: Current component state
-}
view : String -> List FilterItem -> Bool -> Maybe String -> Model -> Html Msg
view title items searchable clearHref model =
    let
        q =
            model.query

        filtered =
            if String.isEmpty q then
                items
            else
                List.filter
                    (\item ->
                        String.contains
                            (String.toLower q)
                            (String.toLower item.label)
                    )
                    items

        anyActive =
            List.any .active items
    in
    div [ class "filter-group" ]
        [ h3 [] [ text title ]
        , if searchable then
            input
                [ type_ "text"
                , class "filter-search"
                , placeholder ("Filter " ++ String.toLower title ++ "…")
                , value q
                , onInput SetQuery
                ]
                []
          else
            Html.text ""
        , ul []
            (List.concat
                [ if anyActive && clearHref /= Nothing then
                    [ li [ class "clear" ]
                        [ a [ Html.Attributes.href (Maybe.withDefault "" clearHref) ]
                            [ text "clear" ]
                        ]
                    ]
                  else
                    []
                , List.map
                    (\item ->
                        li []
                            [ a
                                [ Html.Attributes.href item.href
                                , class (if item.active then "active" else "")
                                ]
                                [ text item.label
                                , case item.count of
                                    Just cnt ->
                                        span [ class "filter-count" ]
                                            [ text (String.fromInt cnt) ]

                                    Nothing ->
                                        Html.text ""
                                ]
                            ]
                    )
                    filtered
                , if List.isEmpty filtered then
                    [ li [ class "muted-2 small" ]
                        [ text "no matches" ]
                    ]
                  else
                    []
                ]
            )
        ]


{- | Render searchable filter without internal state.
   Use this when parent handles all filtering/state.
   Equivalent to setting searchable=False and no clear button.
-}
viewStatic : String -> List FilterItem -> Html msg
viewStatic title items =
    let
        anyActive =
            List.any .active items
    in
    div [ class "filter-group" ]
        [ h3 [] [ text title ]
        , ul []
            (List.map
                (\item ->
                    li []
                        [ a
                            [ Html.Attributes.href item.href
                            , class (if item.active then "active" else "")
                            ]
                            [ text item.label
                            , case item.count of
                                Just cnt ->
                                    span [ class "filter-count" ]
                                        [ text (String.fromInt cnt) ]

                                Nothing ->
                                    Html.text ""
                            ]
                        ]
                )
                items
            )
        ]
