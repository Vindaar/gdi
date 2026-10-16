## gdi_notes — per-activity notes and tags, kept in an Org file.
##
## The file (default: `exercise-notes.org` next to `exercise-history.raw`) is
## the source of truth; you, an editor or the assistant may write it, and the
## web UI edits it through `saveNote`. One level-1 heading per activity:
##
##   * <2026-10-16 Fri 10:14> Zaragoza Running                 :loop:easy:
##   :PROPERTIES:
##   :GARMIN_ID: 24742486524
##   :END:
##   Free text (any Org, sub-headings included) until the next level-1 heading.
##
## Headings without a :GARMIN_ID: property and text before the first heading
## are left alone.

import std / [os, json, strutils, re, times, algorithm, tables, sequtils]
import db_connector / db_sqlite
import gdi_db

type
  NoteEntry* = object
    id*: int
    tags*: seq[string]
    body*: string
    first*, last*: int        ## line range of the entry in the file (inclusive)

const TagSep = ":"

template filterIt(xs: seq[string], cond: untyped): seq[string] =
  block:
    var res: seq[string]
    for it {.inject.} in xs:
      if cond: res.add it
    res


proc defaultNotesFile*(activityDir: string): string =
  activityDir.absolutePath.parentDir / "exercise-notes.org"

proc cleanTag*(t: string): string =
  ## Org tags allow letters, digits, _ @ # %; we also lowercase.
  for c in t.strip.toLowerAscii:
    result.add(if c.isAlphaNumeric or c in {'_', '@', '#', '%'}: c else: '_')

proc splitHeading(line: string): (string, seq[string]) =
  ## "* title   :a:b:" → ("* title", @["a", "b"])
  var m: array[2, string]
  if line.match(re"^(\*.*?)\s+(:[\w@#%:]+:)\s*$", m):
    (m[0], m[1].strip(chars = {':'}).split(TagSep).filterIt(it.len > 0))
  else:
    (line.strip(leading = false), @[])

proc parseNotes*(lines: seq[string]): seq[NoteEntry] =
  var i = 0
  while i < lines.len:
    if not lines[i].startsWith("* "):
      inc i; continue
    let start = i
    var stop = i + 1
    while stop < lines.len and not lines[stop].startsWith("* "): inc stop
    # properties drawer right below the heading
    var id = 0
    var bodyStart = start + 1
    if bodyStart < stop and lines[bodyStart].strip == ":PROPERTIES:":
      var k = bodyStart + 1
      while k < stop and lines[k].strip != ":END:":
        let p = lines[k].strip
        if p.toUpperAscii.startsWith(":GARMIN_ID:"):
          try: id = parseInt(p[":GARMIN_ID:".len .. ^1].strip) except ValueError: discard
        inc k
      bodyStart = k + 1
    if id != 0:
      let (_, tags) = splitHeading(lines[start])
      var body = lines[min(bodyStart, stop) ..< stop].join("\n").strip(chars = {'\n', ' '})
      result.add NoteEntry(id: id, tags: tags, body: body, first: start, last: stop - 1)
    i = stop

proc readLines(path: string): seq[string] =
  if fileExists(path): readFile(path).splitLines else: @[]

proc importNotes*(db: DbConn, path: string, force = false): bool =
  ## Re-read the notes file into `activity_notes` when it changed (tracked in
  ## `files` like the raw data). Returns true if anything was (re)loaded.
  if path.len == 0: return false
  let key = path.absolutePath
  var mtime, size = "0"
  if fileExists(key):
    let info = getFileInfo(key)
    mtime = $info.lastWriteTime.toUnix
    size = $info.size
  let prev = db.getRow(sql"SELECT mtime, size FROM files WHERE path = ?", key)
  if not force and prev[0] == mtime and prev[1] == size: return false
  db.exec(sql"BEGIN")
  db.exec(sql"DELETE FROM activity_notes")
  for e in parseNotes(readLines(key)):
    db.exec(sql"INSERT OR REPLACE INTO activity_notes(activity_id, tags, note) VALUES (?, ?, ?)",
            e.id, $(%e.tags), e.body)
  db.exec(sql"INSERT OR REPLACE INTO files(path, kind, mtime, size, imported_at) VALUES (?, 'notes', ?, ?, ?)",
          key, mtime, size, $getTime().toUnix)
  db.exec(sql"COMMIT")
  true

proc orgStamp(startLocal: string): string =
  ## "2026-10-16T10:14:46.0" → "<2026-10-16 Fri 10:14>"
  try:
    let dt = parse(startLocal[0 ..< 16], "yyyy-MM-dd'T'HH:mm")
    "<" & dt.format("yyyy-MM-dd ddd HH:mm") & ">"
  except CatchableError: "<" & startLocal & ">"

proc headingLine(title: string, tags: seq[string]): string =
  if tags.len == 0: return title
  let t = ":" & tags.join(TagSep) & ":"
  # right-align the tags at column 77 like Org does (at least one space)
  title & spaces(max(1, 77 - title.len - t.len)) & t

proc saveNote*(db: DbConn, path: string, id: int, tags: seq[string], body: string) =
  ## Write one activity's tags and text into the notes file (atomic replace)
  ## and reload it. Empty tags + text remove the entry, unless it carries
  ## other properties.
  var tags = tags
  for t in tags.mitems: t = cleanTag(t)
  tags = tags.filterIt(it.len > 0)
  tags = deduplicate(tags)
  let body = body.strip(chars = {'\n', ' ', '\r'}).replace("\r\n", "\n")
  var lines = readLines(path)
  if lines.len > 0 and lines[^1] == "": lines.setLen(lines.len - 1)
  let entries = parseNotes(lines)
  # a body line starting with "* " would start a new entry → demote it
  var bodyLines = (if body.len > 0: body.splitLines else: @[])
  for l in bodyLines.mitems:
    if l.startsWith("* "): l = "*" & l
  var existing = -1
  for k, e in entries:
    if e.id == id: existing = k
  if existing >= 0:
    let e = entries[existing]
    let (title, _) = splitHeading(lines[e.first])
    # keep the properties drawer as it is
    var drawer: seq[string]
    var k = e.first + 1
    if k <= e.last and lines[k].strip == ":PROPERTIES:":
      while k <= e.last:
        drawer.add lines[k]
        if lines[k].strip == ":END:": break
        inc k
    let onlyId = drawer.len <= 3
    var repl: seq[string]
    if tags.len > 0 or bodyLines.len > 0 or not onlyId:
      repl = @[headingLine(title, tags)] & drawer & bodyLines
      if e.last + 1 < lines.len: repl.add ""
    lines = lines[0 ..< e.first] & repl & lines[e.last + 1 .. ^1]
  elif tags.len > 0 or bodyLines.len > 0:
    let r = db.getRow(sql"SELECT start_local, name FROM activities WHERE id = ?", id)
    let title = "* " & orgStamp(r[0]) & " " & r[1]
    let entry = @[headingLine(title, tags), ":PROPERTIES:", ":GARMIN_ID: " & $id, ":END:"] & bodyLines
    # chronological position: before the first entry with a later timestamp
    var at = lines.len
    let stamp = orgStamp(r[0])
    for e in entries:
      let i0 = lines[e.first].find('<')
      if i0 >= 0 and lines[e.first][i0 .. min(lines[e.first].high, i0 + 21)] > stamp:
        at = e.first; break
    if lines.len == 0:
      lines = @["#+TITLE: Exercise notes",
                "#+COMMENT: One heading per activity (:GARMIN_ID:), tags on the heading.",
                "#+COMMENT: Read by the Garmin dashboard (gdi); edits there are written back here.",
                ""]
      at = lines.len
    if at == lines.len:
      if lines.len > 0 and lines[^1] != "": lines.add ""
      lines.add entry
    else:
      lines = lines[0 ..< at] & entry & @[""] & lines[at .. ^1]
  let tmp = path & ".tmp"
  createDir(path.parentDir)
  writeFile(tmp, lines.join("\n") & "\n")
  moveFile(tmp, path)
  discard db.importNotes(path, force = true)

proc allTags*(db: DbConn): CountTable[string] =
  for r in db.rows(sql"SELECT tags FROM activity_notes"):
    for t in parseJson(r[0]): result.inc t.getStr
