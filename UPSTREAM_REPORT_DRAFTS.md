# Upstream issue / PR drafts

Prepared from local testing on 2026-07-16. Review before posting. Do not attach raw trace files: they contain the bot username, world coordinates, and server-specific packet activity.

Tested stack:

```text
mineflayer 4.37.1
prismarine-block 1.23.0
minecraft-data 3.110.2
Minecraft Java 1.21.11 (protocol 774)
Node.js 22.22.3
```

## 1. Mineflayer #3800 — missing `tick_end`

Issue: https://github.com/PrismarineJS/mineflayer/issues/3800

Suggested comment:

> Confirmed on Mineflayer 4.37.1 with Minecraft Java 1.21.11 (protocol 774), this time against a server using Vulcan rather than Grim.
>
> In controlled packet traces without `tick_end`, continuous digging was kicked reproducibly:
>
> - 46 `block_dig` packets / 23 completed blocks / kick at 5.64 s
> - after matching vanilla instant-break packets, 45 `block_dig` packets / 44 completed blocks / kick at 10.97 s
>
> The server only reported a generic `[Vulcan] Unfair Advantage`, so I cannot identify the exact Vulcan check. Adding a `tick_end` every 50 ms while mining removed the kicks:
>
> - 163.18 s, 1,729 completed blocks, 3,258 `tick_end` packets, no kick
> - 268.10 s, 2,231 completed blocks, 5,349 `tick_end` packets, no kick
>
> That is approximately 19.96 `tick_end` packets/s. The mining actions are processed before the corresponding `tick_end` packet.
>
> One implementation caveat: blindly running the interval through a proxy/backend handoff caused a decoder error in this setup. Scoping it to the active PLAY/tick lifecycle (rather than an unconditional connection-wide interval) avoided that problem.

Supporting local traces (do not upload without sanitizing):

```text
logs/mining-2026-07-16T17-46-13-730Z-*.jsonl
logs/mining-2026-07-16T17-53-02-803Z-*.jsonl
logs/mining-2026-07-16T19-25-47-596Z-*.jsonl
logs/mining-2026-07-16T19-30-53-260Z-*.jsonl
```

## 2. Mineflayer #3627 — interaction sequence

Issue: https://github.com/PrismarineJS/mineflayer/issues/3627

Suggested comment:

> Still reproducible on Mineflayer 4.37.1 / Minecraft 1.21.11.
>
> Without a workaround, Mineflayer omitted `sequence` from `block_dig`; the serializer encoded it as `0`, and all server acknowledgements used `sequenceId=0`. In one trace, all 46 START/STOP packets had sequence 0.
>
> A connection-wide interaction counter produced the expected increasing values (`1..46` in the same test), and the server acknowledged the final `sequenceId=46`.
>
> The vanilla-compatible behavior used in the workaround is:
>
> - increment for `block_dig` START (`status=0`) and STOP (`status=2`)
> - use sequence `0` for ABORT (`status=1`)
> - share the same counter with `block_place` and `use_item`
> - start at 0, making the first predicted interaction sequence 1
> - reset on login and when the world/dimension identity changes, not on an ordinary same-world teleport
>
> The missing sequence was a real protocol mismatch, although fixing it alone did not resolve the separate missing-`tick_end` anti-cheat failure.

Supporting local trace:

```text
logs/mining-2026-07-16T17-46-13-730Z-*.jsonl
```

## 3. Mineflayer #2208 — STOP sent after instant break

Issue: https://github.com/PrismarineJS/mineflayer/issues/2208

Suggested comment:

> Confirmed that this is still present in Mineflayer 4.37.1 on Minecraft 1.21.11.
>
> For `bot.digTime(block) === 0`, Mineflayer sends START and then STOP roughly 1 ms later. Vanilla 1.21.11 destroys the block from the initial START and does not send STOP for that block.
>
> In a packet trace, replacing Mineflayer's instant branch with START-only changed 43 instant attempts from START+STOP to START-only. This also delayed an anti-cheat kick from 23 completed blocks / 5.64 s to 44 completed blocks / 10.97 s. The main anti-cheat problem was ultimately missing `tick_end`, but the extra STOP is independently observable and differs from vanilla.

Supporting local traces:

```text
logs/mining-2026-07-16T17-46-13-730Z-*.jsonl
logs/mining-2026-07-16T17-53-02-803Z-*.jsonl
```

## 4. Mineflayer #3921 — wrong material/tool speed lookup

Issue: https://github.com/PrismarineJS/mineflayer/issues/3921

Suggested comment:

> Confirmed on the currently installed Mineflayer 4.37.1 / prismarine-block 1.23.0 / minecraft-data 3.110.2 stack for Minecraft 1.21.11.
>
> With a netherite pickaxe, Efficiency VI, and Haste II:
>
> | Block | Before workaround | Expected / after workaround |
> |---|---:|---:|
> | `copper_ore` | 3250 ms | 100 ms |
> | `gold_ore` | 3250 ms | 100 ms |
> | `redstone_ore` | 3250 ms | 100 ms |
> | `ancient_debris` | 32150 ms | 700 ms |
>
> The affected blocks use `material: incorrect_for_wooden_tool`, whose multiplier table does not contain the netherite pickaxe ID. `harvestTools` correctly allows the pickaxe, but prismarine-block falls back to speed 1 and therefore does not apply Efficiency.
>
> PrismarineJS/minecraft-data-generator#71 has since been merged, but the published dependency stack tested above still contains the affected generated data.

Related:

- https://github.com/PrismarineJS/minecraft-data/issues/987
- https://github.com/PrismarineJS/minecraft-data-generator/pull/71
- https://github.com/PrismarineJS/prismarine-block/pull/123

## 5. prismarine-block PR #123 — false fallback for hand-harvestable blocks

PR: https://github.com/PrismarineJS/prismarine-block/pull/123

Suggested review comment:

> I tested this fallback approach against prismarine-block 1.23.0 / minecraft-data 3.110.2 on Minecraft 1.21.11. It fixes the restricted pickaxe blocks, but the current `canHarvest()` guard also creates a false positive for blocks with no `harvestTools` map.
>
> `glowstone` is an example:
>
> - `material` is `default`
> - `harvestTools` is undefined
> - `canHarvest(netheritePickaxeId)` returns true because the block is harvestable by hand
> - the proposed fallback therefore selects `mineable/pickaxe`
>
> With a netherite pickaxe, Efficiency VI, and Haste II, this changes glowstone from the correct 350 ms to an incorrect instant break (`0 ms`). In a live trace, the bot then sent START-only 408 times while the server kept restoring/rejecting the glowstone.
>
> Requiring the held tool to be explicitly present in `harvestTools` avoids this:
>
> ```js
> if (!block.harvestTools?.[heldItemType]) {
>   return materialToolMultipliers
> }
> ```
>
> With that guard, copper/gold/redstone ore remain 100 ms, ancient debris remains 700 ms, and glowstone remains 350 ms in the tested setup.

## 6. Potential new issue — vanilla progress retention through instant blockers

This needs maintainer/API triage before posting. Mineflayer's `bot.dig(block)` API targets one block and does not itself implement held-left-click retargeting, so this may be better presented as a missing vanilla behavior or as feedback on the modern digging rewrite rather than an unconditional bug.

Possible title:

```text
Digging progress is lost when an instant-mined block temporarily replaces the crosshair target
```

Related PR: https://github.com/PrismarineJS/mineflayer/pull/3930

Suggested issue body:

> ## Versions
>
> - Mineflayer: 4.37.1
> - Minecraft: Java 1.21.11
> - Node.js: 22.22.3
>
> ## Scenario
>
> Hold continuous mining on a non-instant target while a piston repeatedly inserts blocks closer to the player on the same view ray. Most inserted blocks are instant-mined with the held tool; some are not.
>
> With ancient debris as the persistent target (`digTime=700 ms`), a trace using the existing stop/restart behavior produced:
>
> - 163 START attempts on the same ancient debris
> - 163 ABORTs
> - 0 completions
> - longest uninterrupted attempt: 604 ms
> - more than 51 seconds of cumulative active mining time
>
> Each retarget clears Mineflayer's timer/progress, so the original block can never finish if an instant blocker arrives more often than its full dig time.
>
> ## Vanilla 1.21.11 behavior
>
> Vanilla has a narrow progress-retention case. When the current target changes, `startDestroyBlock()` sends ABORT for the old target. If the new target breaks on its initial hit, the instant branch destroys it but does not replace `destroyBlockPos`, `destroyProgress`, or `destroyTicks`. On the next tick, the old target resumes without another START. A non-instant replacement does reset the old progress.
>
> Packet flow for an instant blocker:
>
> ```text
> START original
> ABORT original
> START instant blocker
> # no second START for original
> STOP original after the retained progress reaches 100%
> ```
>
> Relevant vanilla 1.21.11 decompiled source:
>
> - `startDestroyBlock`: https://github.com/youxuezhe7/minecraft-1.21.11-sources/blob/6c4ae196dfb206712884be5950d9ad726fcbab0e/net/minecraft/client/multiplayer/MultiPlayerGameMode.java#L147-L199
> - `continueDestroyBlock`: https://github.com/youxuezhe7/minecraft-1.21.11-sources/blob/6c4ae196dfb206712884be5950d9ad726fcbab0e/net/minecraft/client/multiplayer/MultiPlayerGameMode.java#L221-L284
>
> ## Workaround validation
>
> A local tick-based implementation retained progress only across truly instant blockers and reset it for non-instant blockers. In a 268.10-second trace it completed 2,231 blocks with:
>
> - 178 retained-progress interruptions
> - 27 progress resets for non-instant blockers
> - ancient debris successfully completed
> - no errors and no anti-cheat kick
>
> The open modern digging rewrite in #3930 makes progress tick-based, but `stopDigging()` still discards the current progress. It may be a useful base for supporting this vanilla edge case.

Supporting local traces:

```text
# Failure before workaround
logs/mining-2026-07-16T18-51-38-216Z-*.jsonl

# Successful retained-progress run
logs/mining-2026-07-16T19-25-47-596Z-*.jsonl
```

## Posting checklist

Before posting:

1. Re-check each issue/PR state for newer fixes or duplicate reports.
2. Confirm the current latest npm versions; do not call the tested versions "latest" without checking.
3. Remove local file paths from final comments unless maintainers ask for sanitized traces.
4. Do not include usernames, coordinates, server address, authentication details, or raw logs.
5. For the potential new issue, decide whether it belongs as a standalone issue or as scoped feedback on Mineflayer PR #3930.
