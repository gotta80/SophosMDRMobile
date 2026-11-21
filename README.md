# Sophos MDR Mobile

A mobile-first PWA (designed for iPhone/Safari) to browse, monitor and answer **Sophos MDR** cases through Sophos' Cases GraphQL API and the Sophos Central REST API. Node/Express backend (BFF) + React/Vite/Tailwind frontend, shipped in **a single container**. Sophos secrets stay in the backend; the OAuth2 token is cached in memory and renewed before it expires. The UI is available in English and Italian.

> **Disclaimer:** this is an independent, community project. It is **not affiliated with, endorsed by, or sponsored by Sophos Ltd.** Sophos, Sophos Central, Sophos Fusion and Sophos MDR are trademarks of Sophos Ltd. The app only uses the publicly documented Sophos APIs with your own credentials.

Features:
- **Dashboard** (home): cases to handle / open, cases and SOC effort hours over the period (7/30/90 days), trend, severity and analysis outcome (% false positives).
- Case list with filters and pull-to-refresh; case detail with key findings (Markdown), detections, MITRE techniques, involved hosts and users. Raw HTML inside the key findings (tables, `<br>`, `<div>`...) and HTML entities such as `&amp;` in titles and AI texts are converted to readable text.
- **AI explanation** (Sophos AI, English only): case summary and per-detection analysis.
- **Case classification**: verdict (false positive, benign/malicious true positive, inconclusive), reason, note and closing, with explicit confirmation.
- Chat with the analysts and comment posting (`@sophos` shortcut). Comments written by **your colleagues** (customer side) are highlighted in green, apart from the Sophos SOC ones (white) and yours (blue); automatic Sophos messages are shown as small grey lines. PIN login, dark mode, demo mode with fake data.
- **Multi-tenant** (Partner accounts): customer picker with a portfolio view (cases to handle per customer). Customers already on Fusion get every feature; customers still on **classic Sophos Central** are **read-only** (cases, detections, MITRE, entities and activity timeline, but no comments, classification or AI). Unreachable customers (not delegated / not on Fusion) are listed with the reason and re-checked on demand (Check customers again).
- **MDR level and licenses:** every customer shows an **MDR** / **MDR Plus** tag (from its active licenses), and a **Licenses** tab lists its licenses (quantity, usage, expiry). Customers without case access or without MDR are still selectable and open only the Licenses tab.
- **Account health** card on the dashboard: the Sophos Central *Account Health Check* scores (lowest check, checks to fix, MDR checks).
- **Several access PINs** and an **activity log** (who signed in, opened a case, commented, classified...), with a private page to read it.
- **Bilingual UI** (English / Italian): follows the browser language, switchable in the app or with `?lang=en` / `?lang=it`.

## Screenshots

Demo mode (`MOCK_MODE=true`): all data is made up.

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/01-dashboard.jpg" width="220" alt="Dashboard"><br><sub>Dashboard</sub></td>
    <td align="center"><img src="docs/screenshots/02-casi.jpg" width="220" alt="Case list"><br><sub>Case list</sub></td>
    <td align="center"><img src="docs/screenshots/03-dettaglio.jpg" width="220" alt="Case detail"><br><sub>Case detail</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/04-classifica.jpg" width="220" alt="Classify the case"><br><sub>Classification</sub></td>
    <td align="center"><img src="docs/screenshots/05-spiegazione-ai.jpg" width="220" alt="AI explanation"><br><sub>AI explanation</sub></td>
    <td align="center"><img src="docs/screenshots/06-dashboard-dark.jpg" width="220" alt="Dashboard in dark mode"><br><sub>Dark mode</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/07-clienti.jpg" width="220" alt="Customer picker"><br><sub>Customer picker</sub></td>
    <td align="center"><img src="docs/screenshots/08-classic-timeline.jpg" width="220" alt="Classic case timeline"><br><sub>Classic case timeline (read-only)</sub></td>
    <td align="center"><img src="docs/screenshots/09-licenses.jpg" width="220" alt="Licenses"><br><sub>Licenses tab</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/10-licenses-only.jpg" width="220" alt="Licenses-only customer"><br><sub>Customer without MDR (licenses only)</sub></td>
    <td></td>
    <td></td>
  </tr>
</table>

## MDR level and licenses

Every customer shows an **MDR level** tag (**MDR** or **MDR Plus**) next to FUSION / CLASSIC in the customer picker and on the dashboard. The **Licenses** tab (third tab of the bottom bar) lists the selected customer's licenses, MDR products first, with type, quantity, usage, start/end dates and an expiry warning (expired / within 90 days). Pay-as-you-go (MSP) licenses with no seat in use are hidden behind a "Also show unused licenses" button.

- Source: the Sophos Central **Licensing API** (`GET https://api.central.sophos.com/licenses/v1/licenses` with `X-Tenant-ID`), which works for both Fusion and classic customers. For Fusion customers the GraphQL `tenantLicenses` query is the fallback (no dates or quantities). Read-only; licenses are cached in memory for 1 hour.
- Only **active** licenses count: not expired and, for pay-as-you-go licenses, with at least one seat in use. The level is taken from the product codes of the active licenses:

| Product code contains | Level shown |
|---|---|
| `MTR-ADV` (e.g. `CIXAMTR-ADV`, `CIXAMTR-ADV-MSP`) or `MDR-COMPLETE` (e.g. `MDR-COMPLETE`, `SRVMDR-COMPLETE`) | **MDR Plus** |
| `MTR-STD` (e.g. `CIXAMTR-STD-MSP`) or `MDR` / `SRVMDR` / `USRMDR` | **MDR** |
| any other MDR/MTR product | **MDR** (product name shown in the Licenses tab) |
| none | no tag |

- **Licenses-only customers:** a customer whose cases cannot be read (not on Fusion / no delegation), or that has no cases and no MDR, is still listed (section "No MDR / licenses only") if its licenses can be read. Selecting it opens only the Licenses tab: Dashboard and Cases are hidden and no case API is called.
- **Inactive customers** (no active license at all) are hidden from the picker; a "Show inactive customers" button at the bottom of the list reveals them.
- Customers are probed at startup and only when you press "Check customers again" (there is no periodic background check).

## Account health

The dashboard shows an **Account health** card with the scores of the Sophos Central *Account Health Check* (`GET {apiHost}/account-health-check/v1/health-check` with `X-Tenant-ID`, read-only, cached for 10 minutes). It works for Fusion and classic customers. The API returns one score (0-100) per check and no overall score: like the console, the overall value is the **lowest** check. The card lists the checks below 100 (for policies, the ones not on the recommended settings) and, on request, all checks: endpoint and server protection, threat-protection policies, exclusions, Tamper Protection and, for customers with the MDR service, the MDR checks (data telemetry, authorized contact). Checks with no devices and snoozed checks are not counted. Customers without the endpoint API simply do not show the card.

## Access and activity log

`APP_ACCESS_PIN` accepts **several PINs**, separated by commas (`APP_ACCESS_PIN=123456,654321`; a PIN cannot contain a comma). Users are named by the position of their PIN: `user1`, `user2`... (add new PINs at the end so the names do not shift; to sign everybody out, change `SESSION_SECRET`).

Every sign-in (also failed or blocked), sign-out, case opened, comment sent (length only, never the text), classification, AI request and customer re-check is written as a JSON line to the container log (`docker logs`) and to `/data/audit.jsonl` (the `audit-data` Docker volume; rotated above 5 MB; override the path with `AUDIT_LOG_FILE`). PINs are never logged. Docker logs are limited to 3 files of 10 MB by the compose file.

The page `/admin/audit` shows the log (filters `?user=user2`, `?action=comment`, `?n=500`, `?lang=en`). It is **not linked from the app** and only available to sessions opened with the first PIN (`user1`); sign in to the app first, then open the URL.

## Quick start (Docker)

```bash
cp .env.example .env      # set APP_ACCESS_PIN and SESSION_SECRET; MOCK_MODE=true for the demo
docker compose up -d --build
```

By default the app listens on `127.0.0.1:3456`. To use it on an iPhone you need **HTTPS** (`Secure` cookie, PWA installation): publish it behind a reverse proxy or tunnel that terminates TLS and forwards to `127.0.0.1:3456` (Caddy, nginx, Cloudflare Tunnel, etc.), with `TRUST_PROXY=true` in `.env`. The proxy must send `X-Forwarded-Proto`.

### Add to the iPhone Home Screen
Safari → Share → **Add to Home Screen**: the app opens full screen.

## Sophos credentials

Create an **API credential** in Sophos Central/Fusion and set in `.env`: `MOCK_MODE=false`, `SOPHOS_CLIENT_ID`, `SOPHOS_CLIENT_SECRET`.

**Multiple customers:** you can define up to 6 credentials (`SOPHOS_CLIENT_ID_2` / `SOPHOS_CLIENT_SECRET_2` …), for example a Partner credential from the Partner Dashboard. At startup the app lists the tenants visible to each credential (`whoami` and `/partner/v1/tenants`), tries Fusion first and then the classic Sophos Central Cases API for each tenant, and uses the connection that returns cases. Nothing is written to disk: in-memory caches only.

Permissions: a read-only role is enough to read cases; to **comment** and **classify/close** cases you need `Investigation:update` (and `mention_partner` for `@sophos`). For hosts and users the app reads detections (`Alert:read`); with `Agent:read` it also shows the host isolation status. Pick the role with the fewest privileges that includes these permissions and avoid administrative roles: you can read your credential's effective permissions with the `authzPermissions` query.

The backend only uses: case list/detail, comments, `updateCase` (classification/closing), evidence, detections (alerts), metrics (`caseSummaryMetrics`, `casesAggregation`) and the AI queries `generativeAICaseSummary` / `generativeAIDetectionAnalysis`.

Integration notes (endpoint `https://api.taegis.sophos.com/graphql`, headers `Authorization` + `X-Tenant-ID`):
- The `Case` type only exposes evidence IDs: detections, MITRE, hosts and users are derived from the alerts (`detectionRetrieveById`), cached for 10 minutes. Without detections (and without `Agent:read`) hosts and users are not available.
- Primary statuses are per tenant (`new`, `awaiting_sophos_assignment`, `in_progress`, `customer_action_required`, `on_hold`, `closed`): the mapping lives in `toStatus` (`server/src/services/sophosQueries.ts`).
- Sophos AI answers are English only; verdicts and reasons are read at runtime (`casePrimaryVerdicts`, `caseSecondaryVerdicts`).
- Classification writes to Sophos with a single `updateCase` (verdict, reason, note and, if requested, closed status): compatibility and requirements are validated by Sophos and the error is shown.
- Comments carry no "MDR analyst" flag: yours are recognized by an `authorId` equal to the API client id (or `SOPHOS_MY_AUTHOR_IDS`).
- The comment API only gives an opaque `authorId` (names cannot be resolved with an API credential). Colleagues are inferred: an author who writes `@sophos` is on the customer side, one who writes `@authorized_contacts` is the Sophos SOC, and `mtr-to-central` is the automation. This is a heuristic kept in memory: a colleague is recognized after the first comment that mentions `@sophos`.
- The Sophos backend sometimes returns transient errors (`conn busy`) when several queries are combined: the case and its comments are separate requests, with automatic retries.
- Filters and sorting are applied by the backend (latest 300 cases), not via CQL.
- Classic Sophos Central: `{apiHost}/cases/v1/cases` (page size max 50) with `/detections`, `/impacted-entities`, `/mitre-attack-summary`; there are no comments, verdicts or AI. The timeline uses the undocumented `/activities` endpoint and may change.

## Local development

Requires Node 20+.

```bash
npm run install:all
npm run icons                 # generate the PNG icons (once)
cp .env.example .env          # MOCK_MODE=true
npm run dev:server            # API on :3456
npm run dev:web               # Vite on :5173 (/api proxy)
```

Production build without Docker: `npm run build && NODE_ENV=production npm start` (serves `web/dist`).

## `.env` variables

| Variable | Description |
|---|---|
| `APP_ACCESS_PIN` | Access PIN/password (required); several separated by commas (`user1`, `user2`... in the activity log) |
| `SESSION_SECRET` | Cookie signing key (if empty, sessions are lost on restart) |
| `MOCK_MODE` | `true` = fake data, in-memory comments |
| `SOPHOS_CLIENT_ID` / `SOPHOS_CLIENT_SECRET` | Sophos API credentials |
| `SOPHOS_CLIENT_ID_2` / `SOPHOS_CLIENT_SECRET_2` … `_6` | Additional credentials (e.g. Partner, multi-customer) |
| `SOPHOS_MY_AUTHOR_IDS` | authorIds to show as "yours" in the chat |
| `TRUST_PROXY` | `true` behind an HTTPS reverse proxy |
| `COOKIE_SECURE` | Default `auto` (Secure if the request is HTTPS) |
| `BIND_IP` | IP the compose file publishes the port on (default `127.0.0.1`) |
| `PORT` | Port (default 3456) |
| `AUDIT_LOG_FILE` | Activity log file (default `/data/audit.jsonl` in production; empty = container log only) |

## Security
- PINs compared in constant time (all of them, whatever matches), rate limit of 5 failures/15 min per IP, HMAC-signed cookie, `HttpOnly` and `SameSite=Lax`.
- API writes only accept `application/json`; strict CSP; `/api` responses are `no-store`; the service worker never caches the API.
- Actions are recorded per PIN in the activity log (see above); PINs and comment texts are never logged.
- Do not expose the app on the Internet without an additional access layer: the PIN is the only application-level protection.
- `.env` contains secrets: never commit it (it is in `.gitignore`).

## License

[MIT](LICENSE) © 2026 gotta80
