# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Progetto

Bot Telegram (`@BattaBenzbot`) che interroga i prezzi live dell'Osservaprezzi
Carburanti MIMIT e invia alert sulla benzina self. Node 22 + TypeScript ESM,
nessuna dipendenza runtime oltre a `dotenv` e `node-cron`: le chiamate a
Telegram e a MIMIT usano `fetch` nativo.

Il codice, i log, i commenti e i messaggi utente sono **in italiano** —
mantenere questa convenzione nelle modifiche.

## Comandi

```bash
npm ci
npm run dev      # tsx src/index.ts — scheduler + bot in long polling
npm run once     # solo un controllo del canale (usare con DRY_RUN=true)
npm test         # compila con tsconfig.test.json ed esegue node --test
npm run check    # build + test, da eseguire prima di ogni push
```

Per un singolo file di test, compilare e poi puntare al file JS emesso:

```bash
npx tsc -p tsconfig.test.json && node --test .test-dist/mimit.test.js
```

Non esiste un linter: `tsc --strict` (con `noUncheckedIndexedAccess`) è
l'unico controllo statico. Deploy in produzione via
`docker compose up -d --build` con `./data` montato su `/app/data`.

## Architettura

`src/index.ts` avvia tre cose nello stesso processo: il cron degli alert
personalizzati, il cron opzionale del canale e il long polling del bot
(quest'ultimo non ritorna mai). Entrambi i cron hanno un flag di rientranza
che salta l'esecuzione se la precedente è ancora in corso.

Ci sono **due percorsi di alert indipendenti** che condividono `mimit.ts`
(fetch offerte) e `alert.ts` (dedup + formattazione del messaggio):

| | Canale (legacy) | Utenti (multiutente) |
|---|---|---|
| Entry | `job.ts` (anche `once.ts`) | `subscriber-job.ts` |
| Config | globale da `.env` | per utente in `subscriptions.ts` |
| Stato | `state.ts` → `STATE_FILE` | campi sul `Subscriber` → `SUBSCRIBERS_FILE` |
| Cron | `CRON_SCHEDULE` | `USER_SCHEDULER_CRON` |
| `DRY_RUN` | rispettato | **ignorato**: invia sempre |

`Subscriber` soddisfa strutturalmente `AlertState` (`lastWasBelow`,
`lastAlertPrice`, `lastAlertStationId`): per questo `shouldNotify` serve
entrambi i percorsi senza adattatori. Toccando quei campi in `types.ts`, si
rompono tutti e due.

### Slot orari degli utenti

`USER_SCHEDULER_CRON` gira ogni minuto ma non interroga il MIMIT ogni minuto.
`getRomeScheduleSlot` produce una chiave `YYYY-MM-DD-HH` in ora italiana;
vengono controllati solo gli utenti attivi, con posizione, la cui ora è nella
lista `hours` e il cui `lastCheckKey` è diverso dallo slot corrente. La chiave
viene scritta **solo dopo un controllo riuscito**, così un errore di rete
viene ritentato al minuto successivo. Cambiare gli orari o riattivare gli
alert azzera `lastCheckKey` per permettere un controllo immediato nello slot
in corso.

### Ricerca MIMIT

L'API `POST /search/zone` è limitata a 10 km per richiesta. Per raggi
superiori `buildSearchPoints` interroga il centro più 8 punti su un anello a
`radiusKm - 5`, poi si deduplica per id stazione e si riapplica la distanza
haversine esatta (`geo.ts`) dal punto di partenza. Il filtro
`requireTodayUpdate` è applicato **due volte**: prima su `station.insertDate`
dalla ricerca, poi dopo l'arricchimento con `GET /registry/servicearea/:id`
(che può correggere prezzo, nome e indirizzo) accettando l'offerta se è
odierno il `communicatedAt` del carburante **oppure** l'`insertDate`
dell'impianto — la data di validità del prezzo è spesso anteriore alla
comunicazione. Solo `fuelId === 1` con `isSelf` (benzina self).

L'API risponde **429** se riceve troppe richieste ravvicinate. Tutte le
chiamate passano da `fetchJson`, che le distanzia (`reserveRequestSlot`,
`MIN_REQUEST_GAP_MS`) e ritenta con backoff esponenziale su 429/408/5xx
rispettando `Retry-After`; ricerche e arricchimenti girano con
`mapWithConcurrency` a `MAX_CONCURRENT_REQUESTS`, mai con `Promise.all` su
tutta la lista. Un controllo completo impiega quindi qualche secondo:
è voluto.

### Messaggio di alert

`shouldNotify` decide sul **migliore** sotto soglia, ma `buildMessage` elenca
tutti i `MAX_RESULTS` distributori trovati, marcando con `✅`/`🔸` quelli sotto
e sopra soglia. Non filtrare per soglia prima di passare le offerte, altrimenti
l'alert si riduce a una riga sola.

### Persistenza

Nessun database: tre file JSON in `data/`, tutti scritti con `write` su `.tmp`
+ `rename` atomico. `SubscriptionStore` serializza le scritture su una
`persistQueue` e restituisce sempre `structuredClone`: **mutare l'oggetto
`Subscriber` ricevuto non salva nulla**, serve `store.update(chatId, patch)`.
`BOT_STATE_FILE` conserva l'offset di `getUpdates`, riscritto dopo ogni update
elaborato per non riprocessare messaggi dopo un riavvio.

### Telegram

`telegram.ts` è un wrapper sottile sulla Bot API; i messaggi usano
`parse_mode: HTML`, quindi ogni testo proveniente dai dati MIMIT va passato
per `escapeHtml` in `alert.ts`. In `bot.ts` la stessa azione è raggiungibile
da comando slash, da pulsante della reply keyboard (mappato a comando in
`buttonCommands`) e da inline keyboard (`callback_data` nella forma
`tipo:valore`, con `valore = "custom"` che imposta `pendingAction` e attende
il messaggio di testo successivo). Aggiungendo un comando, aggiornare anche
`preparePollingBot` (`setMyCommands`), `mainKeyboard` e `buttonCommands`.

## Note

- ESM `NodeNext`: gli import relativi devono terminare con `.js`.
- `validateConfig` rifiuta `RADIUS_KM > 20` (limite della ricerca live); gli
  stessi limiti sono duplicati nei parser di `bot.ts` (`parseThreshold` 1–3 €,
  `parseRadius` 1–20 km, `parseHours` 0–23).
- I numeri in input accettano la virgola decimale (`config.ts`, `bot.ts`) e i
  prezzi vengono sempre formattati con la virgola.
- `data/` e `.env` non sono versionati; il `git pull` sul server non li tocca.
