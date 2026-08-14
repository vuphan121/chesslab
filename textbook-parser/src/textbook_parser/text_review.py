from __future__ import annotations

import html
import json
import os
import re
from pathlib import Path
from typing import Any

from PIL import Image


VALID_DECISIONS = ("unreviewed", "approved", "corrected", "excluded")
LABEL_KINDS = ("", "chess_notation", "prose", "heading", "metadata", "board_artifact", "not_text")


def _priority(raw: str, confidence: float) -> tuple[int, float, str]:
    """Rank unreviewed lines by expected value for the OCR training set."""
    text = raw.strip()
    compact = re.sub(r"\s+", "", text)
    notation = bool(re.search(r"\d+\.{1,3}|[KQRBN]?[a-h][1-8][+#=!?]*", text))
    board_noise = bool(re.fullmatch(r"[a-h1-8\s]+", text, flags=re.IGNORECASE)) or not text
    if notation and not board_noise:
        return (0, confidence, "notation")
    if confidence < 70 and not board_noise:
        return (1, confidence, "low-confidence text")
    if confidence < 90 and not board_noise:
        return (2, confidence, "medium-confidence text")
    if not board_noise:
        return (3, confidence, "other text")
    return (4, confidence, "possible board/noise")


def _decisions(path: str | Path | None) -> dict[str, dict[str, Any]]:
    if not path or not Path(path).exists():
        return {}
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    rows = value.get("decisions", []) if isinstance(value, dict) else value
    return {row["id"]: row for row in rows if isinstance(row, dict) and isinstance(row.get("id"), str)}


def _crop_line(page_path: Path, bbox: list[int], output_path: Path) -> None:
    with Image.open(page_path) as image:
        left, top, right, bottom = bbox
        padding_x, padding_y = 18, 12
        crop = image.crop((max(0, left - padding_x), max(0, top - padding_y), min(image.width, right + padding_x), min(image.height, bottom + padding_y)))
        crop.save(output_path)


def build_text_review_report(
    ocr_path: str | Path,
    pages_directory: str | Path,
    output_path: str | Path,
    decisions_path: str | Path | None = None,
) -> int:
    """Create a persistent human QA page for raw local OCR evidence."""
    output = Path(output_path)
    decisions = _decisions(decisions_path)
    crops_directory = output.parent / "text-crops"
    crops_directory.mkdir(parents=True, exist_ok=True)
    pending: list[tuple[tuple[int, float, str], dict[str, Any], dict[str, Any]]] = []
    for block in json.loads(Path(ocr_path).read_text(encoding="utf-8")):
        identifier = str(block["id"])
        stored = decisions.get(identifier, {})
        if str(stored.get("decision", "unreviewed")) != "unreviewed":
            continue
        pending.append((_priority(str(block.get("text", "")), float(block.get("confidence", 0))), block, stored))

    cards: list[str] = []
    for priority, block, stored in sorted(pending, key=lambda item: item[0]):
        identifier = str(block["id"])
        page = int(block["page"])
        bbox = [int(value) for value in block["bbox"]]
        crop_path = crops_directory / f"{identifier}.png"
        _crop_line(Path(pages_directory) / f"page_{page:03d}.png", bbox, crop_path)
        decision = str(stored.get("decision", "unreviewed"))
        if decision not in VALID_DECISIONS:
            decision = "unreviewed"
        raw = str(block.get("text", ""))
        reviewed = str(stored.get("reviewedText", ""))
        label_kind = str(stored.get("labelKind", ""))
        if label_kind not in LABEL_KINDS:
            label_kind = ""
        confidence = float(block.get("confidence", 0))
        quality = "high" if confidence >= 90 else "medium" if confidence >= 70 else "low"
        choices = "".join(f'<label class="choice"><input class="decision" type="radio" name="decision-{html.escape(identifier)}" value="{value}"{" checked" if decision == value else ""}><span>{value.replace("_", " ")}</span></label>' for value in VALID_DECISIONS)
        kinds = "".join(f'<label class="choice"><input class="label-kind" type="radio" name="kind-{html.escape(identifier)}" value="{value}"{" checked" if label_kind == value else ""}><span>{("unclassified" if not value else value.replace("_", " "))}</span></label>' for value in LABEL_KINDS)
        relative_crop = Path(os.path.relpath(crop_path, output.parent)).as_posix()
        cards.append(f'''<article class="card review-{html.escape(decision)} confidence-{quality}" data-id="{html.escape(identifier)}" data-raw="{html.escape(raw)}">
  <header><strong>{html.escape(identifier)}</strong><span>Priority: {html.escape(priority[2])} · Page {page} · OCR confidence {confidence:.1f}</span></header>
  <div class="entry"><figure><figcaption>Source image</figcaption><div class="image"><img src="{html.escape(relative_crop)}" alt="Source crop for {html.escape(identifier)}"></div></figure><section><fieldset><legend>1. Content type</legend><div class="choices">{kinds}</div></fieldset><label><span>2. Reviewed text</span><textarea class="reviewed" placeholder="Enter the exact text, or leave blank to accept raw OCR">{html.escape(reviewed)}</textarea></label><fieldset><legend>3. Decision</legend><div class="choices">{choices}</div></fieldset><label class="raw-label"><span>Raw Tesseract text</span><textarea class="raw" readonly>{html.escape(raw)}</textarea></label><label><span>4. Notes</span><textarea class="notes" placeholder="Optional correction reason">{html.escape(str(stored.get("notes", "")))}</textarea></label></section></div>
</article>''')
    document = f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Text OCR QA</title><style>
* {{ box-sizing:border-box }} body {{ margin:0;background:#eeefea;color:#202124;font:16px/1.45 system-ui,sans-serif }} main {{ max-width:1400px;margin:auto;padding:28px }} h1 {{ margin:0 }} p {{ color:#5f6368 }} .toolbar,.filters {{ display:flex;gap:9px;flex-wrap:wrap;margin:16px 0 }} button {{ background:#fff;border:1px solid #b8b8b4;border-radius:5px;padding:8px 12px;cursor:pointer }} button.primary {{ background:#1a73e8;color:#fff;border-color:#1a73e8;font-weight:700 }} button.active {{ background:#1a73e8;color:#fff;border-color:#1a73e8 }} #state {{ align-self:center;color:#5f6368 }} .symbols {{ margin:14px 0;padding:10px 12px;background:#f8f9f5;border:1px solid #d1d1cd;border-radius:8px }} .symbols summary {{ cursor:pointer;font-weight:700 }} .symbols p {{ margin:7px 0;color:#5f6368;font-size:14px }} .symbol-buttons {{ display:flex;gap:6px;flex-wrap:wrap }} .symbol-buttons button {{ min-width:38px;padding:4px 8px;font:600 16px/1.2 ui-monospace,Consolas,monospace }} .grid {{ display:block }} .card {{ background:#fff;border:1px solid #d1d1cd;border-radius:10px;padding:20px }} .card.hidden {{ display:none }} header {{ display:flex;justify-content:space-between;gap:12px;margin-bottom:14px }} header span {{ color:#5f6368 }} .entry {{ display:grid;grid-template-columns:minmax(420px,1fr) minmax(460px,1fr);gap:28px;align-items:start }} figure {{ margin:0 }} figcaption {{ font-weight:650;margin-bottom:6px;color:#555 }} .image {{ background:#eee;padding:10px;min-height:170px;display:flex;align-items:center;justify-content:center }} img {{ max-width:100%;height:auto;display:block }} label {{ display:grid;gap:5px;margin-bottom:14px;font-weight:650;color:#333 }} textarea {{ width:100%;font:inherit;border:1px solid #979ca0;border-radius:5px;padding:8px;background:#fff }} textarea {{ min-height:76px;resize:vertical }} fieldset {{ border:0;padding:0;margin:0 0 14px }} legend {{ padding:0;margin:0 0 7px;font-weight:650;color:#333 }} .choices {{ display:flex;flex-wrap:wrap;gap:8px }} label.choice {{ display:flex;align-items:center;gap:6px;margin:0;padding:7px 10px;background:#fafafa;border:1px solid #b8bcbf;border-radius:5px;font-weight:500;cursor:pointer }} label.choice:has(input:checked) {{ background:#e8f0fe;border-color:#1a73e8;color:#174ea6 }} .choice input {{ width:17px;height:17px;margin:0;accent-color:#1a73e8 }} .raw {{ min-height:58px;background:#f6f6f4;color:#555 }} .raw-label {{ margin-top:24px }} .review-approved {{ border-left:5px solid #188038 }} .review-corrected {{ border-left:5px solid #1a73e8 }} .review-excluded {{ border-left:5px solid #d93025 }} .confidence-low {{ box-shadow:0 0 0 2px #f9ab00 }} .nav {{ display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:22px }} .nav .buttons {{ display:flex;gap:8px;flex-wrap:wrap }} .progress {{ color:#5f6368;font-weight:650 }} @media(max-width:900px) {{ main {{ padding:14px }} .entry {{ grid-template-columns:1fr }} }}
</style><main><h1>Text OCR QA</h1><p>Only unreviewed lines are shown. The queue starts with likely chess notation, then readable low-confidence text; possible board/noise crops come last.</p><div class="toolbar"><button id="export">Export decisions</button><button id="import">Import decisions</button><button id="reset">Clear saved decisions</button><input id="import-file" type="file" accept="application/json" hidden><span id="state">Loading saved decisions...</span></div><details class="symbols"><summary>Chess symbols — click to insert and copy</summary><p>Symbols insert at the cursor in Reviewed text and are copied to the clipboard. Use <code>K Q R B N</code>, not piece figurines.</p><div class="symbol-buttons"><button data-symbol="O-O" title="Castle kingside">O-O</button><button data-symbol="O-O-O" title="Castle queenside">O-O-O</button><button data-symbol="+" title="Check">+</button><button data-symbol="#" title="Checkmate">#</button><button data-symbol="!" title="Good move">!</button><button data-symbol="?" title="Mistake">?</button><button data-symbol="!!">!!</button><button data-symbol="??">??</button><button data-symbol="!?">!?</button><button data-symbol="?!">?!</button><button data-symbol="+=" title="White slight advantage">+=</button><button data-symbol="=+" title="Black slight advantage">=+</button><button data-symbol="+-" title="White winning">+-</button><button data-symbol="-+" title="Black winning">-+</button><button data-symbol="⇄" title="Compensation / counterplay">⇄</button><button data-symbol="∞" title="Unclear position">∞</button><button data-symbol="⩲" title="White has compensation">⩲</button><button data-symbol="⩱" title="Black has compensation">⩱</button><button data-symbol="±" title="White advantage">±</button><button data-symbol="∓" title="Black advantage">∓</button><button data-symbol="→" title="Initiative / attack">→</button><button data-symbol="←" title="Initiative / attack">←</button><button data-symbol="△" title="Triangle">△</button></div></details><section class="grid">{"".join(cards)}</section><div class="nav"><button id="previous">Previous</button><span class="progress"></span><div class="buttons"><button id="skip">Skip</button><button id="submit" class="primary">Submit &amp; next</button></div></div></main><script>
const api=location.protocol.startsWith('http')?'api/decisions':null,key='textbook-parser-text-review:'+location.pathname,opts={json.dumps(list(VALID_DECISIONS))},state=document.querySelector('#state'),stored=new Map(JSON.parse(localStorage.getItem(key)||'[]').map(v=>[v.id,v]));let timer;
function selected(card,name){{return card.querySelector(`input.${{name}}:checked`)?.value||''}} function apply(card,v={{}}){{const d=card.querySelector(`input.decision[value="${{opts.includes(v.decision)?v.decision:'unreviewed'}}"]`),k=card.querySelector(`input.label-kind[value="${{v.labelKind||''}}"]`)||card.querySelector('input.label-kind[value=""]'),r=card.querySelector('.reviewed'),n=card.querySelector('.notes');d.checked=true;k.checked=true;r.value=v.reviewedText||r.value;n.value=v.notes||n.value;refresh(card)}}
function refresh(card){{card.classList.remove(...opts.map(x=>'review-'+x));card.classList.add('review-'+selected(card,'decision'))}}
function record(card){{const raw=card.dataset.raw,reviewed=card.querySelector('.reviewed').value,old=stored.get(card.dataset.id)||{{}};return {{...old,id:card.dataset.id,decision:selected(card,'decision'),labelKind:selected(card,'label-kind'),reviewedText:reviewed===raw?'':reviewed,notes:card.querySelector('.notes').value}}}} function values(){{const merged=new Map(stored);for(const card of cards){{const value=record(card);if(value.decision!=='unreviewed'||value.labelKind||value.reviewedText||value.notes)merged.set(value.id,value);else merged.delete(value.id)}}return [...merged.values()]}}
async function save(v){{try{{const r=await fetch(api,{{method:'PUT',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{version:1,decisions:v}})}});if(!r.ok)throw new Error(await r.text());state.textContent=`Saved ${{v.length}} text review(s) to the local file.`}}catch(e){{state.textContent=`Saved in browser; file save failed: ${{e.message}}`}}}} function persist(){{const v=values();v.forEach(x=>stored.set(x.id,x));localStorage.setItem(key,JSON.stringify(v));if(!api){{state.textContent='Saved in browser.';return}}clearTimeout(timer);state.textContent='Saving...';timer=setTimeout(()=>save(v),450)}}
const cards=[...document.querySelectorAll('.card')];let queue=[...cards],current=Number(sessionStorage.getItem(key+':current')||0);
function renderCurrent(){{if(!queue.length){{cards.forEach(card=>card.classList.add('hidden'));document.querySelector('.progress').textContent='All unreviewed items are complete.';document.querySelector('#previous').disabled=true;document.querySelector('#skip').disabled=true;document.querySelector('#submit').disabled=true;return}}current=Math.max(0,Math.min(current,queue.length-1));cards.forEach(card=>card.classList.toggle('hidden',card!==queue[current]));sessionStorage.setItem(key+':current',String(current));document.querySelector('.progress').textContent=`${{current+1}} of ${{queue.length}} unreviewed`;document.querySelector('#previous').disabled=current===0;document.querySelector('#skip').disabled=false;document.querySelector('#submit').disabled=false;}}
for(const button of document.querySelectorAll('[data-symbol]'))button.onclick=async()=>{{const symbol=button.dataset.symbol,target=document.activeElement?.matches('.reviewed')?document.activeElement:queue[current]?.querySelector('.reviewed');if(target){{const start=target.selectionStart,end=target.selectionEnd;target.setRangeText(symbol,start,end,'end');target.focus();target.dispatchEvent(new Event('input',{{bubbles:true}}))}}try{{await navigator.clipboard.writeText(symbol);state.textContent=`Inserted and copied ${{symbol}}.`}}catch{{state.textContent=`Inserted ${{symbol}}. Clipboard access was unavailable.`}}}};
for(const card of cards){{apply(card,stored.get(card.dataset.id));for(const control of card.querySelectorAll('select,textarea:not([readonly])'))control.addEventListener('input',()=>refresh(card))}}
async function load(){{if(!api){{renderCurrent();return}}try{{const r=await fetch(api),v=await r.json();for(const x of v.decisions||[]){{stored.set(x.id,x);const card=document.querySelector(`.card[data-id="${{CSS.escape(x.id)}}"]`);if(card)apply(card,x)}}state.textContent=`Loaded ${{(v.decisions||[]).length}} saved decision(s).`}}catch(e){{state.textContent=`File load failed: ${{e.message}}`}}renderCurrent()}}load();
function submitCurrent(){{const card=queue[current];if(!card)return;const item=record(card);stored.set(item.id,item);persist();queue.splice(current,1);current=Math.min(current,queue.length-1);renderCurrent();}} document.querySelector('#submit').onclick=submitCurrent;document.querySelector('#skip').onclick=()=>{{current=Math.min(current+1,queue.length-1);renderCurrent()}};document.querySelector('#previous').onclick=()=>{{current=Math.max(0,current-1);renderCurrent()}};
document.querySelector('#export').onclick=()=>{{const blob=new Blob([JSON.stringify({{version:1,decisions:values()}},null,2)+'\\n'],{{type:'application/json'}}),a=Object.assign(document.createElement('a'),{{href:URL.createObjectURL(blob),download:'text-review-decisions.json'}});a.click();URL.revokeObjectURL(a.href)}};document.querySelector('#import').onclick=()=>document.querySelector('#import-file').click();document.querySelector('#import-file').onchange=async e=>{{try{{const value=JSON.parse(await e.target.files[0].text());for(const x of value.decisions||value){{stored.set(x.id,x);const card=document.querySelector(`.card[data-id="${{CSS.escape(x.id)}}"]`);if(card)apply(card,x)}}persist();location.reload()}}catch(error){{alert('Could not import: '+error.message)}}e.target.value=''}};document.querySelector('#reset').onclick=async()=>{{if(!confirm('Clear all saved text decisions?'))return;localStorage.removeItem(key);sessionStorage.removeItem(key+':current');if(api)await fetch(api,{{method:'DELETE'}});location.reload()}};
</script>'''
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(document, encoding="utf-8")
    return len(cards)
