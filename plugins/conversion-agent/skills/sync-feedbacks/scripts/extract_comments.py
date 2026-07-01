"""extract_comments.py - extrai comentarios de revisao de uma lista de docs do Drive.

Recebe uma lista de URLs de documentos do Google Drive (descobertas pela MCP tool
`feedback_sources`, que devolve `rows[{txt_link, ...}]`), extrai SOMENTE os
comentarios deixados por revisores (nunca o corpo do texto), faz dedup
incremental por documento e escreve um markdown por doc num workdir temporario.
Quem persiste no projeto Conversion Agent (via MCP) e o Claude - este script so
produz dados.

Dois caminhos de extracao, escolhidos pelo mimeType de cada arquivo:

  * .docx enviado .... le word/comments.xml dentro do zip (+ trecho ancorado do
                       document.xml e thread/resolved do commentsExtended.xml).
  * Google Doc nativo. usa a Drive API comments().list - exportar p/ .docx
                       PERDE os comentarios, entao nao da pra usar o mesmo
                       caminho do .docx.

Dedup por fingerprint (nao so modifiedTime do arquivo): num Google Doc, ADICIONAR
um comentario nem sempre muda o modifiedTime do corpo. O fingerprint do doc nativo
inclui id+modifiedTime de cada comentario, entao um comentario novo e detectado.

Subcomandos:

    extract --docs <arquivo|-> --ws <ws> --proj <proj> --workdir <tmp>
            [--only-open] [--rebuild]

        Recebe as URLs dos docs (uma por linha, via --docs <arquivo> ou - p/ stdin),
        decide new/changed/skipped (manifest local), extrai os comentarios dos docs
        novos/alterados, escreve <workdir>/feedbacks/*.md, <workdir>/_summary.json e
        <workdir>/_manifest_update.json. NAO toca no manifest real (isso e o commit,
        so apos o save via MCP dar certo).

    commit  --ws <ws> --proj <proj> --workdir <tmp>

        Mescla <workdir>/_manifest_update.json no manifest real
        (~/.conversion-feedbacks/<ws>__<proj>.json). Rodar APOS o project_save_batch.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import io
import json
import os
import re
import sys
import unicodedata
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

from googleapiclient.http import MediaIoBaseDownload

from drive_auth import build_drive

# ----------------------------------------------------------------------------
# Constantes
# ----------------------------------------------------------------------------

MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
MIME_GDOC = "application/vnd.google-apps.document"
MIME_FOLDER = "application/vnd.google-apps.folder"

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W14 = "http://schemas.microsoft.com/office/word/2010/wordml"
W15 = "http://schemas.microsoft.com/office/word/2012/wordml"

STATE_DIR = Path(os.environ.get("CONVERSION_FEEDBACKS_HOME",
                                str(Path.home() / ".conversion-feedbacks")))


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _utf8_stdout() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:
        pass


# ----------------------------------------------------------------------------
# Drive helpers
# ----------------------------------------------------------------------------

def parse_file_id(value: str) -> str:
    """Extrai o fileId de um link do Drive (Docs / Drive file). Devolve o proprio
    valor se ja parecer um ID puro."""
    if not value:
        raise ValueError("link vazio")
    m = re.search(r"/d/([a-zA-Z0-9_-]+)", value)
    if m:
        return m.group(1)
    m = re.search(r"[?&]id=([a-zA-Z0-9_-]+)", value)
    if m:
        return m.group(1)
    m = re.search(r"/folders/([a-zA-Z0-9_-]+)", value)
    if m:
        return m.group(1)
    return value.strip()


def fetch_metadata(drive, file_id: str) -> dict:
    """Metadata de um arquivo do Drive (paridade com os campos que list_children
    devolvia antes: id, name, mimeType, modifiedTime, webViewLink)."""
    return drive.files().get(
        fileId=file_id,
        fields="id,name,mimeType,modifiedTime,webViewLink",
        supportsAllDrives=True,
    ).execute()


def read_docs_input(value: str) -> list[str]:
    """Le a lista de URLs/linhas do --docs: '-' = stdin, senao um arquivo.
    Uma URL por linha; linhas vazias e comentarios (#) sao ignorados."""
    if value == "-":
        raw = sys.stdin.read()
    else:
        raw = Path(value).read_text(encoding="utf-8")
    out: list[str] = []
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        out.append(line)
    return out


def download_bytes(drive, file_id: str) -> bytes:
    request = drive.files().get_media(fileId=file_id)
    buf = io.BytesIO()
    downloader = MediaIoBaseDownload(buf, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return buf.getvalue()


def list_gdoc_comments(drive, file_id: str) -> list[dict]:
    """comments().list paginado para Google Docs nativos."""
    out: list[dict] = []
    page_token: str | None = None
    fields = (
        "nextPageToken, comments(id,author/displayName,content,"
        "quotedFileContent/value,resolved,createdTime,modifiedTime,"
        "replies(author/displayName,content,createdTime))"
    )
    while True:
        resp = drive.comments().list(
            fileId=file_id,
            fields=fields,
            pageSize=100,
            includeDeleted=False,
        ).execute()
        out.extend(resp.get("comments", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return out


# ----------------------------------------------------------------------------
# Normalizacao
# ----------------------------------------------------------------------------

def _unescape(value: str) -> str:
    """A Drive comments API devolve quotedFileContent/content com entidades HTML
    (ex: &#233; -> é). Desescapa para texto limpo."""
    return html.unescape(value or "").strip()


def _normalize_gdoc(raw: list[dict]) -> list[dict]:
    norm: list[dict] = []
    for c in raw:
        norm.append({
            "author": (c.get("author") or {}).get("displayName", "(desconhecido)"),
            "created": c.get("createdTime", ""),
            "modified": c.get("modifiedTime", ""),
            "text": _unescape(c.get("content", "")),
            "quoted": _unescape((c.get("quotedFileContent") or {}).get("value", "")),
            "resolved": bool(c.get("resolved", False)),
            "id": c.get("id", ""),
            "replies": [
                {
                    "author": (r.get("author") or {}).get("displayName", "(desconhecido)"),
                    "created": r.get("createdTime", ""),
                    "text": _unescape(r.get("content", "")),
                }
                for r in (c.get("replies") or [])
            ],
        })
    return norm


# --- .docx parsing ----------------------------------------------------------

def _w(tag: str) -> str:
    return f"{{{W}}}{tag}"


def _text_of(elem) -> str:
    """Junta todos os <w:t> descendentes de um elemento."""
    parts = [t.text or "" for t in elem.iter(_w("t"))]
    return "".join(parts).strip()


def _docx_anchored_text(document_xml: bytes) -> dict[str, str]:
    """Mapeia comment id -> trecho ancorado (texto entre commentRangeStart/End)."""
    anchors: dict[str, list[str]] = {}
    open_ids: set[str] = set()
    try:
        root = ET.fromstring(document_xml)
    except ET.ParseError:
        return {}
    start_tag = _w("commentRangeStart")
    end_tag = _w("commentRangeEnd")
    text_tag = _w("t")
    id_attr = _w("id")
    for elem in root.iter():
        if elem.tag == start_tag:
            cid = elem.get(id_attr)
            if cid is not None:
                open_ids.add(cid)
                anchors.setdefault(cid, [])
        elif elem.tag == end_tag:
            cid = elem.get(id_attr)
            if cid is not None:
                open_ids.discard(cid)
        elif elem.tag == text_tag and open_ids:
            for cid in open_ids:
                anchors.setdefault(cid, []).append(elem.text or "")
    return {cid: "".join(parts).strip() for cid, parts in anchors.items()}


def _docx_extended(zf: zipfile.ZipFile) -> dict[str, dict]:
    """paraId -> {done, paraIdParent} a partir de commentsExtended.xml (se houver)."""
    try:
        data = zf.read("word/commentsExtended.xml")
    except KeyError:
        return {}
    out: dict[str, dict] = {}
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        return {}
    for ex in root.iter(f"{{{W15}}}commentEx"):
        para_id = ex.get(f"{{{W15}}}paraId")
        if para_id is None:
            continue
        done = ex.get(f"{{{W15}}}done")
        out[para_id] = {
            "done": done in ("1", "true", "True"),
            "parent": ex.get(f"{{{W15}}}paraIdParent"),
        }
    return out


def _normalize_docx(data: bytes) -> list[dict]:
    """Extrai comentarios de um .docx (bytes). Best-effort para thread/resolved."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        return []

    try:
        comments_xml = zf.read("word/comments.xml")
    except KeyError:
        return []  # documento sem comentarios

    try:
        root = ET.fromstring(comments_xml)
    except ET.ParseError:
        return []

    try:
        document_xml = zf.read("word/document.xml")
        anchors = _docx_anchored_text(document_xml)
    except KeyError:
        anchors = {}

    extended = _docx_extended(zf)

    # Map paraId (do 1o paragrafo do comentario) -> comment id, p/ casar com commentsExtended.
    raw: list[dict] = []
    paraid_to_cid: dict[str, str] = {}
    cid_to_paraid: dict[str, str] = {}
    for c in root.iter(_w("comment")):
        cid = c.get(_w("id"), "")
        first_p = c.find(_w("p"))
        para_id = first_p.get(f"{{{W14}}}paraId") if first_p is not None else None
        if para_id:
            paraid_to_cid[para_id] = cid
            cid_to_paraid[cid] = para_id
        raw.append({
            "id": cid,
            "author": c.get(_w("author"), "(desconhecido)"),
            "created": c.get(_w("date"), ""),
            "modified": c.get(_w("date"), ""),
            "text": _text_of(c),
            "quoted": anchors.get(cid, ""),
            "resolved": False,
            "para_id": para_id,
            "replies": [],
        })

    # Aplica resolved (done) e dobra respostas (paraIdParent) sob o comentario pai.
    by_cid = {c["id"]: c for c in raw}
    roots: list[dict] = []
    for c in raw:
        para_id = c.get("para_id")
        ext = extended.get(para_id) if para_id else None
        parent_para = ext.get("parent") if ext else None
        if ext and ext.get("done"):
            c["resolved"] = True
        if parent_para and parent_para in paraid_to_cid:
            parent_cid = paraid_to_cid[parent_para]
            parent = by_cid.get(parent_cid)
            if parent is not None and parent is not c:
                parent["replies"].append({
                    "author": c["author"],
                    "created": c["created"],
                    "text": c["text"],
                })
                continue
        roots.append(c)

    # Se o threading nao resolveu nada (sem commentsExtended), devolve a lista plana.
    result = roots if roots else raw
    for c in result:
        c.pop("para_id", None)
    return result


# ----------------------------------------------------------------------------
# Fingerprint + slug
# ----------------------------------------------------------------------------

def fingerprint(comments: list[dict], file_modified: str, is_gdoc: bool) -> str:
    """Assinatura do estado de comentarios do doc para dedup."""
    if is_gdoc:
        basis = "|".join(sorted(f"{c.get('id','')}:{c.get('modified','')}" for c in comments))
    else:
        # .docx: comentarios vivem no arquivo; modifiedTime do arquivo + n. comentarios.
        basis = f"{file_modified}:{len(comments)}"
    return hashlib.sha1(basis.encode("utf-8")).hexdigest()


def slugify(name: str) -> str:
    name = name.rsplit(".", 1)[0] if name.lower().endswith(".docx") else name
    # Translitera acentos (á->a, ó->o, ç->c) antes de remover nao-alfanumericos.
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return (s or "doc")[:80].strip("-")


# ----------------------------------------------------------------------------
# Markdown
# ----------------------------------------------------------------------------

def render_markdown(doc: dict, comments: list[dict]) -> str:
    resolved_count = sum(1 for c in comments if c.get("resolved"))
    fm = [
        "---",
        "type: feedback",
        "source: google-drive",
        f"source_doc_id: {doc['id']}",
        f"source_name: {json.dumps(doc['name'], ensure_ascii=False)}",
        f"source_url: {doc.get('webViewLink', '')}",
        f"source_modified_time: {doc.get('modifiedTime', '')}",
        f"extracted_at: {_now_iso()}",
        f"comment_count: {len(comments)}",
        f"resolved_count: {resolved_count}",
        "---",
        "",
        f"# Feedbacks - {doc['name']}",
        "",
    ]
    body: list[str] = []
    for i, c in enumerate(comments, 1):
        flags = " - [RESOLVIDO]" if c.get("resolved") else ""
        date = (c.get("created") or "")[:10]
        head = f"## Comentario {i} - {c.get('author', '(desconhecido)')}"
        if date:
            head += f" - {date}"
        head += flags
        body.append(head)
        quoted = c.get("quoted")
        if quoted:
            for line in quoted.splitlines() or [quoted]:
                body.append(f"> {line}")
            body.append("")
        text = c.get("text") or "_(comentario vazio)_"
        body.append(text)
        for r in c.get("replies", []):
            rdate = (r.get("created") or "")[:10]
            rtext = r.get("text") or "_(sem texto)_"
            body.append(f"  - resposta de {r.get('author','(desconhecido)')}"
                        + (f" ({rdate})" if rdate else "") + f": {rtext}")
        body.append("")
    return "\n".join(fm + body).rstrip() + "\n"


# ----------------------------------------------------------------------------
# Manifest
# ----------------------------------------------------------------------------

def manifest_path(ws: str, proj: str) -> Path:
    safe = re.sub(r"[^a-zA-Z0-9_-]+", "-", f"{ws}__{proj}")
    return STATE_DIR / f"{safe}.json"


def load_manifest(ws: str, proj: str) -> dict:
    p = manifest_path(ws, proj)
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {"docs": {}}
    return {"docs": {}}


# ----------------------------------------------------------------------------
# Comandos
# ----------------------------------------------------------------------------

def cmd_extract(args) -> int:
    workdir = Path(args.workdir).resolve()
    feedbacks_dir = workdir / "feedbacks"
    feedbacks_dir.mkdir(parents=True, exist_ok=True)

    drive = build_drive()
    # As URLs vem da MCP tool feedback_sources (rows[].txt_link). Resolve cada
    # uma para fileId; dedup de ids repetidos preservando a ordem de entrada.
    urls = read_docs_input(args.docs)
    seen_ids: set[str] = set()
    file_ids: list[str] = []
    for url in urls:
        fid = parse_file_id(url)
        if fid not in seen_ids:
            seen_ids.add(fid)
            file_ids.append(fid)

    manifest = {} if args.rebuild else load_manifest(args.ws, args.proj).get("docs", {})

    summary: list[dict] = []
    manifest_update: dict[str, dict] = {}

    for doc_id in file_ids:
        # Metadata por arquivo (substitui o listing da pasta).
        try:
            entry = fetch_metadata(drive, doc_id)
        except Exception as exc:  # nunca derruba a rodada inteira por 1 doc
            summary.append({"doc_id": doc_id, "name": doc_id, "status": "error", "error": str(exc)})
            continue

        mime = entry.get("mimeType", "")
        name = entry.get("name", "")
        is_gdoc = mime == MIME_GDOC
        is_docx = mime == MIME_DOCX or name.lower().endswith(".docx")
        if mime == MIME_FOLDER or not (is_gdoc or is_docx):
            summary.append({"doc_id": doc_id, "name": name, "status": "error",
                            "error": f"tipo nao suportado: {mime or '(desconhecido)'}"})
            continue

        file_modified = entry.get("modifiedTime", "")

        # Extrai comentarios (para .docx, fingerprint precisa do conteudo; p/ gdoc tambem).
        try:
            if is_gdoc:
                comments = _normalize_gdoc(list_gdoc_comments(drive, doc_id))
            else:
                comments = _normalize_docx(download_bytes(drive, doc_id))
        except Exception as exc:  # nunca derruba a rodada inteira por 1 doc
            summary.append({"doc_id": doc_id, "name": name, "status": "error", "error": str(exc)})
            continue

        if args.only_open:
            comments = [c for c in comments if not c.get("resolved")]

        fp = fingerprint(comments, file_modified, is_gdoc)
        prev = manifest.get(doc_id)
        if prev and prev.get("fingerprint") == fp and not args.rebuild:
            summary.append({"doc_id": doc_id, "name": name, "status": "skipped",
                            "comment_count": len(comments)})
            continue

        status = "changed" if prev else "new"
        if not comments:
            # Sem comentarios: registra no manifest p/ nao reprocessar, mas nao gera arquivo.
            manifest_update[doc_id] = {"fingerprint": fp, "modifiedTime": file_modified, "name": name}
            summary.append({"doc_id": doc_id, "name": name, "status": "no-comments"})
            continue

        doc = {"id": doc_id, "name": name, "webViewLink": entry.get("webViewLink", ""),
               "modifiedTime": file_modified}
        md = render_markdown(doc, comments)
        rel = f"feedbacks/{slugify(name)}-{doc_id[:8]}.md"
        (workdir / rel).write_text(md, encoding="utf-8")

        manifest_update[doc_id] = {"fingerprint": fp, "modifiedTime": file_modified, "name": name}
        summary.append({
            "doc_id": doc_id, "name": name, "status": status, "path": rel,
            "comment_count": len(comments),
            "resolved_count": sum(1 for c in comments if c.get("resolved")),
            "source_url": entry.get("webViewLink", ""),
        })

    (workdir / "_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2),
                                           encoding="utf-8")
    (workdir / "_manifest_update.json").write_text(
        json.dumps(manifest_update, ensure_ascii=False, indent=2), encoding="utf-8")

    # Resumo legivel no stdout.
    counts: dict[str, int] = {}
    for s in summary:
        counts[s["status"]] = counts.get(s["status"], 0) + 1
    print(json.dumps({
        "total_docs_input": len(file_ids),
        "counts": counts,
        # round_id identifica ESTA rodada -> o arquivo de propostas do brain e
        # brain/_pending-feedbacks-<round_id>.md (um arquivo por rodada, nunca
        # sobrescrito por rodadas futuras).
        "round_id": datetime.now(timezone.utc).strftime("%Y-%m-%d-%H%M"),
        "to_save": [s for s in summary if s["status"] in ("new", "changed")],
        "workdir": str(workdir),
    }, ensure_ascii=False, indent=2))
    return 0


def cmd_commit(args) -> int:
    workdir = Path(args.workdir).resolve()
    update_file = workdir / "_manifest_update.json"
    if not update_file.exists():
        print(f"[ERRO] {update_file} nao existe. Rode 'extract' antes.", file=sys.stderr)
        return 1
    updates = json.loads(update_file.read_text(encoding="utf-8"))

    STATE_DIR.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest(args.ws, args.proj)
    docs = manifest.setdefault("docs", {})
    now = _now_iso()
    for doc_id, info in updates.items():
        info = dict(info)
        info["last_processed"] = now
        docs[doc_id] = info
    manifest["updated_at"] = now
    manifest_path(args.ws, args.proj).write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK. Manifest atualizado: {len(updates)} doc(s) marcados como processados em "
          f"{manifest_path(args.ws, args.proj)}.")
    return 0


def main() -> int:
    _utf8_stdout()
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    pe = sub.add_parser("extract", help="Le os docs informados, extrai comentarios, escreve no workdir.")
    pe.add_argument("--docs", required=True,
                    help="arquivo com uma URL de doc por linha (ou '-' p/ stdin)")
    pe.add_argument("--ws", required=True, help="workspace slug do projeto alvo")
    pe.add_argument("--proj", required=True, help="project slug do projeto alvo")
    pe.add_argument("--workdir", required=True, help="diretorio temporario de saida")
    pe.add_argument("--only-open", action="store_true",
                    help="ignora comentarios resolvidos (default: inclui e sinaliza)")
    pe.add_argument("--rebuild", action="store_true",
                    help="ignora o manifest e reprocessa todos os docs")
    pe.set_defaults(func=cmd_extract)

    pc = sub.add_parser("commit", help="Mescla _manifest_update.json no manifest real.")
    pc.add_argument("--ws", required=True)
    pc.add_argument("--proj", required=True)
    pc.add_argument("--workdir", required=True)
    pc.set_defaults(func=cmd_commit)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
