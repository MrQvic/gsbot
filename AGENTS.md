# AGENTS.md

Kontext pro dalsi praci na tomhle Mineflayer botovi.

## Projekt

- Node.js Mineflayer bot pro Minecraft server.
- Vstup prikazu je zatim pres terminal/konzoli, pozdeji muze pribyt Discord.
- Bot po pripojeni/spawnu resi prepojeni z lobby pres nether star menu.
- Po neocekavanem odpojeni vytvori novou Mineflayer instanci a reconnect opakuje s konfigurovanym backoffem.
- Autorepair ani jine stare JsMacros funkce sem nepatri, pokud si o ne uzivatel explicitne nerekne.

## Dulezite zasady

- Bot **nesmi sam od sebe psat do Minecraft chatu**.
- `bot.chat(...)` pouzivat jen pro explicitni rucni prikaz typu `say <text>` nebo kdyz o to uzivatel jasne pozada.
- Necommitovat tajne/soukrome soubory:
  - `.env`
  - `aut_cache/`
  - `node_modules/`
- Do dokumentace ani kodu nedavat realny Microsoft email, tokeny ani session cache.

## Spousteni

```bash
npm start
```

Prvni nastaveni:

```bash
cp .env.example .env
nano .env
```

## Konfigurace

Konfigurace se nacita z `.env` pres `dotenv` v `src/config.js`.

Hlavni promenne:

```env
MC_HOST=mc.goldskyblock.cz
MC_PORT=25565
MC_USERNAME=tvuj@email.cz
MC_AUTH=microsoft
MC_PROFILES_FOLDER=./aut_cache
MC_VERSION=1.21.11
MC_HIDE_PROTOCOL_ERRORS=true

RECONNECT_AUTO=true
RECONNECT_DELAYS_MS=60000,300000,900000,1800000,3600000

LOBBY_AUTO=true
LOBBY_REMOTE_ADDRESS=185.180.2.13
LOBBY_Y=112
LOBBY_SELECTOR_SLOT=4
LOBBY_SELECTOR_ITEM=nether_star
LOBBY_SELECTOR_NAME=Výběr serveru
LOBBY_MENU_SLOT=11
LOBBY_MOUSE_BUTTON=1
LOBBY_CLICK_MODE=0
LOBBY_SUCCESS_MESSAGE=+ TvojeJmeno
```

## Struktura

```text
bot.js                         hlavni entrypoint
src/botController.js          vlastni aktualni bot instanci a reconnect lifecycle
src/config.js                  env konfigurace
src/events.js                  mineflayer eventy
src/console.js                 readline konzole
src/commands/registry.js       command registry
src/commands/general.js        obecne konzolove prikazy
src/features/lobbyTransfer.js  prepojeni z lobby pres nether star
src/lib/logger.js              jednoduchy logger
src/lib/wait.js                sleep/waitForEvent helpery
```

## Konzolove prikazy

- `help`
- `status`
- `pos`
- `say <text>` - rucne posle zpravu do MC chatu
- `lobby`
- `lobby force`
- `slot <0-8>`
- `held`
- `use`
- `quit`

## Lobby transfer

Logika je v `src/features/lobbyTransfer.js`.

Flow:

1. Po `spawn` se podle `LOBBY_AUTO` spusti `runLobbyTransfer(bot)`.
2. Overi podminky IP/Y souradnice, pokud nejde o `force`.
3. Vybere hotbar slot s nether star.
4. Zkontroluje item/name selectoru.
5. Pouzije item v ruce.
6. Pocka na otevreni menu.
7. Klikne konfigurovany slot.
8. Volitelne ceka na potvrzovaci zpravu `LOBBY_SUCCESS_MESSAGE`.

## Reconnect

`src/botController.js` vytvari novou Mineflayer instanci po neocekavanem `end`.

- Vychozi prodlevy jsou 1, 5, 15, 30 a 60 minut.
- Posledni prodleva se opakuje, dokud se bot uspesne nespawne.
- `quit` a `CTRL+C` cekajici reconnect zrusi.
- Po reconnectu se znovu spusti lobby transfer, ale tezba se zatim automaticky neobnovuje.

## Znamy protocol warning/error

Server jede na 1.21.11. Mineflayer/minecraft-protocol/protodef muze spamovat `PartialReadError` u `packet_world_particles`.

Proto je v configu:

```js
hideErrors: envBoolean('MC_HIDE_PROTOCOL_ERRORS', true)
logErrors: false
```

Pokud bude potreba debugovat protocol errory:

```bash
MC_HIDE_PROTOCOL_ERRORS=false npm start
```

Pokud vse funguje a jde jen o particles, neni to blocker.

## Kontrola pred commitem/pushem

```bash
git status
git ls-files | grep -E '^(\.env$|aut_cache|node_modules)'
git grep -ni "microsoft@\|token\|password\|secret" $(git rev-list --all)
```

Druhy prikaz by nemel vypsat nic.

## Styl prace

- CommonJS `require/module.exports`, ne ESM.
- Bez zbytecnych automatickych akci po loginu/spawnu krom lobby transferu a explicitne nakonfigurovaneho reconnectu.
- Novou funkcionalitu davat do `src/features/` nebo `src/commands/` podle typu.
- Pri upravach nejdriv zkontrolovat syntaxi:

```bash
node --check bot.js
find src -name '*.js' -print0 | xargs -0 -n1 node --check
```
