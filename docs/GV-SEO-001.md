# GV-SEO-001 | GlobeVoy technical SEO audit

Production checked November 27, 2026, Toronto time. GitHub main was `7cce4c8`, the merge of PR #203. Search Console’s supplied baseline was 43 known URLs, with 15 indexed and 28 excluded. The report identified 27 of the 28 exclusions by name.

## Before and after

| Check | Live production before | Reviewed branch artifact |
| --- | --- | --- |
| Preferred homepage | The apex `/` and `/index.html` both returned 200 with identical HTML and no canonical. | Both return 200 with the absolute canonical `https://globevoy.com/`. The sitemap lists the root only. |
| Public information | Root About, How It Works and Trust returned 200 with distinct HTML copy, no canonical, and no meta description. The nested paths were client redirects with `noindex`. | The three root pages have unique titles and descriptions, self-canonicals, Open Graph and X card metadata. Their nested aliases point to the corresponding root canonical and retain the same client redirects. |
| Private and temporary pages | Root sign-in, account, profile, results and booking pages and the React export generally lacked explicit robots directives. | All non-public classic entry pages and the React export emit `noindex` in HTML. The auth callback already has `noindex,nofollow`. The built HTML preserves that directive. |
| Crawl files | `/robots.txt` and `/sitemap.xml` returned 404 with the home HTML as the error response. | Both returned 200 over local HTTP. The XML parsed with the Sitemap protocol namespace and contains four crawlable 200 URLs with matching canonicals. Robots permits fetches so crawlers can see the exclusions. |
| Social and structured data | Homepage lacked social metadata and a site-name entity. | Public pages share an existing 1280×720 Lisbon preview with descriptive alt text. Only the homepage has `WebSite` JSON-LD containing the brand name and URL. |
| Hosting | HTTPS apex is served through CloudFront and S3. HTTP upgrades with 301. HTTPS www forwards with 302 and keeps the query string. Missing legacy HTML can receive a 301 to a slash URL before the terminal 404. | CloudFront behavior requires a separate hosting review. The production package and composite build carry the SEO metadata without changing the hosting configuration. |

### Search Console URL dispositions

Relative paths use `https://globevoy.com`. **Index** means eligible for consideration. **Redirect** includes existing HTML redirects and the existing HTTP redirects. **Canonical duplicate** stays a functional 200 and consolidates on the listed preferred URL.

| Search Console group | Reported URL | Live HTTP and behavior | Disposition in this change |
| --- | --- | --- | --- |
| Duplicate | `/` | 200, same HTML as `/index.html` | **Index** at the apex root |
| Duplicate | `/index.html` | 200, no canonical | **Canonical duplicate** of `/` |
| Duplicate | `/affiliate.html` | 200, draft disclosure | **Noindex** pending legal and commercial review |
| Duplicate | `/pages/affiliate.html` | 200, client redirect to `/affiliate.html` | **Redirect** to a noindex draft |
| Duplicate | `/pages/terms.html` | 200, client redirect to `/terms.html` | **Redirect** to a noindex draft |
| Duplicate | `/react/account/` | 200, account shell | **Noindex** |
| Duplicate | `/create-account.html?return=index.html` | 200, browser-local profile form | **Noindex** with return query preserved |
| Duplicate | `https://www.globevoy.com/pages/affiliate.html` | 302 to apex, then client redirect | **Redirect** |
| Duplicate | `https://www.globevoy.com/about.html` | 302 to apex, then 200 | **Redirect** to indexable About |
| Duplicate | `https://www.globevoy.com/pages/privacy.html` | 302 to apex, then client redirect | **Redirect** to a noindex draft |
| Duplicate | URL absent from the supplied screenshot | URL unavailable | **Unclassified** until the URL is identified |
| Excluded by noindex | `/pages/privacy.html` | 200, client redirect to `/privacy.html` | **Redirect** to a noindex draft |
| Excluded by noindex | `/pages/sign-in.html` | 200, client redirect to `/sign-in.html` | **Redirect** to a noindex sign-in page |
| Excluded by noindex | `http://www.globevoy.com/pages/sign-in.html` | HTTP 301, HTTPS www 302, then client redirect | **Redirect** to a noindex sign-in page |
| Excluded by noindex | `/pages/about.html` | 200, client redirect to `/about.html` | **Redirect** with an absolute canonical to the indexable About page |
| Excluded by noindex | `/pages/how-it-works.html` | 200, client redirect to `/how-it-works.html` | **Redirect** with an absolute canonical to the indexable How It Works page |
| Excluded by noindex | `/pages/create-account.html` | 200, client redirect to `/create-account.html` | **Redirect** to a noindex local profile form |
| Excluded by noindex | `/pages/trust.html` | 200, client redirect to `/trust.html` | **Redirect** with an absolute canonical to the indexable Trust page |
| Page with redirect | `http://www.globevoy.com/` | 301 to HTTPS www, then 302 to apex | **Redirect** as verified |
| Page with redirect | `https://www.globevoy.com/index.html` | 302 to apex `/index.html`, then 200 | **Redirect** to a URL that canonicalizes to the root |
| Page with redirect | `http://globevoy.com/` | 301 to HTTPS apex | **Redirect** as verified |
| Soft 404 | `/multi-city.html` | 200 with noindex. Budget searches go to results. Other requests go home. | **Noindex compatibility redirect**. HTTP soft-404 cleanup deferred. |
| Soft 404 | `/multicity-visualizer.html` | 200 with noindex and the same conditional client routing | **Noindex compatibility redirect**. HTTP soft-404 cleanup deferred. |
| Crawled, currently not indexed | `/pages/saved-trips.html` | 200, client redirect to `/react/my-trips/` | **Redirect** to private noindex route |
| Crawled, currently not indexed | `/pages/stays.html` | 200, client redirect to `/stays.html` | **Redirect** to a noindex compatibility page |
| Crawled, currently not indexed | `/stays.html` | 200, design reference still targeted by classic trip details | **Noindex**. Retain the existing trip link. |
| Crawled, currently not indexed | `/pages/multi-city-results.html` | 301 to `/pages/multi-city-results/`, then HTTP 404 | **404**. Historical screen removed in GV-WEB-2. |
| Crawled, currently not indexed | `/explore.html?origin=Paris&budget=1500&currency=EUR` | 200 with noindex. Client redirects to `/results.html` with the query. | **Noindex compatibility redirect** to temporary noindex results |

The route history records 31 archived design and state screens and 36 shipped compatibility aliases. Commit `a502391` removed three former legacy screens and replaced five search entry pages with compatibility routing. Current booking and saved-trip code still uses the results, itinerary and visualizer paths. The current site also still publishes a classic stays reference targeted by `trip-live.js`. These dependencies justify keeping the routes reachable. The live HTML scan checked 87 same-origin linked paths and assets across 30 classic and React documents and found no non-200 final fetches. This scan covers links and assets in response HTML. The browser tests separately exercise JavaScript navigation. Existing design archives stay outside the release.

### Evidence and regression coverage

- A Googlebot-user-agent HTTP probe returned 200 for all four sitemap pages. The released HTML contains a visible primary heading and meaningful copy before JavaScript runs. The local artifact checks parsed sitemap XML, confirmed crawl access and matched the HTTP responses to canonical and robots tags. Search Console’s live Google Inspection test requires the approved release to be live.
- The standard suite passed all 74 commands. The repository, frontend, account, provider, web, release, performance and syntax groups ran, along with React typecheck and build, composite build, and production directory and ZIP verification. The existing packaged browser suite passed 37 test cases, including the desktop and mobile booking flow and restored map, slideshow and media coverage.
- Desktop at 1440×1000 and mobile at 390×844 replayed the same live HTML before and after metadata injection using the live site’s static assets and fixture responses for services. Both passed search, recommendations, shuffle, keyboard selection of the multi-city example, map rendering, itinerary, booking links, Cognito handoff with the existing callback, browser-local travel profile save and return, and budget and non-budget legacy redirects. The same ordered partner links were produced before and after. The account and booking checks used synthetic data. They did not exercise a real signed-in account, live provider checkout, or payments.
- The homepage, sign-in and local profile screenshot pairs matched pixel-for-pixel at both widths. Additional comparisons covered results, itinerary and booking. Differences were confined to the dynamic map and media regions and small scrollbar or rendering differences. The classic packaging test verified that page bodies are byte-identical, and the change does not touch styles, images, scripts or navigation destinations.
- The mobile homepage review confirmed a single H1, section headings, form control labels, keyboard selection, reduced-motion behavior, and no horizontal overflow. Three throttled Chromium runs on production had a median LCP of 1.05 seconds and low observed layout shifts totaling 0.00023 per run. These lab samples do not establish field Core Web Vitals or INP. PageSpeed Insights returned 429 on the field-data attempt. The prioritized hero poster is 150 KB, lazy-loading is present, and the hero video file is 7.15 MB, even though the short lab traces transferred only part of it. Media was left as-is to preserve animation. [Web Vitals](https://web.dev/articles/vitals)

### Release boundary and Search Console

Live HTML differs from the main-based package at the homepage, sign-in, results, itinerary, booking, saved-trip and React routes. For example, the live homepage uses a newer account menu script absent from main, and the live booking page was 3,114 bytes compared with 12,455 bytes in the main-based baseline. Publishing the complete main-based build could overwrite the live experience. Reconcile the live frontend sources or apply the reviewed head-only changes to a verified copy of the live build, and repeat the release checks before requesting approval to publish.

The AWS CLI credentials available during this audit could not read the CloudFront distribution. The existing query-preserving redirect behavior was verified over HTTP. A later edge change needs inspection of the active distribution and function associations first. At that point, test exact redirect targets, repeated and encoded query parameters, GET and HEAD, React trailing-slash behavior, auth and callback URLs, itinerary URLs, partner handoffs, and missing paths. Treat a queryless multi-city URL independently from a budget-bearing search. Avoid using a homepage redirect for a removed URL with no relevant replacement. The current hosting status and redirect chains remain as observed above. [Google redirect guidance](https://developers.google.com/search/docs/crawling-indexing/301-redirects)

After an approved deployment:

1. Fetch the canonical pages, sitemap and robots file from production. Verify all four sitemap URLs return 200, have self-canonicals and visible content, and lack indexing exclusions. Verify an auth page and a search result still emit `noindex`, and repeat the redirect checks.
2. Open the verified `globevoy.com` property in Search Console. In **Sitemaps**, submit `https://globevoy.com/sitemap.xml`, then check for **Success** and four discovered URLs after Google processes it. [Google’s sitemap instructions](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
3. Use **URL Inspection → Test live URL** for `/`, `/about.html`, `/how-it-works.html` and `/trust.html`. Check the rendered HTML, crawl status and user-declared canonical. Select **Request indexing** for those public destinations once they pass. [Google’s URL Inspection instructions](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl)
4. Use URL Inspection and Page Indexing after recrawl to confirm Google’s selected canonicals and recorded exclusions. Use the duplicate report’s export to identify the unnamed URL before assigning it a disposition.

## Production sync and hosting findings (Nov 27)

- globevoy.com is the Amplify app `globevoy` (`dttux5e6ddtzb`, branch `main`, manual deploy job 268). The "CloudFront and S3" responses come from Amplify's managed CDN. The account has no separate distribution or bucket.
- The live site was built from commit `16d9bfb` (GV-WEB-4, PR #202 on top of #201): 503 of 503 files match its release manifest. Branch `frontend-sync` merges that commit and this SEO branch onto main. All scripts, styles and runtime configuration stay byte-identical to production. Only `<head>` metadata, React `noindex` tags, `robots.txt` and `sitemap.xml` change.
- **Soft 404s left as they are.** `/multi-city.html` and `/multicity-visualizer.html` pick their destination from the query (a `budget` parameter goes to results, otherwise home). Amplify redirect rules cannot branch on query values, so a server redirect would break search handoffs. Both pages are noindex. Google will drop them from the soft-404 report over time. Validate the fix in Search Console after deployment.
- Optional, needs approval: change the `www` → apex rule from 302 to 301, a permanent signal for the four "Page with redirect" URLs. This is an Amplify rule change, not DNS.
