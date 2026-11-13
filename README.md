# Sophos MDR Mobile

PWA mobile-first (pensata per iPhone/Safari) per consultare e rispondere ai casi **Sophos MDR** tramite le Cases GraphQL API di Sophos. Backend Node/Express (BFF) + frontend React/Vite/Tailwind, in **un unico container**. I segreti Sophos restano nel backend; il token OAuth2 è tenuto in cache in memoria e rinnovato prima della scadenza.

Funzioni: lista casi con filtri e pull-to-refresh, dettaglio (key findings in Markdown, host e utenti coinvolti, stato di isolamento), chat con gli analisti e invio commenti (con scorciatoia `@sophos`), login con PIN, dark mode, modalità demo con dati finti.

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

Permessi: per leggere i casi basta un ruolo di sola lettura; per **commentare** serve `Investigation:update` (e `mention_partner` per `@sophos`). Scegli il ruolo con meno privilegi che li includa ed evita ruoli amministrativi. L'app usa solo: lista/dettaglio casi, commenti, evidenze e lettura asset.

Note sull'integrazione (endpoint `https://api.taegis.sophos.com/graphql`, header `Authorization` + `X-Tenant-ID`):
- Il tipo `Case` espone solo ID degli asset: host e utenti sono risolti con una seconda query (`assetsV2`), con cache di 10 minuti.
- Gli stati sono definiti per tenant: la mappatura su Action Required / In attesa ecc. è euristica sui nomi (`toStatus` in `server/src/services/sophosQueries.ts`).
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
