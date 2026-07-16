# Mineflayer bot

Node.js Mineflayer bot s konzolovymi prikazy, automatickym prepojenim z lobby, continuous mining a volitelnym Prismarine viewerem.

## Prvni nastaveni

```bash
npm ci
cp .env.example .env
nano .env
```

Minimalne nastav prihlasovaci jmeno:

```env
MC_USERNAME=tvuj@email.cz
```

`.env` obsahuje soukromou lokalni konfiguraci a nesmi se commitovat. Verzovany `.env.example` je aktualni a uplny seznam podporovanych promennych.

## Spusteni

```bash
npm start
```

## Konzolove prikazy

- `help` - vypis prikazu
- `status` - stav bota
- `pos` - pozice
- `say <text>` - rucne posle zpravu do Minecraft chatu
- `lobby` - rucni prepojeni z lobby
- `lobby force` - prepojeni bez kontroly Y/IP
- `slot <0-8>` - vybere hotbar slot
- `held` - item v ruce
- `use` - pouzije item v ruce
- `mine start` - spusti continuous mining bloku pod kurzorem
- `mine stop` - zastavi continuous mining
- `mine status` - vypise stav a statistiky tezby
- `viewer status` - stav weboveho vieweru
- `viewer start [port]` - spusti viewer, napr. `http://localhost:3000`
- `viewer stop` - zastavi viewer
- `quit` - ukonci bota

Bot sam od sebe neposila zpravy do Minecraft chatu. Chat pouziva pouze explicitni konzolovy prikaz `say <text>`.

## Continuous mining

Bot musi mit pri `mine start` v ruce krumpac. Smer pohledu se po dobu tezby zamkne.

Vychozi konfigurace:

```env
MINING_INSTANT_BLOCK_DELAY_MS=50
MINING_NEXT_BLOCK_DELAY_MS=250
MINING_TRACE=false
MINING_TRACE_FOLDER=./logs
```

Packetovy JSONL trace lze pro diagnostiku zapnout v `.env` nebo jednorazove:

```bash
MINING_TRACE=true MC_KEEPALIVE_TIMEOUT_MS=600000 npm start
```

`logs/` je ignorovany. Trace muze obsahovat username, souradnice a serverovou packetovou aktivitu, proto jej pred sdilenim anonymizuj.

## Konfigurace

Vsechny podporovane promenne a jejich vychozi hodnoty jsou v [`.env.example`](./.env.example). Konfigurace je rozdelena na:

- Minecraft pripojeni a Microsoft autentizaci,
- automaticky lobby transfer,
- continuous mining a diagnosticky trace,
- Prismarine viewer.

Znamy `packet_world_particles` protocol spam je standardne skryty pres:

```env
MC_HIDE_PROTOCOL_ERRORS=true
```

Pro protocol debugging jej lze docasne zapnout:

```bash
MC_HIDE_PROTOCOL_ERRORS=false npm start
```
