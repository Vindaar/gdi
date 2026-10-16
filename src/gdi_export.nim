## gdi_export — download one or many activities.
##
## Levels:
##   summary  Garmin's stats (summary, laps, splits, zones, weather, gear) and
##            our derived numbers; GPS coordinates and account identifiers removed
##   data     summary + per-second samples (every stream except lat/lon)
##   full     the raw file as synced (everything, GPS included)
## Formats: json (all levels), csv (summary → one row per activity; data/full →
## samples per activity), gpx (full only). Several activities → a zip, except
## summary CSV, which is a single table.

import std / [os, json, strutils, strformat, times, tables, math, sequtils]
import db_connector / db_sqlite
import zippy / ziparchives_v1
import gdi_db

type
  ExportFile* = object
    name*, body*, mime*: string

const SummaryCols = ["id", "name", "type_key", "start_local", "distance", "moving_duration",
  "elapsed_duration", "elev_gain", "elev_loss", "ascent_per_km", "avg_moving_speed",
  "avg_gap_speed", "gap_source", "avg_hr", "max_hr", "avg_cadence", "avg_power", "norm_power",
  "avg_stride", "calories", "aerobic_te", "anaerobic_te", "training_load", "rpe", "feel",
  "decoupling", "w_temp", "w_humidity", "w_wind_speed", "w_type", "gear"]

proc isPrivateKey(k: string): bool =
  let l = k.toLowerAscii
  "latitude" in l or "longitude" in l or "polyline" in l or l.startsWith("owner") or
    l.startsWith("userprofile") or l == "geopolylinedto" or l == "activityuuid"

proc stripPrivate(n: JsonNode): JsonNode =
  case n.kind
  of JObject:
    result = newJObject()
    for k, v in n:
      if not isPrivateKey(k): result[k] = stripPrivate(v)
  of JArray:
    result = newJArray()
    for v in n: result.add stripPrivate(v)
  else: result = n

proc xmlEsc(s: string): string =
  s.multiReplace(("&", "&amp;"), ("<", "&lt;"), (">", "&gt;"), ("\"", "&quot;"))

proc rawPath(activityDir: string, id: int): string = activityDir / $id & ".json"

proc safeName(s: string): string =
  for c in s:
    result.add(if c.isAlphaNumeric or c in {'-', '_'}: c else: '_')
  result = result.strip(chars = {'_'})

proc baseName(db: DbConn, id: int): string =
  let r = db.getRow(sql"SELECT substr(start_local, 1, 10), name FROM activities WHERE id = ?", id)
  &"{r[0]}_{safeName(r[1])}_{id}"

proc summaryRow(db: DbConn, id: int): JsonNode =
  result = newJObject()
  let row = db.getRow(sql("SELECT " & SummaryCols.join(", ") & " FROM activities WHERE id = ?"), id)
  for i, c in SummaryCols:
    result[c] = (if row[i].len == 0: newJNull()
                 else:
                   try: %parseFloat(row[i]) except ValueError: %row[i])
  result["id"] = %id

proc derived(db: DbConn, id: int): JsonNode =
  ## our computed numbers that Garmin doesn't have
  var be = newJArray()
  for r in db.rows(sql"SELECT distance, time, start_dist, avg_hr FROM best_efforts WHERE activity_id = ? ORDER BY distance", id):
    be.add %*{"distance_m": parseFloat(r[0]), "time_s": parseFloat(r[1]), "start_m": parseFloat(r[2]),
              "avg_hr": (if r[3].len > 0: %parseFloat(r[3]) else: newJNull())}
  var hrr = newJArray()
  for r in db.rows(sql"SELECT t_end, peak_hr, drop60, drop120 FROM hr_recovery WHERE activity_id = ? ORDER BY t_end", id):
    hrr.add %*{"t_s": parseFloat(r[0]), "peak_hr": parseFloat(r[1]),
               "drop60": (if r[2].len > 0: %parseFloat(r[2]) else: newJNull()),
               "drop120": (if r[3].len > 0: %parseFloat(r[3]) else: newJNull())}
  let m = db.getRow(sql"SELECT delta, expected_pace FROM run_model WHERE activity_id = ?", id)
  %*{"summary": db.summaryRow(id), "best_efforts": be, "hr_recovery": hrr,
     "vs_expected_s_per_km": (if m[0].len > 0: %parseFloat(m[0]) else: newJNull())}

proc samples(db: DbConn, id: int, withGps: bool): OrderedTable[string, seq[float32]] =
  var t: seq[float32]
  for (k, blob) in db.getStreams(id):
    if not withGps and k in ["directLatitude", "directLongitude"]: continue
    let xs = decodeStream(blob)
    if k == "t": t = xs else: result[k] = xs
  if t.len > 0:
    var o = initOrderedTable[string, seq[float32]]()
    o["t"] = t
    for k, v in result: o[k] = v
    result = o

proc csvNum(x: float32): string =
  ## shortest float32 round-trip text (221.2, not 221.199997)
  if x.isNaN: "" elif float(x) == round(float(x)) and abs(x) < 1e9: $int(x) else: $x

proc samplesCsv(s: OrderedTable[string, seq[float32]]): string =
  if s.len == 0: return ""
  let keys = toSeq(s.keys)
  result = keys.mapIt(if it == "t": "time_s" else: it).join(",") & "\n"
  let n = s["t"].len
  for i in 0 ..< n:
    var row: seq[string]
    for k in keys:
      row.add(if i < s[k].len: csvNum(s[k][i]) else: "")
    result.add row.join(",") & "\n"

proc samplesJson(s: OrderedTable[string, seq[float32]]): JsonNode =
  result = newJObject()
  for k, xs in s:
    var a = newJArray()
    for x in xs: a.add(if x.isNaN: newJNull() else: %(round(float(x) * 1e6) / 1e6))
    result[k] = a

proc gpx(db: DbConn, id: int): string =
  let s = db.samples(id, withGps = true)
  let r = db.getRow(sql"SELECT start_gmt, name, type_key FROM activities WHERE id = ?", id)
  var t0: Time
  try: t0 = parse(r[0][0 ..< 19], "yyyy-MM-dd'T'HH:mm:ss", utc()).toTime
  except CatchableError: t0 = fromUnix(0)
  let get = proc (k: string): seq[float32] = s.getOrDefault(k)
  let (t, la, lo, el, hr, cad) = (get("t"), get("directLatitude"), get("directLongitude"),
                                  get("directElevation"), get("directHeartRate"), get("directDoubleCadence"))
  result = """<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="gdi" xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
"""
  result.add &"  <trk><name>{xmlEsc(r[1])}</name><type>{xmlEsc(r[2])}</type><trkseg>\n"
  for i in 0 ..< t.len:
    if i >= la.len or i >= lo.len or la[i].isNaN or lo[i].isNaN or la[i] == 0: continue
    let ts = (t0 + initDuration(milliseconds = int64(float(t[i]) * 1000))).utc.format("yyyy-MM-dd'T'HH:mm:ss'Z'")
    result.add &"""    <trkpt lat="{float(la[i]):.6f}" lon="{float(lo[i]):.6f}">"""
    if i < el.len and not el[i].isNaN: result.add &"<ele>{float(el[i]):.1f}</ele>"
    result.add &"<time>{ts}</time>"
    var ext = ""
    if i < hr.len and not hr[i].isNaN: ext.add &"<gpxtpx:hr>{int(hr[i])}</gpxtpx:hr>"
    if i < cad.len and not cad[i].isNaN: ext.add &"<gpxtpx:cad>{int(cad[i] / 2)}</gpxtpx:cad>"   # GPX: per-leg cadence
    if ext.len > 0: result.add "<extensions><gpxtpx:TrackPointExtension>" & ext & "</gpxtpx:TrackPointExtension></extensions>"
    result.add "</trkpt>\n"
  result.add "  </trkseg></trk>\n</gpx>\n"

proc exportOne(db: DbConn, activityDir: string, id: int, level, format: string): ExportFile =
  let base = db.baseName(id) & "_" & level
  case format
  of "gpx":
    ExportFile(name: base & ".gpx", body: db.gpx(id), mime: "application/gpx+xml")
  of "csv":
    ExportFile(name: base & ".csv", body: samplesCsv(db.samples(id, withGps = level == "full")),
               mime: "text/csv; charset=utf-8")
  else:
    var j: JsonNode
    if level == "full":
      let p = rawPath(activityDir, id)
      return ExportFile(name: base & ".json", body: (if fileExists(p): readFile(p) else: "{}"),
                        mime: "application/json")
    let raw = (if fileExists(rawPath(activityDir, id)): parseFile(rawPath(activityDir, id)) else: newJObject())
    j = newJObject()
    for k, v in raw:
      if k notin ["details", "polyline"]: j[k] = stripPrivate(v)
    j["gdi"] = db.derived(id)
    if level == "data": j["samples"] = samplesJson(db.samples(id, withGps = false))
    ExportFile(name: base & ".json", body: j.pretty(1), mime: "application/json")

proc exportActivities*(db: DbConn, activityDir: string, ids: seq[int],
                       level, format: string): ExportFile =
  ## One file for one activity (or a summary CSV of many), else a zip.
  let level = (if level in ["summary", "data", "full"]: level else: "summary")
  let format = (if format == "gpx" and level != "full": "json"
                elif format in ["json", "csv", "gpx"]: format else: "json")
  if format == "csv" and level == "summary":
    var csv = SummaryCols.join(",") & "\n"
    for id in ids:
      let r = db.summaryRow(id)
      csv.add SummaryCols.mapIt(
        (let v = r[it]; if v.kind == JNull: "" elif v.kind == JString: "\"" & v.getStr.replace("\"", "\"\"") & "\"" else: $v)).join(",") & "\n"
    let stamp = now().format("yyyy-MM-dd")
    return ExportFile(name: (if ids.len == 1: db.baseName(ids[0]) & "_summary.csv" else: &"activities_{ids.len}_{stamp}_summary.csv"),
                      body: csv, mime: "text/csv; charset=utf-8")
  if ids.len == 1:
    return db.exportOne(activityDir, ids[0], level, format)
  let archive = ZipArchive()
  for id in ids:
    let f = db.exportOne(activityDir, id, level, format)
    archive.contents[f.name] = ArchiveEntry(kind: ekFile, contents: f.body, lastModified: getTime())
  let tmp = getTempDir() / &"gdi-export-{getCurrentProcessId()}-{epochTime().int}.zip"
  archive.writeZipArchive(tmp)
  defer: removeFile(tmp)
  ExportFile(name: &"activities_{ids.len}_{now().format(\"yyyy-MM-dd\")}_{level}_{format}.zip",
             body: readFile(tmp), mime: "application/zip")
