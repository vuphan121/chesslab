from __future__ import annotations

import html
import json
import os
from collections import Counter
from pathlib import Path
from typing import Any

from .labels import label_from_text
from .matcher import _infer_label
from .models import Position, TextBlock


def _load_json(path: str | Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _relative_asset(path: str, output_path: Path) -> str:
    return Path(os.path.relpath(Path(path).resolve(), output_path.parent.resolve())).as_posix()


def _reference_items(path: str | Path | None) -> dict[str, list[dict[str, str]]]:
    if not path:
        return {}
    book = _load_json(path)
    items: dict[str, list[dict[str, str]]] = {}
    for chapter in book.get("chapters", []):
        for item in chapter.get("items", []):
            placement = item["fen"].split()[0]
            items.setdefault(placement, []).append({
                "id": item["id"], "turn": item["sideToMove"], "chapter": str(chapter.get("number", "?")),
            })
    return items


def _review_decisions(path: str | Path | None) -> dict[str, dict[str, Any]]:
    if not path:
        return {}
    value = _load_json(path)
    records = value.get("decisions", []) if isinstance(value, dict) else value
    if not isinstance(records, list):
        raise ValueError("review decisions must be a list or an object with a decisions list")
    return {str(record["id"]): record for record in records if isinstance(record, dict) and record.get("id")}


def _classes(*values: str) -> str:
    return " ".join(value.replace("_", "-") for value in values if value)


def build_review_report(
    positions_path: str | Path,
    layout_path: str | Path,
    links_path: str | Path,
    output_path: str | Path,
    recognition_path: str | Path | None = None,
    reference_book_path: str | Path | None = None,
    decisions_path: str | Path | None = None,
) -> dict[str, int]:
    """Write one self-contained HTML index that references local crop images.

    The report intentionally leaves all source-derived content beside the
    ignored work artefacts. It is a review aid, not an importer.
    """
    output = Path(output_path)
    raw_positions = _load_json(positions_path)
    positions = [Position.from_json(value) for value in raw_positions]
    blocks = [TextBlock.from_json(value) for value in _load_json(layout_path)]
    links = {value.get("position_id") or value.get("positionId"): value for value in _load_json(links_path)}
    recognition = _load_json(recognition_path) if recognition_path else {}
    reference = _reference_items(reference_book_path)
    decisions = _review_decisions(decisions_path)
    block_by_id = {block.id: block for block in blocks if block.id}

    cards: list[str] = []
    counts: Counter[str] = Counter()
    for position, raw_position in zip(positions, raw_positions, strict=True):
        inferred, inference_reason = _infer_label(position, blocks)
        link = links.get(position.id, {})
        status = link.get("status", "unmatched")
        recognized = recognition.get(position.id)
        matched_items = reference.get(recognized, []) if isinstance(recognized, str) else []
        board_status = "saved_match" if matched_items else "extra_or_misread"
        if recognition_path and not isinstance(recognized, str):
            board_status = "recognition_error"

        expected_turns = {item["turn"] for item in matched_items}
        if not expected_turns:
            turn_status = "not_compared"
        elif inferred.side_to_move is None:
            turn_status = "turn_unknown"
        elif inferred.side_to_move in expected_turns:
            turn_status = "turn_correct"
        else:
            turn_status = "turn_wrong"
        counts.update([board_status, status, turn_status])

        context_ids = link.get("text_block_ids") or link.get("textBlockIds") or []
        if not context_ids and link.get("text_block_id"):
            context_ids = [link["text_block_id"]]
        context = [block_by_id[block_id].text for block_id in context_ids if block_id in block_by_id]
        candidate_text = [candidate.get("text", "") for candidate in link.get("candidates", [])]
        pieces = recognized if isinstance(recognized, str) else f"Recognition error: {(recognized or {}).get('error', 'not run')}"
        reference_text = ", ".join(item["id"] for item in matched_items) or "No exact saved FEN match"
        label = inferred.label or "unlabelled"
        label_note = f" ({inference_reason})" if inference_reason else ""
        crop_path = raw_position.get("cropPath")
        crop = _relative_asset(str(crop_path), output) if crop_path else ""
        image = f'<img src="{html.escape(crop)}" alt="{html.escape(position.id)} board crop">' if crop else '<div class="missing-image">No crop</div>'
        text_html = "<br>".join(html.escape(value) for value in context) or "No selected text blocks"
        candidates_html = "<br>".join(html.escape(value) for value in candidate_text) or "None"
        decision = decisions.get(position.id, {})
        decision_value = str(decision.get("decision", "unreviewed"))
        corrected_fen = str(decision.get("piecePlacement", ""))
        corrected_turn = str(decision.get("sideToMove", ""))
        selected_blocks = ", ".join(decision.get("textBlockIds", context_ids))
        notes = str(decision.get("notes", ""))
        default_text_ids = ", ".join(context_ids)
        cards.append(f'''<article class="card {_classes(board_status, status, turn_status, f"review_{decision_value}")}" data-id="{html.escape(position.id)}" data-default-text-block-ids="{html.escape(default_text_ids)}">
  <div class="image">{image}</div>
  <div class="body">
    <header><strong>{html.escape(position.id)}</strong><span>Page {position.page} · {html.escape(label)}{html.escape(label_note)}</span></header>
    <dl>
      <dt>Board</dt><dd>{html.escape(board_status.replace('_', ' '))}</dd>
      <dt>Saved item</dt><dd>{html.escape(reference_text)}</dd>
      <dt>Turn</dt><dd>{html.escape(inferred.side_to_move or 'unknown')} · {html.escape(turn_status.replace('_', ' '))} · {html.escape(str(raw_position.get('turnConfidence', 'n/a')))}</dd>
      <dt>Link</dt><dd>{html.escape(status)} · {html.escape('; '.join(link.get('reasons', [])) or 'no reason')}</dd>
      <dt>Pieces</dt><dd class="fen">{html.escape(pieces)}</dd>
    </dl>
    <details open><summary>Selected text ({len(context)})</summary><p>{text_html}</p></details>
    <details><summary>Alternative text candidates</summary><p>{candidates_html}</p></details>
    <details class="review" open><summary>Review decision</summary>
      <div class="review-grid"><label>Decision<select class="decision"><option value="unreviewed">Unreviewed</option><option value="approved">Approve as-is</option><option value="corrected">Approve with corrections</option><option value="excluded">Exclude from Study</option></select></label>
      <label>Correct piece placement<input class="piece-placement" value="{html.escape(corrected_fen)}" placeholder="rnbqkbnr/... (optional)"></label>
      <label>Correct turn<select class="side-to-move"><option value="">Keep detected</option><option value="w">White</option><option value="b">Black</option></select></label>
      <label>Text block IDs<input class="text-block-ids" value="{html.escape(selected_blocks)}" placeholder="p011-t0023, p011-t0025"></label></div>
      <label class="notes">Notes<textarea placeholder="Why this is approved, corrected, or excluded">{html.escape(notes)}</textarea></label>
    </details>
  </div>
</article>''')

    summary = " · ".join(f"{key.replace('_', ' ')}: {value}" for key, value in sorted(counts.items()))
    initial_decisions = json.dumps(list(decisions.values())).replace("</", "<\\/")
    document = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Textbook parser review</title><style>
* {{ box-sizing: border-box; }} body {{ margin: 0; font: 15px/1.5 system-ui, sans-serif; background: #f1f1ed; color: #202124; }}
main {{ max-width: 1920px; margin: auto; padding: 30px; }} h1 {{ margin: 0; }} .summary {{ color: #5f6368; margin: 5px 0 18px; }}
.toolbar, .filters {{ display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 18px; }} button {{ border: 1px solid #bbb; border-radius: 5px; background: white; padding: 7px 10px; cursor: pointer; }} button.active {{ background: #1a73e8; color: white; border-color: #1a73e8; }} .toolbar span {{ color: #5f6368; align-self: center; }}
.grid {{ display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }} .card {{ display: grid; grid-template-columns: minmax(340px, 48%) minmax(0, 1fr); background: white; border: 1px solid #d2d2cf; border-radius: 10px; overflow: hidden; }}
.card.hidden {{ display: none; }} .image {{ background: #ddd; align-self: start; padding: 10px; }} img {{ width: 100%; height: auto; max-height: none; object-fit: contain; display: block; }} .body {{ padding: 18px; min-width: 0; }}
header {{ display: flex; justify-content: space-between; gap: 10px; margin-bottom: 10px; }} header span {{ color: #5f6368; text-align: right; }} dl {{ display: grid; grid-template-columns: 70px 1fr; gap: 4px 10px; margin: 0 0 10px; }} dt {{ font-weight: 650; color: #555; }} dd {{ margin: 0; overflow-wrap: anywhere; }} .fen {{ font: 11px/1.35 ui-monospace, monospace; }} details {{ border-top: 1px solid #eee; padding: 7px 0; }} summary {{ cursor: pointer; font-weight: 600; }} p {{ margin: 6px 0 0; white-space: normal; }} .review-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }} label {{ display: grid; gap: 3px; font-weight: 600; color: #50545a; }} input, select, textarea {{ width: 100%; font: inherit; padding: 5px; border: 1px solid #babec5; border-radius: 4px; background: #fff; color: #202124; }} textarea {{ min-height: 58px; resize: vertical; }} .notes {{ margin-top: 8px; }}
.saved-match {{ border-left: 5px solid #188038; }} .extra-or-misread, .recognition-error {{ border-left: 5px solid #d93025; }} .ambiguous {{ box-shadow: 0 0 0 2px #f9ab00; }} .turn-wrong {{ background: #fff6f5; }} @media (max-width: 1180px) {{ .grid {{ grid-template-columns: 1fr; }} }} @media (max-width: 680px) {{ main {{ padding: 14px; }} .card {{ grid-template-columns: 1fr; }} .image {{ padding: 6px; }} }}
</style></head><body><main><h1>Textbook parser review</h1><p class="summary">{html.escape(summary)}</p>
<div class="toolbar"><button id="export">Export decisions</button><button id="import">Import decisions</button><button id="reset">Clear saved decisions</button><input id="import-file" type="file" accept="application/json" hidden><span id="save-state">Loading saved decisions...</span></div>
<div class="filters"><button class="active" data-filter="all">All</button><button data-filter="saved-match">Saved FEN match</button><button data-filter="extra-or-misread">Extra / FEN mismatch</button><button data-filter="recognition-error">Recognition error</button><button data-filter="ambiguous">Ambiguous link</button><button data-filter="turn-wrong">Wrong turn</button><button data-filter="turn-unknown">Unknown turn</button><button data-filter="review-unreviewed">Unreviewed</button><button data-filter="review-approved">Approved</button><button data-filter="review-corrected">Corrected</button><button data-filter="review-excluded">Excluded</button></div>
<section class="grid">{''.join(cards)}</section></main><script id="initial-decisions" type="application/json">{initial_decisions}</script><script>
const storageKey = 'textbook-parser-review:' + location.pathname;
const api = location.protocol.startsWith('http') ? 'api/decisions' : null;
const initial = JSON.parse(document.querySelector('#initial-decisions').textContent);
const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
const decisions = new Map([...initial, ...saved].map(item => [item.id, item]));
const state = document.querySelector('#save-state');
const statusOptions = ['unreviewed', 'approved', 'corrected', 'excluded'];
function blockIds(value) {{ return value.split(',').map(id => id.trim()).filter(Boolean); }}
function apply(card, decision = {{}}) {{
  const select = card.querySelector('.decision'); const placement = card.querySelector('.piece-placement'); const turn = card.querySelector('.side-to-move'); const ids = card.querySelector('.text-block-ids'); const notes = card.querySelector('textarea');
  select.value = statusOptions.includes(decision.decision) ? decision.decision : 'unreviewed'; placement.value = decision.piecePlacement || placement.value; turn.value = decision.sideToMove || turn.value; ids.value = (decision.textBlockIds && decision.textBlockIds.length ? decision.textBlockIds : blockIds(ids.value)).join(', '); notes.value = decision.notes || notes.value;
  card.classList.remove(...statusOptions.map(value => 'review-' + value)); card.classList.add('review-' + select.value);
}}
function refresh(card) {{ const select = card.querySelector('.decision'); card.classList.remove(...statusOptions.map(value => 'review-' + value)); card.classList.add('review-' + select.value); }}
function record(card) {{ const textBlockIds = blockIds(card.querySelector('.text-block-ids').value); const defaultTextBlockIds = blockIds(card.dataset.defaultTextBlockIds); const textIdsChanged = JSON.stringify(textBlockIds) !== JSON.stringify(defaultTextBlockIds); return {{ id: card.dataset.id, decision: card.querySelector('.decision').value, piecePlacement: card.querySelector('.piece-placement').value, sideToMove: card.querySelector('.side-to-move').value, textBlockIds: textIdsChanged ? textBlockIds : [], notes: card.querySelector('textarea').value }}; }}
function isDecision(value) {{ return value.decision !== 'unreviewed' || value.piecePlacement || value.sideToMove || value.notes || value.textBlockIds.length; }}
function values() {{ return [...document.querySelectorAll('.card')].map(record).filter(isDecision); }}
let serverTimer;
async function saveServer(decisions) {{ try {{ const response = await fetch(api, {{method: 'PUT', headers: {{'Content-Type': 'application/json'}}, body: JSON.stringify({{version: 1, decisions}})}}); if (!response.ok) throw new Error(await response.text()); state.textContent = `Saved ${{decisions.length}} decision(s) to review-decisions.json.`; }} catch (error) {{ state.textContent = `Saved locally; file save failed: ${{error.message}}`; }} }}
function persist() {{ const decisions = values(); localStorage.setItem(storageKey, JSON.stringify(decisions)); if (!api) {{ state.textContent = `Saved ${{decisions.length}} decision(s) locally. Export when ready.`; return; }} clearTimeout(serverTimer); state.textContent = 'Saving review decisions...'; serverTimer = setTimeout(() => saveServer(decisions), 450); }}
for (const card of document.querySelectorAll('.card')) {{ apply(card, decisions.get(card.dataset.id)); card.addEventListener('input', () => {{ refresh(card); persist(); }}); card.addEventListener('change', () => {{ refresh(card); persist(); }}); }}
async function loadServer() {{ if (!api) {{ state.textContent = 'Opened as a file: decisions save in the browser. Use serve-review for file persistence.'; return; }} try {{ const response = await fetch(api); if (!response.ok) throw new Error(await response.text()); const value = await response.json(); const remote = Array.isArray(value) ? value : value.decisions; if (!Array.isArray(remote)) throw new Error('invalid decisions response'); for (const decision of remote) {{ const card = document.querySelector(`.card[data-id="${{CSS.escape(decision.id)}}"]`); if (card) apply(card, decision); }} state.textContent = `Loaded ${{remote.length}} decision(s) from review-decisions.json.`; }} catch (error) {{ state.textContent = `File load failed; using browser backup: ${{error.message}}`; }} }}
loadServer();
for (const button of document.querySelectorAll('[data-filter]')) button.onclick = () => {{ const filter = button.dataset.filter; for (const card of document.querySelectorAll('.card')) card.classList.toggle('hidden', filter !== 'all' && !card.classList.contains(filter)); for (const item of document.querySelectorAll('[data-filter]')) item.classList.toggle('active', item === button); }};
document.querySelector('#export').onclick = () => {{ const decisions = values(); const blob = new Blob([JSON.stringify({{version: 1, decisions}}, null, 2) + '\\n'], {{type: 'application/json'}}); const link = Object.assign(document.createElement('a'), {{href: URL.createObjectURL(blob), download: 'review-decisions.json'}}); link.click(); URL.revokeObjectURL(link.href); }};
document.querySelector('#import').onclick = () => document.querySelector('#import-file').click();
document.querySelector('#import-file').onchange = async event => {{ try {{ const value = JSON.parse(await event.target.files[0].text()); const records = Array.isArray(value) ? value : value.decisions; if (!Array.isArray(records)) throw new Error('Expected a decisions list'); for (const value of records) {{ const card = document.querySelector(`.card[data-id="${{CSS.escape(value.id)}}"]`); if (card) apply(card, value); }} persist(); }} catch (error) {{ alert('Could not import decisions: ' + error.message); }} event.target.value = ''; }};
document.querySelector('#reset').onclick = async () => {{ if (!confirm('Clear all saved review decisions for this report?')) return; localStorage.removeItem(storageKey); if (api) {{ try {{ const response = await fetch(api, {{method: 'DELETE'}}); if (!response.ok) throw new Error(await response.text()); }} catch (error) {{ alert('Could not clear review-decisions.json: ' + error.message); return; }} }} location.reload(); }};
</script></body></html>'''
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(document, encoding="utf-8")
    return dict(counts)
