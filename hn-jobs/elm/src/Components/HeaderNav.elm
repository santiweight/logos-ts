module Components.HeaderNav exposing (viewHeaderNav)

{- | Top navigation component.
   Mirrors /components/HeaderNav.tsx
-}

import Html exposing (Html, a, nav, text)
import Html.Attributes exposing (class, href)


{- | Render the top navigation bar with links to Jobs and Threads.

   Parameters:
   - currentPath: Current path (e.g. "/", "/threads", "/job/123")
               Used to determine which nav item is "active"
-}
viewHeaderNav : String -> Html msg
viewHeaderNav currentPath =
    let
        isActive path =
            if path == "/" then
                currentPath == "/" || String.startsWith "/job/" currentPath
            else
                currentPath == path || String.startsWith (path ++ "/") currentPath
    in
    nav []
        [ a
            [ href "/"
            , class (if isActive "/" then "active" else "")
            ]
            [ text "Jobs" ]
        , a
            [ href "/threads"
            , class (if isActive "/threads" then "active" else "")
            ]
            [ text "Threads" ]
        ]
