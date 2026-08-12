# BattaBenz — bot Telegram multiutente

Bot Telegram che interroga i prezzi live dell'Osservaprezzi MIMIT e invia alert
personalizzati. Ogni persona può scegliere posizione, raggio, soglia e orari.
Il vecchio alert sul canale può restare attivo in parallelo.

## Esperienza utente

Aprendo il bot in chat privata e inviando `/start`, l'utente può usare questi
comandi o i pulsanti equivalenti:

| Comando | Funzione |
|---|---|
| `/posizione` | Salva o cambia il punto da cui cercare |
| `/soglia` | Imposta il prezzo massimo desiderato |
| `/raggio` | Cerca da 1 a 20 km |
| `/orari` | Sceglie una o più ore italiane |
| `/controlla` | Esegue subito una verifica live |
| `/stato` | Mostra tutte le impostazioni |
| `/pausa` | Sospende gli alert |
| `/attiva` | Riattiva gli alert |

Le impostazioni iniziali sono: soglia `1,930 €/l`, raggio `10 km`, orari
`07:00` e `22:00`, solo prezzi comunicati nella giornata corrente.

## Dati e privacy

Il bot salva in `data/subscribers.json` l'ID Telegram, l'eventuale username,
la posizione scelta e le preferenze. Il file resta sul tuo server e non deve
essere pubblicato su Git. La cartella `data/` e il file `.env` sono già esclusi
da `.gitignore`.

## Avvio sul server con Docker

```bash
cd ~/telegram-benzina-alert
cp .env.example .env
nano .env
```

Configurazione minima:

```dotenv
TELEGRAM_BOT_TOKEN=token_nuovo_generato_da_BotFather

# Mantieni true se vuoi continuare a pubblicare anche sul canale.
CHANNEL_ALERT_ENABLED=true
TELEGRAM_CHAT_ID=@username_del_canale

REQUIRE_TODAY_UPDATE=true
TIMEZONE=Europe/Rome
```

Se vuoi soltanto i messaggi privati personalizzati:

```dotenv
CHANNEL_ALERT_ENABLED=false
```

Poi prepara il volume e avvia:

```bash
mkdir -p data
chown -R 1000:1000 data
docker compose up -d --build
docker compose logs -f benzina-alert
```

Nei log devono comparire `Scheduler utenti attivo` e
`Bot multiutente in ascolto via long polling`. Apri quindi `@BattaBenzbot`,
premi **Avvia** o invia `/start`, poi condividi una posizione.

> Il token pubblicato in una chat o in uno screenshot va revocato da BotFather
> con `/revoke` e sostituito nel solo file `.env` del server.

## Aggiornare il server con Git

Il flusso consigliato è: modifichi sul PC con VS Code, fai `git push`, quindi
sul server scarichi e ricostruisci il container.

Prima installazione dal repository:

```bash
git clone URL_DEL_TUO_REPOSITORY telegram-benzina-alert
cd telegram-benzina-alert
cp .env.example .env
nano .env
mkdir -p data
chown -R 1000:1000 data
docker compose up -d --build
```

Aggiornamenti successivi:

```bash
cd ~/telegram-benzina-alert
git pull --ff-only
docker compose up -d --build
docker compose logs --tail=100 benzina-alert
```

Il `git pull` non modifica `.env`, `data/subscribers.json` o lo storico degli
alert, perché questi file non sono versionati.

## Modificare con Visual Studio Code su Windows

1. Installa **Git for Windows**, **Node.js 22** e **Visual Studio Code**.
2. In PowerShell esegui:

   ```powershell
   git clone URL_DEL_TUO_REPOSITORY
   cd telegram-benzina-alert
   code .
   npm ci
   npm test
   ```

3. Modifica i file nella cartella `src/`.
4. Prima di pubblicare esegui `npm run check`.
5. Salva la modifica con:

   ```powershell
   git add .
   git commit -m "Descrizione della modifica"
   git push
   ```

Non creare né committare un `.env` con il token reale sul PC.

## Configurazione globale

| Variabile | Default | Significato |
|---|---:|---|
| `CHANNEL_ALERT_ENABLED` | automatico | Attiva il canale se esiste `TELEGRAM_CHAT_ID` |
| `CRON_SCHEDULE` | `0 7,22 * * *` | Orari dell'eventuale canale |
| `USER_SCHEDULER_CRON` | `* * * * *` | Motore che individua gli utenti da controllare |
| `MAX_RESULTS` | `3` | Distributori mostrati |
| `MIN_PRICE_DROP` | `0.005` | Ribasso richiesto per ripetere un alert |
| `REQUIRE_TODAY_UPDATE` | `true` | Solo prezzi comunicati oggi per il canale |
| `TIMEZONE` | `Europe/Rome` | Fuso orario degli alert |
| `SUBSCRIBERS_FILE` | `/app/data/subscribers.json` | Preferenze utenti persistenti |
| `BOT_STATE_FILE` | `/app/data/bot-state.json` | Ultimo aggiornamento Telegram elaborato |

`USER_SCHEDULER_CRON` va lasciato ogni minuto: non interroga sempre il MIMIT per
tutti. Seleziona soltanto gli utenti la cui ora personalizzata è appena scattata
e impedisce doppioni nello stesso slot.

## Sviluppo senza Docker

```bash
npm ci
npm run dev
npm run check
```

Per provare soltanto il vecchio alert canale, senza inviare messaggi, imposta
`DRY_RUN=true` ed esegui:

```bash
npm run once
```

## Fonte dati

Il progetto usa la ricerca geografica live dell'Osservaprezzi Carburanti MIMIT.
Per raggi superiori a 10 km esegue più ricerche, elimina i duplicati e applica
la distanza esatta dalla posizione dell'utente. Con la modalità rigorosa, se
nessun gestore nel raggio ha comunicato oggi il prezzo benzina self, non viene
inviato alcun alert.

- Consultazione live: <https://carburanti.mise.gov.it/ospzSearch/zona>
- Licenza dati: IODL 2.0

Le coordinate e i prezzi sono comunicati dai gestori; prima di partire conviene
sempre controllare nel messaggio la data di aggiornamento e il link alla mappa.
