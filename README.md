# Sophos MDR Mobile

PWA mobile-first (pensata per iPhone/Safari) per consultare e rispondere ai casi **Sophos MDR** tramite le Cases GraphQL API di Sophos. Backend Node/Express (BFF) + frontend React/Vite/Tailwind, in **un unico container**. I segreti Sophos restano nel backend; il token OAuth2 è tenuto in cache in memoria e rinnovato prima della scadenza.

Funzioni:
- **Dashboard** (home): casi da gestire/aperti, casi e ore di impegno SOC nel periodo (7/30/90 giorni), andamento, severità ed esito delle analisi (% falsi positivi).
- Lista casi con filtri e pull-to-refresh; dettaglio con key findings (Markdown), detection, tecniche MITRE, host e utenti coinvolti.
- **Spiegazione AI** (Sophos AI, solo in inglese): riassunto del caso e analisi per singola detection.
- **Classificazione del caso**: verdetto (falso positivo, vero positivo benigno/malevolo, inconcludente), motivazione, nota e chiusura, con conferma esplicita.
- Chat con gli analisti e invio commenti (scorciatoia `@sophos`), login con PIN, dark mode, modalità demo con dati finti.

## Screenshot

Modalità demo (`MOCK_MODE=true`): i dati sono inventati.

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/01-dashboard.jpg" width="220" alt="Dashboard"><br><sub>Dashboard</sub></td>
    <td align="center"><img src="docs/screenshots/02-casi.jpg" width="220" alt="Lista casi"><br><sub>Lista casi</sub></td>
    <td align="center"><img src="docs/screenshots/03-dettaglio.jpg" width="220" alt="Dettaglio caso"><br><sub>Dettaglio caso</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/04-classifica.jpg" width="220" alt="Classifica il caso"><br><sub>Classificazione</sub></td>
    <td align="center"><img src="docs/screenshots/05-spiegazione-ai.jpg" width="220" alt="Spiegazione AI"><br><sub>Spiegazione AI</sub></td>
    <td align="center"><img src="docs/screenshots/06-dashboard-dark.jpg" width="220" alt="Dashboard in modalità scura"><br><sub>Modalità scura</sub></td>
  </tr>
</table>

## Avvio rapido (Docker)

```bash
cp .env.example .env      # imposta APP_ACCESS_PIN e SESSION_SECRET; MOCK_MODE=true per la demo
docker compose up -d --build
```

Di default l'app ascolta su `127.0.0.1:3456`. Per usarla su iPhone serve **HTTPS** (cookie `Secure`, installazione PWA): pubblicala con un reverse proxy o un tunnel che termini TLS e inoltri a `127.0.0.1:3456` (Caddy, nginx, Cloudflare Tunnel, ecc.), con `TRUST_PROXY=true` nel `.env`. Il proxy deve inviare `X-Forwarded-Proto`.

### Aggiungere alla Home di iPhone
Safari → Condividi → **Aggiungi alla schermata Home**: l'app si apre a schermo intero.

## Credenziali Sophos

Crea una **API credential** in Sophos Central/Fusion e imposta nel `.env`: `MOCK_MODE=false`, `SOPHOS_CLIENT_ID`, `SOPHOS_CLIENT_SECRET` (e `SOPHOS_TENANT_ID` solo per credenziali Partner/Organization).

Permessi: per leggere i casi basta un ruolo di sola lettura; per **commentare**, **classificare/chiudere** i casi serve `Investigation:update` (e `mention_partner` per `@sophos`). Per host e utenti l'app legge le detection (`Alert:read`); con `Agent:read` mostra anche lo stato di isolamento dell'host. Scegli il ruolo con meno privilegi che includa questi permessi ed evita ruoli amministrativi: puoi leggere i permessi effettivi della tua credenziale con la query `authzPermissions`.

Il backend usa solo: lista/dettaglio casi, commenti, `updateCase` (classificazione/chiusura), evidenze, detection (alert), metriche (`caseSummaryMetrics`, `casesAggregation`) e le query AI `generativeAICaseSummary` / `generativeAIDetectionAnalysis`.

Note sull'integrazione (endpoint `https://api.taegis.sophos.com/graphql`, header `Authorization` + `X-Tenant-ID`):
- Il tipo `Case` espone solo gli ID delle evidenze: detection, MITRE, host e utenti si ricavano dagli alert (`detectionRetrieveById`), con cache di 10 minuti. Senza detection (e senza `Agent:read`) host e utente non sono disponibili.
- Gli stati primari sono per tenant (`new`, `awaiting_sophos_assignment`, `in_progress`, `customer_action_required`, `on_hold`, `closed`): la mappatura è in `toStatus` (`server/src/services/sophosQueries.ts`).
- Le risposte AI di Sophos sono solo in inglese; verdetti e motivazioni sono letti a runtime (`casePrimaryVerdicts`, `caseSecondaryVerdicts`).
- La classificazione scrive su Sophos con una sola `updateCase` (verdetto, motivazione, nota e, se richiesto, stato chiuso): compatibilità e requisiti sono validati da Sophos e l'errore viene mostrato.
- Nessun flag "analista MDR" sui commenti: i tuoi sono riconosciuti da `authorId` uguale al client id API (oppure `SOPHOS_MY_AUTHOR_IDS`).
- Il backend Sophos risponde a volte con errori transitori (`conn busy`) se si combinano più query: caso e commenti sono richieste separate e ci sono tentativi automatici.
- Filtri e ordinamento sono applicati dal backend (ultimi 300 casi), non via CQL.

## Sviluppo locale

Richiede Node 20+.

```bash
npm run install:all
npm run icons                 # genera le icone PNG (una volta)
cp .env.example .env          # MOCK_MODE=true
npm run dev:server            # API su :3456
npm run dev:web               # Vite su :5173 (proxy /api)
```

Build di produzione senza Docker: `npm run build && NODE_ENV=production npm start` (serve `web/dist`).

## Variabili `.env`

| Variabile | Descrizione |
|---|---|
| `APP_ACCESS_PIN` | PIN/password di accesso (obbligatoria) |
| `SESSION_SECRET` | Chiave firma cookie (se vuota le sessioni decadono al riavvio) |
| `MOCK_MODE` | `true` = dati finti, commenti in memoria |
| `SOPHOS_CLIENT_ID` / `SOPHOS_CLIENT_SECRET` | Credenziali API Sophos |
| `SOPHOS_TENANT_ID` | Solo per credenziali Partner/Organization |
| `SOPHOS_MY_AUTHOR_IDS` | authorId da mostrare come "tuoi" nella chat |
| `TRUST_PROXY` | `true` dietro reverse proxy HTTPS |
| `COOKIE_SECURE` | Default `auto` (Secure se la richiesta è HTTPS) |
| `BIND_IP` | IP su cui il compose pubblica la porta (default `127.0.0.1`) |
| `PORT` | Porta (default 3456) |

## Sicurezza
- PIN confrontato in tempo costante, rate limit 5 errori/15 min per IP, cookie firmato HMAC, `HttpOnly` e `SameSite=Lax`.
- Le scritture API accettano solo `application/json`; CSP restrittiva; risposte `/api` con `no-store`; il service worker non mette mai in cache le API.
- Non esporre l'app su Internet senza un livello di accesso ulteriore: il PIN è l'unica protezione applicativa.
- Il `.env` contiene i segreti: non committarlo (è in `.gitignore`).
