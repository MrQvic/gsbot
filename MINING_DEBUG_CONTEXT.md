# Continuous mining – final debug handoff

## Current status

Continuous mining is working on Minecraft Java 1.21.11 with the tested server setup:

- no observed Vulcan kick after the `tick_end` fix,
- correct Efficiency/Haste times for restricted pickaxe blocks,
- correct START-only packet for instant breaks,
- separate 50 ms instant and 250 ms non-instant post-break delays,
- vanilla-style progress retention when an instant block temporarily obstructs a slower target,
- glowstone and other non-instant blockers still reset the previous target as vanilla does.

Two final validation traces:

```text
logs/mining-2026-07-16T19-25-47-596Z-MrKvic_.jsonl
268.10 s, completed=2231, aborted=200, retargets=200, errors=0, kicks=0
retained progress=178, discarded progress=27, tick_end=5349

logs/mining-2026-07-16T19-30-53-260Z-MrKvic_.jsonl
163.18 s, completed=1729, aborted=4, retargets=4, errors=0, kicks=0
tick_end=3258
```

The user also confirmed interactively that ancient debris now completes correctly through piston-fed instant blockers.

## Implemented protocol fixes

### Interaction sequence

`src/features/interactionSequence.js` adds the prediction sequence omitted by Mineflayer 4.37.1:

- `block_dig` START (`status=0`) and STOP (`status=2`) increment it,
- ABORT and other dig statuses use sequence `0`,
- `block_place` and `use_item` share the same counter,
- reset occurs on login and world/dimension identity change.

Before the fix, missing values serialized as `0`; a 46-packet trace received only `sequenceId=0` acknowledgements. After the fix, the sequence increased `1..46` and the server acknowledged `46`.

### Instant mining packets

For `plannedDigTimeMs === 0`, `src/features/continuousMining.js` now matches vanilla:

```text
START + arm animation + local air prediction
```

It does not send STOP. Non-instant targets use START and later STOP.

### Client tick boundaries

`src/features/clientTickEnd.js` runs the mining tick and then sends `tick_end` every 50 ms on protocol 1.21.2+.

The timer only runs during active continuous mining. An earlier connection-wide attempt sent it through a proxy/backend handoff and caused a decoder error. Mining-only lifecycle handling avoids that problem.

Without `tick_end`, controlled runs were kicked after approximately 45–46 `block_dig` packets. Final successful traces sent approximately 19.96 `tick_end` packets/s.

## Correct dig-time calculation

The installed stack is:

```text
mineflayer 4.37.1
prismarine-block 1.23.0
minecraft-data 3.110.2
```

Some 1.21.11 blocks with explicit pickaxe tier requirements incorrectly use material `incorrect_for_wooden_tool`. That material table lacks higher-tier pickaxe speed multipliers, so prismarine-block falls back to speed 1 and fails to apply Efficiency.

`continuousMining.js` temporarily falls back to `mineable/pickaxe` only when the held tool is explicitly present in the block's `harvestTools`. This restriction is important: checking only `canHarvest()` incorrectly treats hand-harvestable blocks such as glowstone as pickaxe-effective.

Validated times with netherite pickaxe, Efficiency VI, and Haste II:

| Block | Time |
|---|---:|
| stone / basalt / blackstone / netherrack | 0 ms |
| copper/gold/redstone ore | 100 ms |
| deepslate variants | 150 ms |
| glowstone | 350 ms |
| ancient debris | 700 ms |

Before normalization, copper/gold/redstone took 3250 ms and ancient debris took 32150 ms. The first overly broad workaround made glowstone incorrectly instant; the explicit `harvestTools` guard fixed it.

Modern item enchantment components are also temporarily normalized to the `{ name, lvl }` structure expected by the installed dig-time code. All temporary mutations are restored immediately after calculation.

## Vanilla retained-progress behavior

A five-block row is replenished by pistons. A slow target such as ancient debris can be temporarily hidden by a newly inserted closer block.

The old implementation called `bot.stopDigging()` on every retarget. In the failure trace:

```text
logs/mining-2026-07-16T18-51-38-216Z-MrKvic_.jsonl
ancient debris starts=163, aborts=163, completions=0
planned time=700 ms, longest uninterrupted attempt=604 ms
cumulative failed mining time >51 s
```

Vanilla 1.21.11 has a narrow exception:

1. It sends ABORT for the original slow target.
2. If the closer target breaks on its initial hit, it sends START for that instant target but retains the original target and progress.
3. It resumes the original target without another START.
4. It eventually sends STOP for the original target.
5. A non-instant closer target resets the old progress normally.

The implemented packet flow is therefore:

```text
START original
ABORT original
START instant blocker
# no repeated START for original
STOP original after the remaining active mining ticks
```

Non-instant digging progress is advanced on the same 50 ms callback that precedes `tick_end`. Retained state is discarded if the original block changes/disappears, the held tool no longer matches, mining stops, the player dies, or the world changes.

Relevant trace fields:

```text
dig_progress_retained
dig_progress_discarded
dig_start.resumed
dig_start.remainingDigTicks
dig_start.remainingDigTimeMs
retarget.progressRetained
```

## Configuration

```env
MINING_INSTANT_BLOCK_DELAY_MS=50
MINING_NEXT_BLOCK_DELAY_MS=250
MINING_TRACE=false
MINING_TRACE_FOLDER=./logs
```

Tracing can be enabled with:

```bash
MINING_TRACE=true MC_KEEPALIVE_TIMEOUT_MS=600000 npm start
```

`logs/` is ignored. Raw traces contain usernames, coordinates, and server-specific activity and should not be uploaded without sanitization.

## Remaining caveats

- `MAX_REACH = 5.1` is still higher than normal survival reach (4.5). Observed targets were within valid range, so it did not explain the original kicks.
- The exact Vulcan check is unknown because the server only reported `[Vulcan] Unfair Advantage`.
- The fixes are local compatibility workarounds for the tested dependency versions, not upstream library fixes.
- The retained-progress implementation intentionally preserves progress only across actual instant blockers; it is not a generic cache of interrupted digs.
- The bot still must not send Minecraft chat automatically. No mining code calls `bot.chat(...)`.

## Upstream follow-up

Ready-to-review issue and PR comment drafts are in:

```text
UPSTREAM_REPORT_DRAFTS.md
```

They cover Mineflayer issues #3800, #3627, #2208, #3921, prismarine-block PR #123, and a potential new issue for vanilla retained progress.

## Validation commands

```bash
node --check bot.js
find src -name '*.js' -print0 | xargs -0 -n1 node --check
git diff --check
```
