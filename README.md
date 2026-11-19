# mind_map · Talk Map

English | [中文](README.zh.md)

A visual conversation map plugin for DeepSeek Harness (dsh): **one session is one dot**, and all sessions form a force-balanced cloud.

> Derived from [Tasihi89/mind_map](https://github.com/Tasihi89/mind_map) (MIT). This repository is a heavily reworked fork.
> **2026-11-19 rework: the card whiteboard (slot layout, workspace frames, overflow drawer, card links) is gone. Only the cloud remains.**

- **One dot per session** — like Obsidian's graph view. Nothing but dots until you **hover one, which reveals that session's title** (drawn in screen space, so it stays legible at any zoom).
- **More links, bigger dot** — the radius is a pure function of degree (`r = 1.7 + 1.3·√degree`, capped at 11px), so hubs stand out immediately.
- **Keywords are nodes too** — every tag is a hollow blue "key" ring that sessions connect to, so a keyword used by many sessions becomes a big hub. Hover reads `#tag · N sessions`; click pins it (it and its sessions stay lit).
- **Three relations, three colours** — same workspace (cool grey), shared tag (blue, via those key nodes), subagent / fork lineage (warm amber).
- **Repulsion plus a hard core, so dots never overlap** — a continuous force simulation pushes every pair apart, and two circles keep a fixed gap; a final geometric pass de-overlaps right before the layout is persisted.
- **A running session pulses slowly** — a breathing halo with a ~3 s period, not a strobe.
- **Hover highlight and spotlight** — hovering keeps the dot and its direct neighbours bright, dims the rest and thickens its links; 「聚焦」 lights only the current session and fades everything else.
- **Double-click empty canvas to chat**; **shift-drag out of a dot** to draw a rubber band, preview (and edit) the context digest to inject, and fork a session that starts knowing the old conversation.
- **On-demand digests and tags** — a three-field digest (summary / key findings / next step) is generated through your deployment's default model; the toolbar's 🏷 button batch-generates tags for sessions that have none (tags are the blue links).
- **Archived sessions can be hidden** (default) or shown greyed out; the toggle is remembered per browser.
- **Status rail** — a collapsible strip on the left edge lists only sessions carrying a lamp (running / waiting / unread / interrupted); clicking one eases the camera onto its dot.
- **Bilingual interface**: the map's own copy renders in Chinese or English. The pill in the map header cycles Auto → 中文 → English; Auto follows dsh's own language, and the choice is remembered across restarts.

## Install

```sh
# npm (recommended)
dsh plugin add mind_map

# or straight from GitHub — built artifacts are committed, so there is no build step
dsh plugin add github:Da0Mine/dsh-talk-map
```

Restart `dsh web`; a map button appears at the sidebar foot.

## Usage

| Action | Effect |
|---|---|
| Sidebar map button / Esc | toggle the map |
| Drag a card | place it (16px grid snap, persisted) |
| Double-click empty space | create a session there and enter it |
| Double-click a card | open that session |
| Drag from a card handle to empty space | preview injection → fork a new session |
| Click a stack cell | open the drawer listing the folded conversations |
| ⟳ on a card | regenerate the digest |
| Right-click a card / a line / a folder | pin, rename, mark unread, archive, delete, push switch, delete line |
| Language pill in the map header | cycle Auto → 中文 → English |

## Where data lives

- Canvas data (positions, edges, digests): `$DSH_HOME/storages/mind_map.json` via dsh's official storage-domain, atomically persisted.
- Sessions themselves stay fully owned by dsh — this plugin reads them, and creates new ones only through official APIs when forking.
- Digests use your configured default model through dsh's local LLM channel; there are no other external requests.

## Compatibility

Built and tested against DeepSeek Harness `0.2.1-rc.3`. The structural contracts live in `src/client/dsh.ts` and `src/host/dsh-host.ts` — start there when upgrading.

## Roadmap

Multi-board shelf (project = board, WIP limit) · whole-board archive/shelve · timeline view (camera fly-back) · alias cards · multi-parent merge UI · selection-level injection · quick-ask on card.

## Development

```sh
pnpm install
pnpm run build        # host → lib/, client → client/client.js
pnpm run probe        # headless end-to-end probe (150 checks)
dsh plugin --profile dev add /abs/path/mind_map
```

MIT License.
