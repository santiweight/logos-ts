module Views.DirectoryView exposing (view)

{- | Directory page view showing jobs with filters.
   Mirrors /app/page.tsx
-}

import Components.FiltersSidebar as FiltersSidebar
import Components.HeaderNav exposing (viewHeaderNav)
import Components.JobTable exposing (viewJobTable)
import Components.SearchableFilter exposing (viewStatic)
import Html exposing (Html, div, form, input, main_, text)
import Html.Attributes exposing (action, class, defaultValue, method, name, placeholder, type_)
import Types exposing (FilterItem, Job, JobFilters)


{- | Directory view model.
   Stores the sidebar toggle state and search filter states if needed.
-}
type alias Model =
    { sidebarOpen : Bool
    }


{- | Directory view messages.
-}
type Msg
    = SidebarMsg FiltersSidebar.Msg


{- | Initialize directory view.
-}
init : Model
init =
    { sidebarOpen = False }


{- | Update directory view state.
-}
update : Msg -> Model -> Model
update msg model =
    case msg of
        SidebarMsg sidebarMsg ->
            let
                newSidebar =
                    FiltersSidebar.update sidebarMsg FiltersSidebar.init
            in
            { model | sidebarOpen = newSidebar.open }


{- | Render the directory page.

   Parameters:
   - currentPath: Current URL path
   - filters: Active filters
   - jobs: Filtered jobs to display
   - monthItems: Filter items for month selector
   - tagItems: Filter items for tech tags
   - familyItems: Filter items for role families
   - seniorityItems: Filter items for seniority levels
   - regionItems: Filter items for regions
   - applyItems: Filter items for apply methods
   - flagItems: Filter items for binary flags (remote, visa, intern)
   - salaryItems: Filter items for salary disclosure
   - sortItems: Filter items for sort order
   - activeCount: Number of active filters
   - model: Current view state
-}
view :
    String
    -> JobFilters
    -> List Job
    -> List FilterItem
    -> List FilterItem
    -> List FilterItem
    -> List FilterItem
    -> List FilterItem
    -> List FilterItem
    -> List FilterItem
    -> List FilterItem
    -> List FilterItem
    -> Int
    -> Model
    -> Html Msg
view currentPath filters jobs monthItems tagItems familyItems seniorityItems regionItems applyItems flagItems salaryItems sortItems activeCount model =
    let
        sidebarModel =
            FiltersSidebar.init
    in
    div [ class "layout" ]
        [ Html.map SidebarMsg
            (FiltersSidebar.view activeCount
                (renderSearchForm filters)
                { sidebarModel | open = model.sidebarOpen }
            )
        , main_ []
            [ viewJobTable jobs ]
        , viewHeaderNav currentPath
        , div []
            [ viewStatic "Sort" sortItems
            , viewStatic "Filters" flagItems
            , viewStatic "Role" familyItems
            , viewStatic "Seniority" seniorityItems
            , viewStatic "Region" regionItems
            , viewStatic "Apply" applyItems
            , viewStatic "Comp" salaryItems
            , viewStatic "Tech" tagItems
            , viewStatic "Month" monthItems
            ]
        ]


{- | Render the search form with hidden inputs for active filters.
-}
renderSearchForm : JobFilters -> Html msg
renderSearchForm filters =
    form [ action "/", method "get", class "search-form" ]
        (List.concat
            [ case filters.month of
                Just m ->
                    [ input [ type_ "hidden", name "month", Html.Attributes.value m ] [] ]

                Nothing ->
                    []
            , case filters.tag of
                Just t ->
                    [ input [ type_ "hidden", name "tag", Html.Attributes.value t ] [] ]

                Nothing ->
                    []
            , case filters.family of
                Just f ->
                    [ input [ type_ "hidden", name "family", Html.Attributes.value f ] [] ]

                Nothing ->
                    []
            , case filters.seniority of
                Just s ->
                    [ input [ type_ "hidden", name "seniority", Html.Attributes.value s ] [] ]

                Nothing ->
                    []
            , case filters.salary of
                Just _ ->
                    [ input [ type_ "hidden", name "salary", Html.Attributes.value "disclosed" ] [] ]

                Nothing ->
                    []
            , case filters.region of
                Just r ->
                    [ input [ type_ "hidden", name "region", Html.Attributes.value r ] [] ]

                Nothing ->
                    []
            , case filters.apply of
                Just a ->
                    [ input [ type_ "hidden", name "apply", Html.Attributes.value (applyFilterToString a) ] [] ]

                Nothing ->
                    []
            , if filters.sort /= Types.CompanySort then
                [ input [ type_ "hidden", name "sort", Html.Attributes.value (sortToString filters.sort) ] [] ]
              else
                []
            , if filters.remote then
                [ input [ type_ "hidden", name "remote", Html.Attributes.value "1" ] [] ]
              else
                []
            , if filters.visa then
                [ input [ type_ "hidden", name "visa", Html.Attributes.value "1" ] [] ]
              else
                []
            , if filters.intern then
                [ input [ type_ "hidden", name "intern", Html.Attributes.value "1" ] [] ]
              else
                []
            , [ input
                    [ class "searchbox"
                    , type_ "text"
                    , name "q"
                    , placeholder "Search postings…"
                    , defaultValue (Maybe.withDefault "" filters.q)
                    ]
                    []
              ]
            ]
        )


applyFilterToString : Types.ApplyFilter -> String
applyFilterToString af =
    case af of
        Types.LinkFilter ->
            "link"

        Types.EmailFilter ->
            "email"

        Types.HnReplyFilter ->
            "hn-reply"

        Types.MissingFilter ->
            "missing"


sortToString : Types.JobSort -> String
sortToString sort =
    case sort of
        Types.CompanySort ->
            "company"

        Types.Newest ->
            "newest"

        Types.SalaryDesc ->
            "salary-desc"
