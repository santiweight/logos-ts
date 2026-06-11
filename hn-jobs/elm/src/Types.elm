module Types exposing (..)


{- | Union type for apply method.
-}
type ApplyMethod
    = Link
    | Email
    | HnReply
    | Other


{- | Union type for salary period.
-}
type SalaryPeriod
    = Year
    | Hour
    | Month


{- | Union type for parse confidence level.
-}
type ParseConfidence
    = Parsed
    | Partial
    | RawOnly


{- | Union type for classification confidence.
-}
type ClassificationConfidence
    = High
    | Medium
    | Low
    | Unknown


{- | Union type for enrichment status.
-}
type EnrichmentStatus
    = Pending
    | Enriched
    | Missed
    | Skipped
    | Failed


{- | Union type for salary bucket.
-}
type SalaryBucket
    = Disclosed
    | Undisclosed


{- | Union type for job sort order.
-}
type JobSort
    = CompanySort
    | Newest
    | SalaryDesc


{- | Union type for apply filter.
-}
type ApplyFilter
    = LinkFilter
    | EmailFilter
    | HnReplyFilter
    | MissingFilter


{- | Parsed location with display text, list of places, and remote scope.
-}
type alias ParsedLocation =
    { display : Maybe String
    , places : List String
    , remoteScope : Maybe String
    }


{- | Parsed salary with text, min/max, currency, period, and equity flag.
-}
type alias ParsedSalary =
    { text : Maybe String
    , min : Maybe Int
    , max : Maybe Int
    , currency : Maybe String
    , period : Maybe SalaryPeriod
    , equity : Bool
    }


{- | Parsed apply method with method type, URL, and email.
-}
type alias ParsedApply =
    { method : ApplyMethod
    , url : Maybe String
    , email : Maybe String
    }


{- | Full parsed job record with company, roles, location, salary, apply info, tags, and confidence.
-}
type alias ParsedJob =
    { company : Maybe String
    , website : Maybe String
    , role : Maybe String
    , roles : List String
    , employmentType : Maybe String
    , remote : Bool
    , onsite : Bool
    , hybrid : Bool
    , visa : Bool
    , intern : Bool
    , location : ParsedLocation
    , salary : ParsedSalary
    , apply : ParsedApply
    , tags : List String
    , parseConfidence : ParseConfidence
    }


{- | Job taxonomy with role families, specialties, seniority, regions, salary bucket, version, and confidence.
-}
type alias JobTaxonomy =
    { roleFamilies : List String
    , roleSpecialties : List String
    , seniority : Maybe String
    , locationRegions : List String
    , salaryBucket : SalaryBucket
    , taxonomyVersion : String
    , classificationConfidence : ClassificationConfidence
    , needsReview : Bool
    , reviewReason : Maybe String
    }


{- | Hiring thread record with HN ID, title, month, job count, and ingest timestamp.
-}
type alias Thread =
    { id : Int
    , hnId : String
    , title : String
    , month : String
    , jobCount : Int
    , lastIngestedAt : Maybe String
    }


{- | Persisted job record with all fields for display and filtering.
-}
type alias Job =
    { id : Int
    , hnCommentId : String
    , threadId : Int
    , author : String
    , postedAt : String
    , hnUrl : String
    , rawHtml : String
    , rawText : String
    , company : Maybe String
    , websiteUrl : Maybe String
    , role : Maybe String
    , roles : List String
    , employmentType : Maybe String
    , locationDisplay : Maybe String
    , locations : List String
    , remote : Bool
    , onsite : Bool
    , hybrid : Bool
    , remoteScope : Maybe String
    , salaryText : Maybe String
    , salaryMin : Maybe Int
    , salaryMax : Maybe Int
    , salaryCurrency : Maybe String
    , salaryPeriod : Maybe String
    , equity : Bool
    , applyMethod : ApplyMethod
    , applyUrl : Maybe String
    , applyEmail : Maybe String
    , visa : Bool
    , intern : Bool
    , tags : List String
    , parseConfidence : ParseConfidence
    , roleFamilies : List String
    , roleSpecialties : List String
    , seniority : Maybe String
    , locationRegions : List String
    , salaryBucket : SalaryBucket
    , enrichmentStatus : EnrichmentStatus
    , hidden : Bool
    , hiddenReason : Maybe String
    }


{- | Job filters for directory queries.
-}
type alias JobFilters =
    { q : Maybe String
    , month : Maybe String
    , tag : Maybe String
    , family : Maybe String
    , seniority : Maybe String
    , region : Maybe String
    , salary : Maybe SalaryBucket
    , apply : Maybe ApplyFilter
    , remote : Bool
    , visa : Bool
    , intern : Bool
    , sort : JobSort
    }


{- | Filter item for display in filter panels.
-}
type alias FilterItem =
    { label : String
    , href : String
    , count : Maybe Int
    , active : Bool
    }


{- | Hiring thread info for display.
-}
type alias HiringThread =
    { hnId : String
    , title : String
    , month : Maybe String
    , postedAt : String
    }


{- | Raw comment from HN.
-}
type alias RawComment =
    { hnCommentId : String
    , author : String
    , postedAt : String
    , rawHtml : String
    , rawText : String
    }
