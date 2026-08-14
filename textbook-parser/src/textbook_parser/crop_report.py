from __future__ import annotations

import html
import json
import os
from pathlib import Path
from typing import Any


VALID_CROP_QUALITIES = ("unreviewed", "complete", "partial", "not_board", "unclear")


def _load(path: str | Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _decisions(path: str | Path | None) -> dict[str, dict[str, Any]]:
    if not path:
        return {}
    value = _load(path)
    rows = value.get("decisions", []) if isinstance(value, dict) else value
    return {row["id"]: row for row in rows if isinstance(row, dict) and isinstance(row.get("id"), str)}


def _relative(path: str, output: Path) -> str:
    return Path(os.path.relpath(Path(path).resolve(), output.parent.resolve())).as_posix()


def build_crop_review_report(positions_path: str | Path, output_path: str | Path, decisions_path: str | Path | None = None) -> None:
    """Write a crop-only review page; it makes no claim about board/text OCR."""
    output = Path(output_path)
    positions = _load(positions_path)
    decisions = _decisions(decisions_path)
    cards: list[str] = []
    for position in positions:
        identifier = str(position["id"])
        decision = decisions.get(identifier, {})
        quality = str(decision.get("cropQuality", "unreviewed"))
        if quality not in VALID_CROP_QUALITIES:
            quality = "unreviewed"
        crop = _relative(str(position.get("cropPath", "")), output) if position.get("cropPath") else ""
        image = f'<img src="{html.escape(crop)}" alt="{html.escape(identifier)} crop">' if crop else '<div class="missing">Crop file missing</div>'
        notes = html.escape(str(decision.get("notes", "")))
        options = "".join(f'<option value="{value}"{" selected" if quality == value else ""}>{value.replace("_", " ")}</option>' for value in VALID_CROP_QUALITIES)
        cards.append(f'''<article class="card crop-{quality}" data-id="{html.escape(identifier)}">
  <header><strong>{html.escape(identifier)}</strong><span>Page {int(position['page'])} · bbox {html.escape(str(position['bbox']))}</span></header>
  <div class="image">{image}</div>
  <label>Crop quality<select class="crop-quality">{options}</select></label>
  <label>Notes<textarea placeholder="Describe a clipped edge, missing coordinates, or other issue">{notes}</textarea></label>
</article>''')
    initial = json.dumps(list(decisions.values())).replace("</", "<\\/")
    document = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Crop quality review</title><style>
* {{ box-sizing: border-box; }} body {{ margin: 0; font: 15px/1.45 system-ui, sans-serif; background: #eeefea; color: #202124; }} main {{ max-width: 1900px; margin: auto; padding: 28px; }} h1 {{ margin: 0; }} p {{ color: #5f6368; }} .toolbar,.filters {{ display:flex; flex-wrap:wrap; gap:10px; margin:16px 0; }} button {{ padding:7px 10px; background:#fff; border:1px solid #b8b8b4; border-radius:5px; cursor:pointer; }} button.active {{ color:#fff; background:#1a73e8; border-color:#1a73e8; }} #state {{ align-self:center; color:#5f6368; }} .grid {{ display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:18px; }} .card {{ background:#fff; padding:12px; border:1px solid #d1d1cd; border-radius:9px; }} .card.hidden {{ display:none; }} header {{ display:flex; justify-content:space-between; gap:8px; margin-bottom:8px; }} header span {{ color:#5f6368; font-size:12px; text-align:right; }} .image {{ background:#ddd; padding:6px; }} img {{ width:100%; height:auto; display:block; }} label {{ display:grid; gap:4px; font-weight:650; color:#54585d; margin-top:10px; }} select,textarea {{ width:100%; font:inherit; border:1px solid #b8bcbf; border-radius:4px; padding:5px; background:white; }} textarea {{ min-height:62px; resize:vertical; }} .crop-complete {{ border-top:5px solid #188038; }} .crop-partial,.crop-not-board {{ border-top:5px solid #d93025; }} .crop-unclear {{ border-top:5px solid #f9ab00; }} @media(max-width:1400px) {{ .grid {{ grid-template-columns:repeat(3,minmax(0,1fr)); }} }} @media(max-width:1000px) {{ .grid {{ grid-template-columns:repeat(2,minmax(0,1fr)); }} }} @media(max-width:600px) {{ main {{ padding:14px; }} .grid {{ grid-template-columns:1fr; }} }}
</style></head><body><main><h1>Crop quality review</h1><p>Review only whether each emitted image contains the complete diagram. Do not assess FEN or text here.</p><div class="toolbar"><button id="export">Export decisions</button><button id="import">Import decisions</button><button id="reset">Clear saved decisions</button><input id="import-file" type="file" accept="application/json" hidden><span id="state">Loading saved decisions...</span></div><div class="filters"><button class="active" data-filter="all">All</button><button data-filter="crop-unreviewed">Unreviewed</button><button data-filter="crop-complete">Complete</button><button data-filter="crop-partial">Partial / needs recrop</button><button data-filter="crop-not-board">Not a board</button><button data-filter="crop-unclear">Unclear</button></div><section class="grid">{''.join(cards)}</section></main><script id="initial" type="application/json">{initial}</script><script>
const api = location.protocol.startsWith('http') ? 'api/decisions' : null; const key='textbook-parser-crop-review:'+location.pathname; const choices={json.dumps(list(VALID_CROP_QUALITIES))}; const state=document.querySelector('#state'); const decisions=new Map(JSON.parse(localStorage.getItem(key)||'[]').map(value=>[value.id,value])); let timer;
function apply(card,value={{}}) {{ const select=card.querySelector('.crop-quality'),notes=card.querySelector('textarea'); select.value=choices.includes(value.cropQuality)?value.cropQuality:select.value; notes.value=value.notes||notes.value; card.classList.remove(...choices.map(value=>'crop-'+value)); card.classList.add('crop-'+select.value); }}
function refresh(card) {{ const select=card.querySelector('.crop-quality'); card.classList.remove(...choices.map(value=>'crop-'+value)); card.classList.add('crop-'+select.value); }}
function record(card) {{ const previous=decisions.get(card.dataset.id)||{{}}; return {{...previous,id:card.dataset.id,cropQuality:card.querySelector('.crop-quality').value,notes:card.querySelector('textarea').value}}; }}
function values() {{ return [...document.querySelectorAll('.card')].map(record).filter(value=>value.cropQuality!=='unreviewed'||value.notes); }}
async function save(values) {{ try {{ const response=await fetch(api,{{method:'PUT',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{version:1,decisions:values}})}}); if(!response.ok) throw new Error(await response.text()); state.textContent=`Saved ${{values.length}} crop review(s) to review-decisions.json.`; }} catch(error) {{ state.textContent=`Saved in browser; file save failed: ${{error.message}}`; }} }}
function persist() {{ const result=values(); result.forEach(value=>decisions.set(value.id,value)); localStorage.setItem(key,JSON.stringify(result)); if(!api) {{ state.textContent=`Saved ${{result.length}} crop review(s) in browser.`; return; }} clearTimeout(timer); state.textContent='Saving crop review...'; timer=setTimeout(()=>save(result),450); }}
for(const card of document.querySelectorAll('.card')) {{ apply(card,decisions.get(card.dataset.id)); card.addEventListener('input',()=>{{refresh(card);persist();}}); card.addEventListener('change',()=>{{refresh(card);persist();}}); }}
async function load() {{ if(!api) {{ state.textContent='Use serve-review for file persistence.'; return; }} try {{ const response=await fetch(api); if(!response.ok)throw new Error(await response.text()); const value=await response.json(); for(const decision of value.decisions||[]) {{ decisions.set(decision.id,decision); const card=document.querySelector(`.card[data-id="${{CSS.escape(decision.id)}}"]`); if(card)apply(card,decision); }} state.textContent=`Loaded ${{(value.decisions||[]).length}} saved decision(s).`; }} catch(error) {{ state.textContent=`File load failed: ${{error.message}}`; }} }} load();
for(const button of document.querySelectorAll('[data-filter]'))button.onclick=()=>{{const filter=button.dataset.filter;for(const card of document.querySelectorAll('.card'))card.classList.toggle('hidden',filter!=='all'&&!card.classList.contains(filter));for(const item of document.querySelectorAll('[data-filter]'))item.classList.toggle('active',item===button);}};
document.querySelector('#export').onclick=()=>{{const blob=new Blob([JSON.stringify({{version:1,decisions:values()}},null,2)+'\\n'],{{type:'application/json'}});const link=Object.assign(document.createElement('a'),{{href:URL.createObjectURL(blob),download:'review-decisions.json'}});link.click();URL.revokeObjectURL(link.href);}};document.querySelector('#import').onclick=()=>document.querySelector('#import-file').click();document.querySelector('#import-file').onchange=async event=>{{try{{const value=JSON.parse(await event.target.files[0].text());for(const decision of value.decisions||value){{decisions.set(decision.id,decision);const card=document.querySelector(`.card[data-id="${{CSS.escape(decision.id)}}"]`);if(card)apply(card,decision);}}persist();}}catch(error){{alert('Could not import: '+error.message);}}event.target.value='';}};document.querySelector('#reset').onclick=async()=>{{if(!confirm('Clear all saved review decisions?'))return;localStorage.removeItem(key);if(api)await fetch(api,{{method:'DELETE'}});location.reload();}};
</script></body></html>'''
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(document, encoding="utf-8")
