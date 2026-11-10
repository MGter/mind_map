# mind_map · Talk Map

English | [中文](README.zh.md)

A visual conversation map plugin for DeepSeek Harness (dsh): every session becomes a card on an infinite whiteboard.

> Derived from [Tasihi89/mind_map](https://github.com/Tasihi89/mind_map) (MIT). This repository is a heavily reworked fork: slot layout, resizable workspaces, the overflow drawer and the routed links are additions or rewrites here.

![Workspaces, pinned cards and live status](https://raw.githubusercontent.com/Da0Mine/dsh-talk-map/main/docs/screenshots/workspaces-and-pins.png)

![Cards connected by links, with running / waiting / unread lamps](https://raw.githubusercontent.com/Da0Mine/dsh-talk-map/main/docs/screenshots/cards-and-links.png)

- **Spatial memory instead of working memory**: free placement + grid snapping, and nothing ever rearranges your cards — if you remember "that conversation was bottom-left", it stays bottom-left. Designed for ADHD users, useful for everyone.
- **Folders stay readable**: a workspace becomes a frame that auto-expands or folds its overflow into a stack cell you can open as a drawer; pinned cards stay in front.
- **Double-click to chat**: double-click empty canvas to start a new session; the card is born exactly where you clicked.
- **Draw an edge to fork**: drag a line from a card onto empty space, preview (and edit) the context digest to inject, confirm — a new session starts *knowing* the old conversation.
- **Card front = resume surface**: title, the last thing you said, relative time and a status lamp (running / finished / unread / waiting / interrupted). One glance tells you what to do next.
- **Lines mean something**: a link whose context is still up to date disappears; one that has fallen behind stays visible as a dashed line with an arrow. Fork lineage is always drawn.
- **Automatic digests**: a three-field digest (summary / key findings / next step) is generated on demand through your deployment's default model; hit ⟳ on a card to regenerate.
- **Bilingual interface**: the map's own copy renders in Chinese or English. The pill in the map header cycles Auto → 中文 → English; Auto follows dsh's own language, and the choice is remembered across restarts.

- **Status rail**: a collapsible strip on the left edge lists only the cards that carry a lamp (running / waiting / unread / interrupted). A card whose status changes jumps to the top, the order is yours to drag, a card that settles drops out, and the rail remembers whether you left it open.

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
