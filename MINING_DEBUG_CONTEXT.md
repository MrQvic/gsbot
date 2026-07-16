# Vulcan / continuous mining – stručné zjištění

## Co je ověřené

- Bot má napodobit držení levého tlačítka u rychle se obnovující řady bloků.
- Bez prodlevy ho Vulcan vykopl asi 4 sekundy po `mine start`.
- Po přidání 250ms prodlevy mezi úspěšnými bloky ho vykopl znovu asi po 6 sekundách.
- V obou případech server uvedl pouze obecný důvod:

  ```text
  [Vulcan] Unfair Advantage
  ```

- Samotná 250ms prodleva tedy problém nevyřešila. Zpráva ale neobsahuje název checku ani violation level, takže z ní nelze určit skutečnou příčinu.
- Při těchto dvou pokusech ještě neběžel packetový trace. Nemáme proto důkaz, zda šlo o `FastBreak`, `Reach`, nesoulad rotace/face, pořadí packetů (`BadPackets`) nebo zachovaný violation level.
- Aktuální raycast používá `MAX_REACH = 5.1`; proti běžnému survival reach 4.5 je to podezřelé místo k ověření, nikoli potvrzená příčina kicku.

## Co jsme upravili

- Příkazy: `mine start`, `mine stop`, `mine status`.
- Směr těžby se při startu zamkne, aby rotace provedená během kopání neposunula další cíl na konstrukci generátoru.
- `bot.lookAt` je během těžby potlačený, ale `bot.dig()` dostává přesný face ze zamčeného raycastu.
- Bližší obnovený blok okamžitě přeruší vzdálenější cíl.
- Výchozí post-break prodleva je 250 ms (`MINING_NEXT_BLOCK_DELAY_MS`).
- Vlastní raycast obchází Mineflayer chybu, při které nulový yaw nebo pitch vrací `null`.
- Lokální workaround normalizuje Efficiency enchanty pro výpočet času kopání.

## Diagnostika pro další pokus

Opt-in JSONL trace se zapne takto:

```bash
MINING_TRACE=true MC_KEEPALIVE_TIMEOUT_MS=600000 npm start
```

Po `mine start` vznikne ignorovaný soubor `logs/mining-<timestamp>-<username>.jsonl`. Obsahuje cíle, face, vzdálenosti, plánované a skutečné časy, retarget/abort/complete události a relevantní příchozí i odchozí packety včetně `block_dig`, animace ruky, pohybu, rotace a kicku.

Další rozumný krok je jeden kontrolovaný test s trace a rozbor posledních sekund před kickem. Ideální je staging se stejnou konfigurací serveru; lokální Vulcan vyžaduje Paper/Spigot, PacketEvents a legálně získaný Vulcan JAR. Bot nesmí mít OP ani bypass a punishment je vhodné nahradit verbose/alerts logováním.

`MC_KEEPALIVE_TIMEOUT_MS=600000` pouze obchází zvláštní keepalive chování lokálního LAN testu; není to definitivní oprava keepalive.
