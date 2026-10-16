## gdi_notes — the Org training diary as per-activity notes and tags.
##
## The diary (e.g. `~/org/exercise.org`, `gdi serve --notes FILE`) is the
## source of truth and is read with orgParser's lossless mode. One level-1
## heading per day:
##
##   * <2025-04-27 Sun 09:51> optional title                    :trail:shins:
##   :PROPERTIES:
##   :GARMIN_ID: 18948065614 18948099999
##   :END:
##   Free text, pasted Garmin stats blocks, sub-headings …
##
## An entry belongs to the activities in its `:GARMIN_ID:` (see
## `gdi link-notes`), or — not yet linked — to the activities whose Connect
## URLs it mentions; entries with neither are day notes. The web UI only
## changes tags (`saveTags`) and appends timestamped messages (`appendNote`);
## the prose stays Emacs territory. Each write re-reads the file first, so
## edits made elsewhere are kept, and writes atomically.

import std / [os, json, strutils, re, times, tables, sequtils, sets]
import db_connector / db_sqlite
import orgparser
import gdi_db

let urlRe = re"connect\.garmin\.com/(?:modern|app)/activity/(\d+)"
let dateRe = re"<(\d{4}-\d{2}-\d{2})"
# lines of a pasted Garmin summary ("11.24 km Distance", "1:13:19 Time", …)
let statRe = re("^\\s*[-\\d:.,]+\\s*(/km|km|m|bpm|spm|kcal|W|%|/100m|km/h)?\\s+" &
  "(Distance|Time|Moving Time|Elapsed Time|Avg Pace|Best Pace|Avg Speed|Max Speed|" &
  "Total Ascent|Total Descent|Calories|Avg HR|Max HR|Avg Cadence|Avg Power|" &
  "Elevation range|Avg GAP|Training Effect)\\s*$")
let connectRe = re"^\s*https?://connect\.garmin\.com/\S+\s*$"

type
  DiaryEntry* = object
    node*: OrgNode
    date*: string
    ids*: seq[int]
    linked*: bool          ## ids come from :GARMIN_ID: (else from URLs)

proc defaultNotesFile*(activityDir: string): string =
  activityDir.absolutePath.parentDir / "exercise-notes.org"

proc cleanTag*(t: string): string =
  ## Org tags allow letters, digits, _ @ # %; we also lowercase.
  for c in t.strip.toLowerAscii:
    result.add(if c.isAlphaNumeric or c in {'_', '@', '#', '%'}: c else: '_')

proc drawerIndex(body: OrgNode): int =
  ## index of a property drawer directly below the heading, else -1
  for i, x in body.children:
    if x.kind == ogText and x.text.strip.len == 0: continue
    return (if x.kind == ogPropertyList: i else: -1)
  -1

proc entries*(org: OrgNode): seq[DiaryEntry] =
  {.cast(gcsafe).}:
    for x in org:
      if x.kind != ogSection or x.sec.level != 1: continue
      var e = DiaryEntry(node: x)
      var m: array[1, string]
      if x.sec.rawHeading.find(dateRe, m) >= 0 or ($x.sec.title).find(dateRe, m) >= 0:
        e.date = m[0]
      let di = drawerIndex(x.sec.body)
      if di >= 0:
        for p in x.sec.body.children[di].propList:
          if p.key.toUpperAscii == "GARMIN_ID":
            for t in ($p.value).splitWhitespace:
              try: e.ids.add parseInt(t) except ValueError: discard
      e.linked = e.ids.len > 0
      if not e.linked:
        var seen = initHashSet[int]()
        for s in ($x).findAll(urlRe):
          var mm: array[1, string]
          if s.match(urlRe, mm) and parseInt(mm[0]) notin seen:
            seen.incl parseInt(mm[0]); e.ids.add parseInt(mm[0])
      result.add e

proc displayText*(e: DiaryEntry): string =
  ## The entry's text for display: body without the drawer and without
  ## pasted Garmin stats blocks / Connect URLs; blank-line runs collapsed.
  {.cast(gcsafe).}:
    var parts: seq[string]
    let di = drawerIndex(e.node.sec.body)
    for i, x in e.node.sec.body.children:
      if i != di: parts.add $x
    var outL: seq[string]
    for l in parts.join("").splitLines:
      if l.match(statRe) or l.match(connectRe): continue
      if l.strip.len == 0 and (outL.len == 0 or outL[^1].strip.len == 0): continue
      outL.add l
    outL.join("\n").strip

proc importNotes*(db: DbConn, path: string, force = false): bool =
  ## Re-read the diary into `activity_notes` / `day_notes` when it changed.
  if path.len == 0: return false
  let key = path.absolutePath
  var mtime, size = "0"
  if fileExists(key):
    let info = getFileInfo(key)
    mtime = $info.lastWriteTime.toUnix
    size = $info.size
  let prev = db.getRow(sql"SELECT mtime, size FROM files WHERE path = ?", key)
  if not force and prev[0] == mtime and prev[1] == size: return false
  let es = (if fileExists(key): entries(parseOrg(key)) else: @[])
  db.exec(sql"BEGIN")
  db.exec(sql"DELETE FROM activity_notes")
  db.exec(sql"DELETE FROM day_notes")
  for e in es:
    let tags = $(%e.node.sec.tags)
    let text = displayText(e)
    if e.ids.len == 0:
      db.exec(sql"INSERT INTO day_notes(date, tags, note) VALUES (?, ?, ?)", e.date, tags, text)
    for id in e.ids:
      # several entries may mention one activity: keep the linked / first one
      if db.getValue(sql"SELECT 1 FROM activity_notes WHERE activity_id = ?", id).len == 0:
        db.exec(sql"""INSERT INTO activity_notes(activity_id, date, tags, note, shared_with)
                      VALUES (?, ?, ?, ?, ?)""", id, e.date, tags, text,
                $(%e.ids.filterIt(it != id)))
  db.exec(sql"INSERT OR REPLACE INTO files(path, kind, mtime, size, imported_at) VALUES (?, 'notes', ?, ?, ?)",
          key, mtime, size, $getTime().toUnix)
  db.exec(sql"COMMIT")
  true

# ── writing (tags + append only) ────────────────────────────────────────────

proc orgStamp(startLocal: string, active = true): string =
  ## "2026-10-16T10:14:46.0" → "<2026-10-16 Fri 10:14>" (or "[…]")
  let (o, c) = (if active: ("<", ">") else: ("[", "]"))
  try:
    let dt = parse(startLocal[0 ..< 16], "yyyy-MM-dd'T'HH:mm")
    o & dt.format("yyyy-MM-dd ddd HH:mm") & c
  except CatchableError: o & startLocal & c

proc writeDiary(path: string, org: OrgNode) =
  let tmp = path & ".gdi.tmp"
  writeFile(tmp, $org)
  moveFile(tmp, path)

proc findOrCreate(db: DbConn, org: OrgNode, id: int): OrgNode =
  ## The entry for activity `id`; a new dated heading (in date order) if none.
  {.cast(gcsafe).}:
    for e in entries(org):
      if id in e.ids: return e.node
    let r = db.getRow(sql"SELECT start_local, name FROM activities WHERE id = ?", id)
    if r[0].len == 0: raise newException(ValueError, "unknown activity " & $id)
    let text = "* " & orgStamp(r[0]) & " " & r[1] & "\n:PROPERTIES:\n:GARMIN_ID: " & $id & "\n:END:\n"
    var newSec: OrgNode
    for x in parseOrgString(text):
      if x.kind == ogSection: newSec = x
    # insert before the first entry dated after this activity
    let day = r[0][0 ..< 10]
    var at = org.children.len
    for i, x in org.children:
      if x.kind == ogSection and x.sec.level == 1:
        var m: array[1, string]
        if x.sec.rawHeading.find(dateRe, m) >= 0 and m[0] > day:
          at = i; break
    if at == org.children.len:
      let cur = $org
      if cur.len > 0 and not cur.endsWith("\n"):
        org.children.add OrgNode(kind: ogText, text: "\n")
      at = org.children.len
    org.children.insert(newSec, at)
    newSec

proc saveTags*(db: DbConn, path: string, id: int, tags: seq[string]) =
  ## Set the tags of activity `id`'s diary entry (creating the entry if needed).
  var ts: seq[string]
  for t in tags:
    let c = cleanTag(t)
    if c.len > 0 and c notin ts: ts.add c
  let org = (if fileExists(path): parseOrg(path) else: parseOrgString(""))
  let sec = findOrCreate(db, org, id)
  sec.setTags(ts)
  writeDiary(path, org)
  discard db.importNotes(path, force = true)

proc appendNote*(db: DbConn, path: string, id: int, text: string) =
  ## Append "[timestamp] text" after the entry's own text (before any
  ## sub-heading) of activity `id`'s diary entry.
  let msg = text.strip.replace("\r\n", "\n")
  if msg.len == 0: return
  var lines = msg.splitLines
  for l in lines.mitems:
    if l.startsWith("*"): l = " " & l      # never start a heading
  let stamped = orgStamp(now().format("yyyy-MM-dd'T'HH:mm"), active = false) & " " & lines.join("\n")
  let org = (if fileExists(path): parseOrg(path) else: parseOrgString(""))
  let sec = findOrCreate(db, org, id)
  let body = sec.sec.body
  var k = body.children.len
  for i, x in body.children:
    if x.kind == ogSection: k = i; break
  var before = ""
  for i in 0 ..< k: before.add $body.children[i]
  let prefix = (if before.len == 0 or before.endsWith("\n\n"): ""
                elif before.endsWith("\n"): "\n" else: "\n\n")
  # when another heading follows, the newline ending this entry belongs to
  # the parent level; add our own only where nothing else ends the line
  let suffix = (if k < body.children.len or before.endsWith("\n") or before.len == 0: "\n" else: "")
  body.children.insert(OrgNode(kind: ogText, text: prefix & stamped & suffix), k)
  writeDiary(path, org)
  discard db.importNotes(path, force = true)

proc allTags*(db: DbConn): CountTable[string] =
  for r in db.rows(sql"SELECT tags FROM activity_notes UNION ALL SELECT tags FROM day_notes"):
    for t in parseJson(r[0]): result.inc t.getStr
