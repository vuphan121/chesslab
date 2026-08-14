from __future__ import annotations

import html
import json
from pathlib import Path
from typing import Any


VALID_DECISIONS = ("unreviewed", "approved", "corrected", "excluded")


def _load(path: str | Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _decisions(path: str | Path | None) -> dict[str, dict[str, Any]]:
    if not path or not Path(path).exists():
        return {}
    value = _load(path)
    rows = value.get("decisions", []) if isinstance(value, dict) else value
    return {row["id"]: row for row in rows if isinstance(row, dict) and isinstance(row.get("id"), str)}


def build_move_review_report(
    positions_path: str | Path,
    recognition_path: str | Path,
    layout_path: str | Path,
    candidates_path: str | Path,
    output_path: str | Path,
    decisions_path: str | Path | None = None,
) -> None:
    """Write a human-only review queue for OCR-derived move candidates."""
    output = Path(output_path)
    positions = {str(row["id"]): row for row in _load(positions_path)}
    recognition = _load(recognition_path)
    blocks = {str(row["id"]): str(row.get("text", "")) for row in _load(layout_path)}
    decisions = _decisions(decisions_path)
    cards: list[str] = []
    for candidate in _load(candidates_path):
        identifier = str(candidate["positionId"])
        position = positions.get(identifier, {})
        stored = decisions.get(identifier, {})
        decision = str(stored.get("decision", "unreviewed"))
        if decision not in VALID_DECISIONS:
            decision = "unreviewed"
        placement = recognition.get(identifier)
        side = position.get("sideToMove")
        moves = candidate.get("sanCandidates", [])
        flags = ["Every OCR move candidate requires human approval."]
        if not isinstance(placement, str):
            flags.append("Board recognition is missing or failed.")
        if side not in ("w", "b"):
            flags.append("Side to move is unknown.")
        if not moves:
            flags.append("No conservative SAN candidate was found.")
        source = "\n".join(blocks.get(str(block_id), "[missing text block]") for block_id in candidate.get("textBlockIds", []))
        choices = "".join(f'<option value="{value}"{" selected" if decision == value else ""}>{value.replace("_", " ")}</option>' for value in VALID_DECISIONS)
        cards.append(f'''<article class="card review-{html.escape(decision)}" data-id="{html.escape(identifier)}">
  <header><strong>{html.escape(identifier)}</strong><span>Page {html.escape(str(position.get("page", "?")))}</span></header>
  <p class="flags">{" ".join(html.escape(flag) for flag in flags)}</p>
  <dl><dt>OCR board</dt><dd class="fen">{html.escape(placement if isinstance(placement, str) else "Recognition failed")}</dd><dt>Side to move</dt><dd>{html.escape(str(side or "unknown"))}</dd><dt>Extracted candidates</dt><dd class="fen">{html.escape(" ".join(map(str, moves)) or "None")}</dd></dl>
  <label>Source text (evidence only)<textarea readonly>{html.escape(source)}</textarea></label>
  <label>Review decision<select class="decision">{choices}</select></label>
  <label>Approved or corrected SAN line<input class="san-sequence" value="{html.escape(str(stored.get("sanSequence", "")))}" placeholder="Enter only after manual review"></label>
  <label>Notes<textarea class="notes" placeholder="Why this text or move needs correction">{html.escape(str(stored.get("notes", "")))}</textarea></label>
</article>''')
    initial = json.dumps(list(decisions.values())).replace("</", "<\\/")
    document = f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Move candidate review</title><style>
* {{ box-sizing:border-box }} body {{ margin:0;background:#eeefea;color:#202124;font:15px/1.45 system-ui,sans-serif }} main {{ max-width:1300px;margin:auto;padding:28px }} h1 {{ margin:0 }} p {{ color:#5f6368 }} .toolbar,.filters {{ display:flex;gap:9px;flex-wrap:wrap;margin:16px 0 }} button {{ background:#fff;border:1px solid #b8b8b4;border-radius:5px;padding:7px 10px;cursor:pointer }} button.active {{ background:#1a73e8;color:#fff;border-color:#1a73e8 }} #state {{ align-self:center;color:#5f6368 }} .grid {{ display:grid;grid-template-columns:1fr;gap:18px }} .card {{ background:#fff;border:1px solid #d1d1cd;border-radius:10px;padding:16px }} .card.hidden {{ display:none }} header {{ display:flex;justify-content:space-between;gap:12px }} header span {{ color:#5f6368 }} .flags {{ color:#b3261e;font-weight:600 }} dl {{ display:grid;grid-template-columns:150px 1fr;gap:5px 9px }} dt {{ font-weight:650;color:#555 }} dd {{ margin:0;overflow-wrap:anywhere }} .fen {{ font:12px/1.35 ui-monospace,monospace }} label {{ display:grid;gap:4px;margin-top:10px;font-weight:650;color:#54585d }} input,select,textarea {{ width:100%;font:inherit;border:1px solid #b8bcbf;border-radius:4px;padding:6px;background:#fff }} textarea {{ min-height:72px;resize:vertical }} textarea[readonly] {{ min-height:110px;background:#f6f6f4 }} .review-approved {{ border-left:5px solid #188038 }} .review-corrected {{ border-left:5px solid #1a73e8 }} .review-excluded {{ border-left:5px solid #d93025 }}
</style><main><h1>Move candidate review</h1><p>No move is accepted or repaired automatically. The parser only presents OCR evidence and flags; enter an approved SAN line yourself.</p><div class="toolbar"><button id="export">Export decisions</button><button id="import">Import decisions</button><button id="reset">Clear saved decisions</button><input id="import-file" type="file" accept="application/json" hidden><span id="state">Loading saved decisions...</span></div><div class="filters"><button class="active" data-filter="all">All</button><button data-filter="review-unreviewed">Unreviewed</button><button data-filter="review-approved">Approved</button><button data-filter="review-corrected">Corrected</button><button data-filter="review-excluded">Excluded</button></div><section class="grid">{"".join(cards)}</section></main><script>
const api=location.protocol.startsWith('http')?'api/decisions':null,key='textbook-parser-move-review:'+location.pathname,options={json.dumps(list(VALID_DECISIONS))},state=document.querySelector('#state'),stored=new Map(JSON.parse(localStorage.getItem(key)||'[]').map(v=>[v.id,v]));let timer;
function apply(card,v={{}}){{const d=card.querySelector('.decision'),s=card.querySelector('.san-sequence'),n=card.querySelector('.notes');d.value=options.includes(v.decision)?v.decision:d.value;s.value=v.sanSequence||s.value;n.value=v.notes||n.value;card.classList.remove(...options.map(x=>'review-'+x));card.classList.add('review-'+d.value)}}
function refresh(card){{card.classList.remove(...options.map(x=>'review-'+x));card.classList.add('review-'+card.querySelector('.decision').value)}}
function record(card){{const old=stored.get(card.dataset.id)||{{}};return {{...old,id:card.dataset.id,decision:card.querySelector('.decision').value,sanSequence:card.querySelector('.san-sequence').value,notes:card.querySelector('.notes').value}}}} function values(){{return [...document.querySelectorAll('.card')].map(record).filter(v=>v.decision!=='unreviewed'||v.sanSequence||v.notes)}}
async function save(v){{try{{const r=await fetch(api,{{method:'PUT',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{version:1,decisions:v}})}});if(!r.ok)throw new Error(await r.text());state.textContent=`Saved ${{v.length}} move review(s) to the local file.`}}catch(e){{state.textContent=`Saved in browser; file save failed: ${{e.message}}`}}}} function persist(){{const v=values();v.forEach(x=>stored.set(x.id,x));localStorage.setItem(key,JSON.stringify(v));if(!api){{state.textContent='Saved in browser.';return}}clearTimeout(timer);state.textContent='Saving...';timer=setTimeout(()=>save(v),450)}}
for(const card of document.querySelectorAll('.card')){{apply(card,stored.get(card.dataset.id));for(const control of card.querySelectorAll('input,select,textarea:not([readonly])'))control.addEventListener('input',()=>{{refresh(card);persist()}})}} async function load(){{if(!api)return;try{{const r=await fetch(api),v=await r.json();for(const x of v.decisions||[]){{stored.set(x.id,x);const card=document.querySelector(`.card[data-id="${{CSS.escape(x.id)}}"]`);if(card)apply(card,x)}}state.textContent=`Loaded ${{(v.decisions||[]).length}} saved decision(s).`}}catch(e){{state.textContent=`File load failed: ${{e.message}}`}}}}load();
for(const b of document.querySelectorAll('[data-filter]'))b.onclick=()=>{{for(const card of document.querySelectorAll('.card'))card.classList.toggle('hidden',b.dataset.filter!=='all'&&!card.classList.contains(b.dataset.filter));for(const x of document.querySelectorAll('[data-filter]'))x.classList.toggle('active',x===b)}};document.querySelector('#export').onclick=()=>{{const blob=new Blob([JSON.stringify({{version:1,decisions:values()}},null,2)+'\\n'],{{type:'application/json'}}),a=Object.assign(document.createElement('a'),{{href:URL.createObjectURL(blob),download:'move-review-decisions.json'}});a.click();URL.revokeObjectURL(a.href)}};document.querySelector('#import').onclick=()=>document.querySelector('#import-file').click();document.querySelector('#import-file').onchange=async e=>{{try{{const value=JSON.parse(await e.target.files[0].text());for(const x of value.decisions||value){{stored.set(x.id,x);const card=document.querySelector(`.card[data-id="${{CSS.escape(x.id)}}"]`);if(card)apply(card,x)}}persist()}}catch(error){{alert('Could not import: '+error.message)}}e.target.value=''}};document.querySelector('#reset').onclick=async()=>{{if(!confirm('Clear all saved move decisions?'))return;localStorage.removeItem(key);if(api)await fetch(api,{{method:'DELETE'}});location.reload()}};
</script>'''
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(document, encoding="utf-8")
