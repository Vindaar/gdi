## gdi link-notes — add `:GARMIN_ID:` drawers to a training diary in Org.
##
## For every level-1 heading (one per day): collect the Garmin Connect
## activity IDs mentioned anywhere in its subtree (…/modern/activity/<id> or
## …/app/activity/<id>) and record them as `:GARMIN_ID: <id> [<id> …]` in a
## property drawer directly below the heading. A URL in the entry is taken as
## proof that the notes belong to that activity; the heading's date is only
## cross-checked against the activity's start date (±1 day for time zones /
## after-midnight entries). An ID mentioned under several headings (e.g. a
## later reference to an earlier run) is linked only where the dates agree.
## Entries without a URL can optionally be linked by date when exactly one
## activity exists that day (`--byDate`).
##
## The file is parsed with orgParser's lossless mode: apart from the inserted
## drawer lines every byte stays identical, which is verified before writing.
## Prints only counts, dates, line numbers and IDs — never diary text.

import std / [os, osproc, re, strutils, strformat, tables, sets, times, sequtils, algorithm]
import db_connector / db_sqlite
import orgparser

type
  Entry = object
    node: OrgNode
    line: int            # 1-based line of the heading
    date: string         # YYYY-MM-DD from the heading, "" if none
    ids: seq[int]        # IDs found in the subtree (in order, unique)
    existing: seq[int]   # IDs already in a :GARMIN_ID: property
    drawer: OrgNode      # existing property drawer directly below the heading
    planning: bool       # SCHEDULED/CLOSED/DEADLINE line below the heading

let urlRe = re"connect\.garmin\.com/(?:modern|app)/activity/(\d+)"
let dateRe = re"<(\d{4}-\d{2}-\d{2})"

proc dayDiff(a, b: string): int =
  try:
    let da = parse(a, "yyyy-MM-dd", utc())
    let db = parse(b, "yyyy-MM-dd", utc())
    abs((da - db).inDays.int)
  except CatchableError: 9999

proc firstContent(body: OrgNode): (int, OrgNode) =
  ## index and node of the first child that is not a blank text node
  for i, x in body.children:
    if x.kind == ogText and x.text.strip.len == 0: continue
    return (i, x)
  (-1, nil)

proc collect(src: string, org: OrgNode): seq[Entry] =
  # heading line numbers: walk the source in parallel with the top-level sections
  var lineOf: seq[int]
  var ln = 1
  var atBol = true
  for i, c in src:
    if atBol and c == '*' and i + 1 < src.len and src[i + 1] == ' ': lineOf.add ln
    atBol = c == '\n'
    if c == '\n': inc ln
  var k = 0
  for x in org:
    if x.kind != ogSection: continue
    var e = Entry(node: x)
    let head = x.sec.rawHeading
    # map to the line counter (sections only count level-1 headings here)
    while k < lineOf.len:
      let l = lineOf[k]
      inc k
      e.line = l
      break
    var m: array[1, string]
    if head.find(dateRe, m) >= 0: e.date = m[0]
    let text = $x
    var seen = initHashSet[int]()
    for s in text.findAll(urlRe):
      var mm: array[1, string]
      if s.match(urlRe, mm):
        let id = parseInt(mm[0])
        if id notin seen: seen.incl id; e.ids.add id
    let (_, fc) = firstContent(x.sec.body)
    if fc != nil and fc.kind == ogPropertyList:
      e.drawer = fc
      for p in fc.propList:
        if p.key.toUpperAscii == "GARMIN_ID":
          for t in ($p.value).splitWhitespace:
            try: e.existing.add parseInt(t) except ValueError: discard
    elif fc != nil and fc.kind == ogText and
         ["SCHEDULED:", "CLOSED:", "DEADLINE:"].anyIt(fc.text.strip.startsWith(it)):
      e.planning = true
    result.add e

proc linkNotes*(notes: string, db = "data/gdi.sqlite", write = false, byDate = false,
                verbose = false) =
  ## Link diary entries to Garmin activities via `:GARMIN_ID:` drawers.
  ## Dry run unless `--write`; writes a timestamped backup first.
  let src = readFile(notes)
  let org = parseOrgString(src)
  doAssert $org == src, "orgParser does not round-trip this file exactly — aborting"
  let conn = open(db, "", "", "")
  defer: conn.close()
  var actDate = initTable[int, string]()
  var actsOn = initTable[string, seq[int]]()
  for r in conn.rows(sql"SELECT id, substr(start_local, 1, 10) FROM activities WHERE dq_flags IS NULL OR dq_flags NOT LIKE '%duplicate_of%'"):
    actDate[parseInt(r[0])] = r[1]
    actsOn.mgetOrPut(r[1], @[]).add parseInt(r[0])
  var entries = collect(src, org)

  # an ID under several headings: keep it where the dates agree best
  var owners = initTable[int, seq[int]]()
  for i, e in entries:
    for id in e.ids: owners.mgetOrPut(id, @[]).add i
  var drop = initTable[int, HashSet[int]]()     # entry → ids not to link there
  var multiClaim = 0
  for id, es in owners:
    if es.len < 2: continue
    inc multiClaim
    let ad = actDate.getOrDefault(id)
    var best = es[0]
    for i in es:
      if ad.len > 0 and dayDiff(entries[i].date, ad) < dayDiff(entries[best].date, ad): best = i
    for i in es:
      if i != best: drop.mgetOrPut(i, initHashSet[int]()).incl id
    if verbose:
      echo &"  ID {id} (activity {ad}) mentioned at lines " &
           es.mapIt($entries[it].line & " (" & entries[it].date & ")").join(", ") &
           &" → linked at line {entries[best].line}"

  var nEntries, nWithUrl, nAlready, nLinked, nByDate, nNoUrl, nPlanning = 0
  var unknownIds, farDates: seq[string]
  var tzShift = 0
  var noUrlDates: seq[string]
  var claimed = initHashSet[int]()
  for e in entries:
    for id in e.ids: claimed.incl id
    for id in e.existing: claimed.incl id
  for i, e in entries.mpairs:
    inc nEntries
    var link = e.ids.filterIt(it notin drop.getOrDefault(i))
    if e.ids.len > 0: inc nWithUrl
    for id in link:
      if id notin actDate: unknownIds.add &"line {e.line} ({e.date}): {id}"
      else:
        let d = dayDiff(e.date, actDate[id])
        if d == 1: inc tzShift
        elif d > 1: farDates.add &"line {e.line}: heading {e.date}, activity {id} on {actDate[id]}"
    if link.len == 0 and e.ids.len == 0:
      inc nNoUrl
      let cands = actsOn.getOrDefault(e.date).filterIt(it notin claimed)
      if byDate and cands.len == 1:
        link = cands
        inc nByDate
        claimed.incl cands[0]
      elif e.date.len > 0 and cands.len > 0:
        noUrlDates.add &"line {e.line} ({e.date}): {cands.len} unlinked activit{(if cands.len == 1: \"y\" else: \"ies\")} that day"
    let missing = link.filterIt(it notin e.existing)
    if missing.len == 0:
      if e.existing.len > 0: inc nAlready
      continue
    if e.planning:
      inc nPlanning
      if verbose: echo &"skip line {e.line}: planning line below heading"
      continue
    let all = e.existing & missing
    let value = OrgNode(kind: ogText, text: all.mapIt($it).join(" "))
    if e.drawer != nil:
      # keep the drawer's own lines verbatim; add or replace only :GARMIN_ID:
      let rawDrawer = (if e.drawer.raw.len > 0: e.drawer.raw else: $e.drawer)
      var ls = rawDrawer.split('\n')
      var replaced = false
      for l in ls.mitems:
        if l.strip.toUpperAscii.startsWith(":GARMIN_ID:"):
          l = ":GARMIN_ID: " & value.text; replaced = true
      if not replaced:
        for k in 0 ..< ls.len:
          if ls[k].strip.toUpperAscii == ":END:":
            ls.insert(":GARMIN_ID: " & value.text, k); break
      let (idx, _) = firstContent(e.node.sec.body)
      e.node.sec.body.children[idx] = OrgNode(kind: ogText, text: ls.join("\n"))
    else:
      let drawer = OrgNode(kind: ogPropertyList, propList: @[Property(key: "GARMIN_ID", value: value)])
      e.node.sec.body.children.insert(OrgNode(kind: ogText, text: "\n"), 0)
      e.node.sec.body.children.insert(drawer, 0)
    inc nLinked

  echo &"entries (level-1 headings): {nEntries}"
  echo &"  with Connect URL(s):        {nWithUrl}"
  echo &"  already linked:             {nAlready}"
  echo &"  to be linked:               {nLinked}" & (if byDate: &"  (of which by date: {nByDate})" else: "")
  echo &"  without URL:                {nNoUrl}  ({noUrlDates.len} of them on a day with unlinked activities" &
       (if byDate: ")" else: "; --byDate links those with exactly one)")
  echo &"  skipped (planning line):    {nPlanning}"
  echo &"IDs under several headings:   {multiClaim} (linked only where the date matches best)"
  echo &"heading date ±1 day off:      {tzShift} (time zone / written after midnight — fine)"
  echo &"heading date >1 day off:      {farDates.len}"
  for x in farDates: echo "  ", x
  echo &"IDs not in the activity DB:   {unknownIds.len}"
  for x in unknownIds: echo "  ", x
  if verbose:
    for x in noUrlDates: echo "  no URL: ", x

  let output = $org
  # verify with diff(1): only added lines, except a replaced :GARMIN_ID: line
  let a = src.splitLines
  let b = output.splitLines
  let tmpA = getTempDir() / "gdi-linknotes-a.org"
  let tmpB = getTempDir() / "gdi-linknotes-b.org"
  writeFile(tmpA, src); writeFile(tmpB, output)
  let (dout, _) = execCmdEx("diff " & quoteShell(tmpA) & " " & quoteShell(tmpB))
  removeFile(tmpA); removeFile(tmpB)
  var removed, added = 0
  for l in dout.splitLines:
    if l.startsWith("< "):
      if not l[2 .. ^1].strip.toUpperAscii.startsWith(":GARMIN_ID:"): inc removed
    elif l.startsWith("> "): inc added
  if removed > 0:
    echo &"ABORT: {removed} original line(s) would change — not writing"
    quit 1
  echo &"diff: +{added} lines added, 0 original lines changed"
  if not write:
    echo "dry run — nothing written (use --write)"
    return
  let backup = notes & "." & now().format("yyyyMMdd-HHmmss") & ".bak"
  copyFile(notes, backup)
  let tmp = notes & ".tmp"
  writeFile(tmp, output)
  moveFile(tmp, notes)
  echo &"written {notes} (backup: {backup})"
