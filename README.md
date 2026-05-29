# Mineflayer bot

Prvni nastaveni:

```bash
cp .env.example .env
nano .env
```

Spusteni:

```bash
npm start
```

Po spusteni lze psat prikazy do konzole:

- `help` - vypis prikazu
- `status` - stav bota
- `pos` - pozice
- `say <text>` - rucne posle zpravu do MC chatu
- `lobby` - rucni prepojeni z lobby
- `lobby force` - prepojeni bez kontroly Y/IP
- `slot <0-8>` - vybrat hotbar slot
- `held` - item v ruce
- `use` - pouzit item v ruce
- `quit` - konec

Konfigurace je v `.env`:

```bash
MC_HOST=mc.goldskyblock.cz
MC_PORT=25565
MC_USERNAME=tvuj@email.cz
MC_AUTH=microsoft
MC_PROFILES_FOLDER=./aut_cache
MC_VERSION=1.21.11 # nebo auto pro mineflayer autodetekci
MC_HIDE_PROTOCOL_ERRORS=true # schova znamy spam z packet_world_particles

LOBBY_AUTO=true
LOBBY_REMOTE_ADDRESS=185.180.2.13
LOBBY_Y=112
LOBBY_SELECTOR_SLOT=4
LOBBY_SELECTOR_ITEM=nether_star
LOBBY_SELECTOR_NAME="Výběr serveru"
LOBBY_MENU_SLOT=11
LOBBY_MOUSE_BUTTON=1
LOBBY_CLICK_MODE=0
LOBBY_SUCCESS_MESSAGE="+ TvojeJmeno"
```
