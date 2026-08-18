#!/usr/bin/env python3
"""Serve an editable local review page for parser failures.

Run review_failures.py first, then this command. Saving creates an overrides
file consumed by backend/cmd/importparsedboards on its next --apply run.
"""

from __future__ import annotations

import argparse
import json
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


PAGE = """<!doctype html><meta charset=utf-8><title>Board parser review</title>
<style>body{margin:24px;background:#f4f3ef;color:#282724;font:15px system-ui}main{max-width:1050px;margin:auto}.card{display:grid;grid-template-columns:minmax(280px,1fr) minmax(280px,1fr);gap:18px;background:#fff;border-radius:10px;padding:16px;margin:14px 0;box-shadow:0 1px 3px #0002}img{width:100%;border:1px solid #ddd}.meta{color:#6d6962;font-size:13px}.row{display:flex;gap:10px;margin:10px 0;align-items:center}input,select,button{font:inherit;padding:7px}input{flex:1}button{background:#478ed5;color:white;border:0;border-radius:6px;font-weight:600;cursor:pointer}#status{position:sticky;bottom:10px;background:#282724;color:#fff;padding:10px;border-radius:6px;display:inline-block}.empty{background:#fff;padding:18px;border-radius:8px}</style>
<main><h1>Board parser review</h1><p>Correct only the diagrams listed below. A saved, checked item will be included by the Neon importer; unchecked items remain excluded.</p><div id=cards></div><div id=status>Loading…</div></main>
<script>
const cards=document.querySelector('#cards'),status=document.querySelector('#status');
async function save(item){const res=await fetch('/api/overrides',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(item)});status.textContent=res.ok?'Saved '+item.diagram:'Save failed';}
fetch('/api/queue').then(r=>r.json()).then(({items})=>{if(!items.length){cards.innerHTML='<div class=empty>No review items.</div>';status.textContent='Nothing to review';return}items.forEach(item=>{const e=document.createElement('section');e.className='card';e.innerHTML=`<div><img src="/${item.context}" alt="${item.diagram} context"><p class=meta>Book p. ${item.bookPage} · chapter PDF p. ${item.chapterPDFPage}</p></div><div><h2>Diagram ${item.diagram}</h2><p>${item.reason}</p><label class=row><input type=checkbox class=accepted ${item.accepted?'checked':''}> Accept this correction</label><label class=row>Side <select class=side><option value="">Unknown</option><option value=w>White</option><option value=b>Black</option></select></label><label class=row>Piece placement <input class=placement placeholder="8/8/…"></label><button>Save</button></div>`;const side=e.querySelector('.side'),placement=e.querySelector('.placement');side.value=item.sideToMove||'';placement.value=item.piecePlacement||'';e.querySelector('button').onclick=()=>save({chapter:item.chapter,diagram:item.diagram,accepted:e.querySelector('.accepted').checked,sideToMove:side.value,piecePlacement:placement.value});cards.append(e)})}).catch(()=>status.textContent='Unable to load review queue');
</script>"""


def load_json(path: Path, fallback: dict) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else fallback


def main() -> None:
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--queue", default="tools/book-board-parser/work/review/queue.json")
    cli.add_argument("--overrides", default="tools/book-board-parser/work/review/overrides.json")
    cli.add_argument("--port", type=int, default=8787)
    args = cli.parse_args()
    queue_path, overrides_path = Path(args.queue), Path(args.overrides)
    if not queue_path.exists(): cli.error(f"queue does not exist: {queue_path}; run review_failures.py first")

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *handler_args, **kwargs):
            super().__init__(*handler_args, directory=str(queue_path.parent), **kwargs)

        def do_GET(self) -> None:
            if urlparse(self.path).path == "/":
                encoded = PAGE.encode()
                self.send_response(HTTPStatus.OK); self.send_header("Content-Type", "text/html; charset=utf-8"); self.send_header("Content-Length", str(len(encoded))); self.end_headers(); self.wfile.write(encoded)
                return
            if urlparse(self.path).path == "/api/queue":
                queue = load_json(queue_path, {"items": []})
                overrides = {item["diagram"]: item for item in load_json(overrides_path, {"items": []}).get("items", [])}
                for item in queue.get("items", []): item.update(overrides.get(item["diagram"], {}))
                encoded = json.dumps(queue).encode()
                self.send_response(HTTPStatus.OK); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(encoded))); self.end_headers(); self.wfile.write(encoded)
                return
            super().do_GET()

        def do_POST(self) -> None:
            if urlparse(self.path).path != "/api/overrides": self.send_error(HTTPStatus.NOT_FOUND); return
            try:
                size = int(self.headers.get("Content-Length", "0")); incoming = json.loads(self.rfile.read(size))
                queue = load_json(queue_path, {"items": []}); valid = {item["diagram"] for item in queue.get("items", [])}
                if incoming.get("diagram") not in valid or incoming.get("sideToMove", "") not in {"", "w", "b"}: raise ValueError("invalid review item")
                saved = load_json(overrides_path, {"items": []}); existing = {item["diagram"]: item for item in saved.get("items", [])}; existing[incoming["diagram"]] = {key: incoming.get(key, "") for key in ("chapter", "diagram", "accepted", "piecePlacement", "sideToMove")}; overrides_path.parent.mkdir(parents=True, exist_ok=True); overrides_path.write_text(json.dumps({"items": list(existing.values())}, indent=2) + "\n", encoding="utf-8")
                self.send_response(HTTPStatus.NO_CONTENT); self.end_headers()
            except Exception as error:
                self.send_error(HTTPStatus.BAD_REQUEST, str(error))

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Review page: http://127.0.0.1:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
