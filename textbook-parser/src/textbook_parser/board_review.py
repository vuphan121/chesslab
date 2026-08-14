from __future__ import annotations

import html
import json
import os
from pathlib import Path
from typing import Any


VALID_DECISIONS = ("unreviewed", "approved", "corrected", "excluded")


def _load(path: str | Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _decision_map(path: str | Path | None) -> dict[str, dict[str, Any]]:
    if not path:
        return {}
    checkpoint = Path(path)
    if not checkpoint.exists():
        return {}
    value = _load(checkpoint)
    rows = value.get("decisions", []) if isinstance(value, dict) else value
    return {row["id"]: row for row in rows if isinstance(row, dict) and isinstance(row.get("id"), str)}


def _relative(path: str, output: Path) -> str:
    return Path(os.path.relpath(Path(path).resolve(), output.parent.resolve())).as_posix()


def build_board_review_report(
    positions_path: str | Path,
    recognition_path: str | Path,
    output_path: str | Path,
    decisions_path: str | Path | None = None,
) -> None:
    """Create a board/FEN-only review page; no source-book text is used."""
    output = Path(output_path)
    positions = _load(positions_path)
    recognition = _load(recognition_path)
    decisions = _decision_map(decisions_path)
    cards: list[str] = []
    for position in positions:
        identifier = str(position["id"])
        stored = decisions.get(identifier, {})
        review = str(stored.get("decision", "unreviewed"))
        if review not in VALID_DECISIONS:
            review = "unreviewed"
        detected_fen = recognition.get(identifier)
        fen = detected_fen if isinstance(detected_fen, str) else ""
        detected_turn = str(position.get("sideToMove") or "")
        corrected_fen = str(stored.get("piecePlacement", ""))
        corrected_turn = str(stored.get("sideToMove", ""))
        notes = str(stored.get("notes", ""))
        crop_path = str(position.get("cropPath", ""))
        crop = _relative(crop_path, output) if crop_path else ""
        image = f'<img src="{html.escape(crop)}" alt="{html.escape(identifier)} board diagram">' if crop else '<div class="missing">Crop file missing</div>'
        choices = "".join(f'<option value="{value}"{" selected" if review == value else ""}>{value.replace("_", " ")}</option>' for value in VALID_DECISIONS)
        cards.append(f'''<article class="card review-{review}" data-id="{html.escape(identifier)}" data-detected-fen="{html.escape(fen)}" data-detected-turn="{html.escape(detected_turn)}">
  <header><strong>{html.escape(identifier)}</strong><span>Page {int(position['page'])} · turn confidence {html.escape(str(position.get('turnConfidence', 'n/a')))}</span></header>
  <div class="boards"><figure><figcaption>Textbook diagram</figcaption><div class="image">{image}</div></figure><figure><figcaption>Chesslab board preview</figcaption><div class="chessboard" aria-label="ChessOCR board position"></div></figure></div>
  <dl><dt>ChessOCR placement</dt><dd class="fen">{html.escape(fen or 'Recognition failed')}</dd><dt>Triangle turn</dt><dd>{html.escape(detected_turn or 'unknown')} · {html.escape(str(position.get('turnDetection', 'no detection')))}</dd></dl>
  <label>Board decision<select class="decision">{choices}</select></label>
  <label>Correct piece placement<input class="piece-placement" value="{html.escape(corrected_fen)}" placeholder="Leave blank to accept ChessOCR placement"></label>
  <label>Correct side to move<select class="side-to-move"><option value="">Keep detected</option><option value="w"{" selected" if corrected_turn == "w" else ""}>White</option><option value="b"{" selected" if corrected_turn == "b" else ""}>Black</option></select></label>
  <label>Notes<textarea placeholder="Describe a FEN or triangle correction">{html.escape(notes)}</textarea></label>
</article>''')
    initial = json.dumps(list(decisions.values())).replace("</", "<\\/")
    document = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Board facts review</title><style>
* {{ box-sizing:border-box; }} body {{ margin:0; font:15px/1.45 system-ui,sans-serif; background:#eeefea; color:#202124; }} main {{ max-width:2100px; margin:auto; padding:30px; }} h1 {{ margin:0; }} p {{ color:#5f6368; }} .toolbar,.filters {{ display:flex; flex-wrap:wrap; gap:10px; margin:16px 0; }} button {{ padding:7px 10px; background:#fff; border:1px solid #b8b8b4; border-radius:5px; cursor:pointer; }} button.active {{ background:#1a73e8; color:#fff; border-color:#1a73e8; }} #state {{ align-self:center; color:#5f6368; }} .grid {{ display:grid; grid-template-columns:1fr; gap:24px; }} .card {{ background:#fff; border:1px solid #d1d1cd; border-radius:10px; padding:18px; }} .card.hidden {{ display:none; }} header {{ display:flex; justify-content:space-between; gap:8px; margin-bottom:12px; }} header span {{ color:#5f6368; font-size:13px; text-align:right; }} .boards {{ display:grid; grid-template-columns:minmax(360px,1fr) minmax(360px,1fr); gap:22px; align-items:start; }} figure {{ margin:0; }} figcaption {{ font-weight:650; margin-bottom:6px; color:#555; }} .image {{ background:#ddd; padding:8px; }} img {{ width:100%; height:auto; display:block; }} .chessboard {{ width:min(100%,760px); aspect-ratio:1; display:grid; grid-template-columns:repeat(8,1fr); grid-template-rows:repeat(8,1fr); background:#f0d9b5; border:1px solid #847055; }} .square {{ position:relative; display:grid; place-items:center; }} .square.dark {{ background:#b58863; }} .square img {{ width:92%; height:92%; object-fit:contain; z-index:1; }} .square .rank,.square .file {{ position:absolute; font-size:clamp(9px,1vw,15px); line-height:1; font-weight:700; z-index:2; }} .square .rank {{ left:3px; top:3px; }} .square .file {{ right:3px; bottom:3px; }} .square.light .rank,.square.light .file {{ color:#b58863; }} .square.dark .rank,.square.dark .file {{ color:#f0d9b5; }} dl {{ display:grid; grid-template-columns:145px 1fr; gap:5px 9px; margin:15px 0; }} dt {{ color:#555; font-weight:650; }} dd {{ margin:0; overflow-wrap:anywhere; }} .fen {{ font:12px/1.35 ui-monospace,monospace; }} label {{ display:grid; gap:4px; margin-top:10px; font-weight:650; color:#54585d; }} input,select,textarea {{ width:100%; font:inherit; border:1px solid #b8bcbf; border-radius:4px; padding:5px; background:#fff; }} textarea {{ min-height:62px; resize:vertical; }} .review-approved {{ border-left:5px solid #188038; }} .review-corrected {{ border-left:5px solid #1a73e8; }} .review-excluded {{ border-left:5px solid #d93025; }} @media(max-width:900px) {{ main {{ padding:14px; }} .boards {{ grid-template-columns:1fr; }} }}
</style></head><body><main><h1>Board facts review</h1><p>Review only the detected board position and side to move. Do not assess textbook text or moves on this page.</p><div class="toolbar"><button id="export">Export decisions</button><button id="import">Import decisions</button><button id="reset">Clear saved decisions</button><input id="import-file" type="file" accept="application/json" hidden><span id="state">Loading saved decisions...</span></div><div class="filters"><button class="active" data-filter="all">All</button><button data-filter="review-unreviewed">Unreviewed</button><button data-filter="review-approved">Approved</button><button data-filter="review-corrected">Corrected</button><button data-filter="review-excluded">Excluded</button></div><section class="grid">{''.join(cards)}</section></main><script id="initial" type="application/json">{initial}</script><script>
const api=location.protocol.startsWith('http')?'api/decisions':null,key='textbook-parser-board-review:'+location.pathname,options={json.dumps(list(VALID_DECISIONS))},state=document.querySelector('#state'),stored=new Map(JSON.parse(localStorage.getItem(key)||'[]').map(value=>[value.id,value]));let timer;
function apply(card,value={{}}){{const decision=card.querySelector('.decision'),placement=card.querySelector('.piece-placement'),turn=card.querySelector('.side-to-move'),notes=card.querySelector('textarea');decision.value=options.includes(value.decision)?value.decision:decision.value;placement.value=value.piecePlacement||placement.value;turn.value=value.sideToMove||turn.value;notes.value=value.notes||notes.value;card.classList.remove(...options.map(value=>'review-'+value));card.classList.add('review-'+decision.value);}}
const files='abcdefgh';
function addSquare(board,rankIndex,fileIndex,piece){{const square=document.createElement('div'),light=(fileIndex+rankIndex)%2===0;square.className='square '+(light?'light':'dark');if(piece){{const image=document.createElement('img'),color=piece===piece.toUpperCase()?'w':'b';image.src=`assets/pieces/${{color}}${{piece.toLowerCase()}}.png`;image.alt=`${{color==='w'?'White':'Black'}} ${{piece.toLowerCase()}}`;square.append(image);}}if(fileIndex===0){{const label=document.createElement('span');label.className='rank';label.textContent=String(8-rankIndex);square.append(label);}}if(rankIndex===7){{const label=document.createElement('span');label.className='file';label.textContent=files[fileIndex];square.append(label);}}board.append(square);}}
function renderBoard(card,placement){{const board=card.querySelector('.chessboard');board.replaceChildren();try{{const rows=placement.split('/');if(rows.length!==8)throw new Error('expected eight ranks');rows.forEach((row,rankIndex)=>{{let fileIndex=0;for(const token of row){{if(/^[1-8]$/.test(token)){{for(let empty=0;empty<Number(token);empty++){{if(fileIndex>7)throw new Error('rank is too wide');addSquare(board,rankIndex,fileIndex++,'');}}continue;}}if(!/^[prnbqkPRNBQK]$/.test(token)||fileIndex>7)throw new Error('invalid piece placement');addSquare(board,rankIndex,fileIndex++,token);}}if(fileIndex!==8)throw new Error('rank is incomplete');}});}}catch(error){{board.textContent='Cannot render this piece placement.';}}}}
function previewPlacement(card){{return card.querySelector('.piece-placement').value.trim()||card.dataset.detectedFen;}}
function refresh(card){{const decision=card.querySelector('.decision');card.classList.remove(...options.map(value=>'review-'+value));card.classList.add('review-'+decision.value);}}
function record(card){{const placement=card.querySelector('.piece-placement').value,turn=card.querySelector('.side-to-move').value,notes=card.querySelector('textarea').value,previous=stored.get(card.dataset.id)||{{}};return {{...previous,id:card.dataset.id,decision:card.querySelector('.decision').value,piecePlacement:placement===card.dataset.detectedFen?'':placement,sideToMove:turn===card.dataset.detectedTurn?'':turn,notes}};}}
function isDecision(value){{return value.decision!=='unreviewed'||value.piecePlacement||value.sideToMove||value.notes;}}function values(){{return [...document.querySelectorAll('.card')].map(record).filter(isDecision);}}
async function save(values){{try{{const response=await fetch(api,{{method:'PUT',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{version:1,decisions:values}})}});if(!response.ok)throw new Error(await response.text());state.textContent=`Saved ${{values.length}} board review(s) to review-decisions.json.`;}}catch(error){{state.textContent=`Saved in browser; file save failed: ${{error.message}}`;}}}}
function persist(){{const result=values();result.forEach(value=>stored.set(value.id,value));localStorage.setItem(key,JSON.stringify(result));if(!api){{state.textContent=`Saved ${{result.length}} board review(s) in browser.`;return;}}clearTimeout(timer);state.textContent='Saving board review...';timer=setTimeout(()=>save(result),450);}}
for(const card of document.querySelectorAll('.card')){{apply(card,stored.get(card.dataset.id));renderBoard(card,previewPlacement(card));card.addEventListener('input',()=>{{refresh(card);renderBoard(card,previewPlacement(card));persist();}});card.addEventListener('change',()=>{{refresh(card);renderBoard(card,previewPlacement(card));persist();}});}}
async function load(){{if(!api){{state.textContent='Use serve-review for file persistence.';return;}}try{{const response=await fetch(api);if(!response.ok)throw new Error(await response.text());const value=await response.json();for(const decision of value.decisions||[]){{stored.set(decision.id,decision);const card=document.querySelector(`.card[data-id="${{CSS.escape(decision.id)}}"]`);if(card){{apply(card,decision);renderBoard(card,previewPlacement(card));}}}}state.textContent=`Loaded ${{(value.decisions||[]).length}} saved decision(s).`;}}catch(error){{state.textContent=`File load failed: ${{error.message}}`;}}}}load();
for(const button of document.querySelectorAll('[data-filter]'))button.onclick=()=>{{const filter=button.dataset.filter;for(const card of document.querySelectorAll('.card'))card.classList.toggle('hidden',filter!=='all'&&!card.classList.contains(filter));for(const item of document.querySelectorAll('[data-filter]'))item.classList.toggle('active',item===button);}};document.querySelector('#export').onclick=()=>{{const blob=new Blob([JSON.stringify({{version:1,decisions:values()}},null,2)+'\\n'],{{type:'application/json'}});const link=Object.assign(document.createElement('a'),{{href:URL.createObjectURL(blob),download:'review-decisions.json'}});link.click();URL.revokeObjectURL(link.href);}};document.querySelector('#import').onclick=()=>document.querySelector('#import-file').click();document.querySelector('#import-file').onchange=async event=>{{try{{const value=JSON.parse(await event.target.files[0].text());for(const decision of value.decisions||value){{stored.set(decision.id,decision);const card=document.querySelector(`.card[data-id="${{CSS.escape(decision.id)}}"]`);if(card){{apply(card,decision);renderBoard(card,previewPlacement(card));}}}}persist();}}catch(error){{alert('Could not import: '+error.message);}}event.target.value='';}};document.querySelector('#reset').onclick=async()=>{{if(!confirm('Clear all saved review decisions?'))return;localStorage.removeItem(key);if(api)await fetch(api,{{method:'DELETE'}});location.reload();}};
</script></body></html>'''
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(document, encoding="utf-8")
