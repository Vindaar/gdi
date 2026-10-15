## gdi_metrics — Garmin's server-side metrics (written by `garmin sync-metrics`)
## → `garmin_metrics(date, metric, value, text)`.
##
## Files: <dir>/<metric>/<YYYY>.json for range endpoints and
## <dir>/training_readiness/<YYYY-MM>.json ({date: [entries]}).

import std / [json, os, strutils, tables, math]
import gdi_db

type Row = tuple[date, metric: string, value: float, text: string]

proc toF(n: JsonNode): float =
  if n.isNil: return NaN
  case n.kind
  of JInt: float(n.getBiggestInt)
  of JFloat: n.getFloat
  else: NaN

proc addRow(rows: var seq[Row], date, metric: string, v: float, text = "") =
  if date.len >= 10 and (not v.isNaN or text.len > 0):
    rows.add (date[0 .. 9], metric, v, text)

proc parseVo2max(j: JsonNode, rows: var seq[Row]) =
  if j.kind != JArray: return
  for e in j:
    let g = e{"generic"}
    if g != nil and g.kind == JObject:
      rows.addRow(g{"calendarDate"}.getStr, "vo2max", g{"vo2MaxPreciseValue"}.toF)
    let c = e{"cycling"}
    if c != nil and c.kind == JObject:
      rows.addRow(c{"calendarDate"}.getStr, "vo2max_cycling", c{"vo2MaxPreciseValue"}.toF)
    let a = e{"heatAltitudeAcclimation"}
    if a != nil and a.kind == JObject:
      let d = a{"calendarDate"}.getStr
      rows.addRow(d, "heat_acclimation", a{"heatAcclimationPercentage"}.toF)
      rows.addRow(d, "altitude_acclimation", a{"altitudeAcclimation"}.toF)

proc parseHrv(j: JsonNode, rows: var seq[Row]) =
  for e in j{"hrvSummaries"}.getElems:
    let d = e{"calendarDate"}.getStr
    rows.addRow(d, "hrv_night", e{"lastNightAvg"}.toF)
    rows.addRow(d, "hrv_weekly", e{"weeklyAvg"}.toF, e{"status"}.getStr)
    let b = e{"baseline"}
    if b != nil and b.kind == JObject:
      rows.addRow(d, "hrv_baseline_low", b{"balancedLow"}.toF)
      rows.addRow(d, "hrv_baseline_high", b{"balancedUpper"}.toF)

proc parseRace(j: JsonNode, rows: var seq[Row]) =
  if j.kind != JArray: return
  for e in j:
    let d = e{"calendarDate"}.getStr
    for (k, m) in [("time5K", "race_5k"), ("time10K", "race_10k"),
                   ("timeHalfMarathon", "race_half"), ("timeMarathon", "race_marathon")]:
      rows.addRow(d, m, e{k}.toF)

proc parseTrainingStatus(j: JsonNode, rows: var seq[Row]) =
  ## reportData: {deviceId: [daily entries]}; keep the primary-device value
  ## per day (later devices in the list win only if the day is still empty).
  let rd = j{"reportData"}
  if rd.isNil or rd.kind != JObject: return
  var seen = initTable[string, bool]()
  for dev, entries in rd:
    for e in entries:
      let d = e{"calendarDate"}.getStr
      if d.len < 10 or seen.hasKey(d): continue
      let st = e{"trainingStatus"}.toF
      if st.isNaN: continue
      seen[d] = true
      rows.addRow(d, "training_status", st, e{"trainingStatusFeedbackPhrase"}.getStr)
      let a = e{"acuteTrainingLoadDTO"}
      if a != nil and a.kind == JObject:
        rows.addRow(d, "acute_load", a{"dailyTrainingLoadAcute"}.toF)
        rows.addRow(d, "chronic_load", a{"dailyTrainingLoadChronic"}.toF)
        rows.addRow(d, "acwr", a{"dailyAcuteChronicWorkloadRatio"}.toF, a{"acwrStatus"}.getStr)

proc parseEndurance(j: JsonNode, rows: var seq[Row]) =
  let gm = j{"groupMap"}
  if gm.isNil or gm.kind != JObject: return
  for d, e in gm:
    rows.addRow(d, "endurance_score", e{"groupAverage"}.toF)

proc parseHill(j: JsonNode, rows: var seq[Row]) =
  for e in j{"hillScoreDTOList"}.getElems:
    let d = e{"calendarDate"}.getStr
    rows.addRow(d, "hill_score", e{"overallScore"}.toF)
    rows.addRow(d, "hill_strength", e{"strengthScore"}.toF)
    rows.addRow(d, "hill_endurance", e{"enduranceScore"}.toF)

proc parseLt(j: JsonNode, metric: string, scale: float, rows: var seq[Row]) =
  if j.kind != JArray: return
  for e in j:
    rows.addRow(e{"from"}.getStr, metric, e{"value"}.toF * scale)

proc parseFitnessAge(j: JsonNode, rows: var seq[Row]) =
  if j.kind != JArray: return
  for e in j:
    let v = e{"values"}
    rows.addRow(e{"calendarDate"}.getStr, "fitness_age", v{"fitnessAge"}.toF)
    rows.addRow(e{"calendarDate"}.getStr, "fitness_age_achievable", v{"achievableFitnessAge"}.toF)

proc parseReadiness(j: JsonNode, rows: var seq[Row]) =
  ## {date: [entries]} — the day's value is its latest entry.
  if j.kind != JObject: return
  for d, entries in j:
    if entries.kind != JArray or entries.len == 0: continue
    var last = entries[0]
    for e in entries:
      if e{"timestamp"}.getStr > last{"timestamp"}.getStr: last = e
    rows.addRow(d, "readiness", last{"score"}.toF, last{"level"}.getStr)
    for (k, m) in [("sleepScoreFactorPercent", "readiness_sleep"),
                   ("recoveryTimeFactorPercent", "readiness_recovery"),
                   ("acwrFactorPercent", "readiness_acwr"),
                   ("hrvFactorPercent", "readiness_hrv"),
                   ("stressHistoryFactorPercent", "readiness_stress"),
                   ("sleepHistoryFactorPercent", "readiness_sleep_history")]:
      rows.addRow(d, m, last{k}.toF)

proc parseMetricFile*(metricDir: string, j: JsonNode): seq[Row] =
  case metricDir
  of "vo2max": parseVo2max(j, result)
  of "hrv": parseHrv(j, result)
  of "race_predictions": parseRace(j, result)
  of "training_status": parseTrainingStatus(j, result)
  of "endurance_score": parseEndurance(j, result)
  of "hill_score": parseHill(j, result)
  of "lt_speed": parseLt(j, "lt_speed", 10.0, result)   # stored ×0.1 m/s by Garmin
  of "lt_hr": parseLt(j, "lt_hr", 1.0, result)
  of "fitness_age": parseFitnessAge(j, result)
  of "training_readiness": parseReadiness(j, result)
  else: discard

proc importMetricFile*(db: DbConn, path: string) =
  let metricDir = path.parentDir.extractFilename
  for r in parseMetricFile(metricDir, parseFile(path)):
    db.insertRow("garmin_metrics", @[
      ("date", %r.date), ("metric", %r.metric),
      ("value", (if r.value.isNaN: newJNull() else: %r.value)),
      ("text", (if r.text.len > 0: %r.text else: newJNull()))])
