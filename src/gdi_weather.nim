## gdi_weather — weather for activities Garmin has none for (mostly pre-2021
## phone recordings), from Open-Meteo's historical archive (ERA5 reanalysis,
## https://open-meteo.com, CC BY 4.0, no API key).
##
## The server fetches slowly in the background (one request every few
## seconds) for activities with a start position but no `w_temp`. Only the
## start position rounded to 0.1° (≈ 10 km, coarser than ERA5's 0.25° grid)
## and the UTC date leave the machine. Results are kept in `weather_fill`
## (survives re-imports) and copied into the activity's `w_*` columns with
## `w_source = 'open-meteo'`.

import std / [asyncdispatch, httpclient, json, math, strutils, strformat, times]
import db_connector / db_sqlite

const
  ArchiveUrl = "https://archive-api.open-meteo.com/v1/archive"
  HourlyVars = "temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m," &
               "wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code"
  RetryAfterDays = 7          ## failed / empty lookups are retried after this

proc wmoDesc*(code: int): string =
  ## WMO weather code → the wording Garmin uses for `w_type`
  case code
  of 0: "Clear"
  of 1: "Mostly Clear"
  of 2: "Partly Cloudy"
  of 3: "Cloudy"
  of 45, 48: "Fog"
  of 51, 53, 55: "Drizzle"
  of 56, 57: "Freezing Drizzle"
  of 61: "Light Rain"
  of 63: "Rain"
  of 65: "Heavy Rain"
  of 66, 67: "Freezing Rain"
  of 71: "Light Snow"
  of 73: "Snow"
  of 75: "Heavy Snow"
  of 77: "Snow Grains"
  of 80: "Light Showers"
  of 81: "Showers"
  of 82: "Heavy Showers"
  of 85, 86: "Snow Showers"
  of 95: "Thunderstorm"
  of 96, 99: "Thunderstorm with Hail"
  else: "Unknown"

proc compass*(deg: float): string =
  ## degrees → 16-point compass in Garmin's lowercase style ("nnw")
  const pts = ["n", "nne", "ne", "ene", "e", "ese", "se", "sse",
               "s", "ssw", "sw", "wsw", "w", "wnw", "nw", "nnw"]
  if deg.isNaN: return ""
  pts[int(floor(((deg mod 360) + 11.25) / 22.5)) mod 16]

proc pick(fill: JsonNode, hourIdx: int, key: string): JsonNode =
  let arr = fill{"hourly", key}
  if arr.isNil or arr.kind != JArray or hourIdx >= arr.len: newJNull() else: arr[hourIdx]

proc applyWeatherFill*(db: DbConn, id: int64) =
  ## Copy a stored Open-Meteo result into the activity row — only when the
  ## activity has no weather of its own (Garmin's always wins).
  let r = db.getRow(sql"""SELECT f.json, a.start_gmt FROM weather_fill f JOIN activities a ON a.id = f.activity_id
                          WHERE f.activity_id = ? AND f.ok = 1 AND a.w_temp IS NULL""", id)
  if r[0].len == 0: return
  let j = parseJson(r[0])
  # hour of the activity start (UTC) in the day's 24 hourly values
  var i = 12
  try:
    i = min(23, parseInt(r[1][11 .. 12]) + (if parseInt(r[1][14 .. 15]) >= 30: 1 else: 0))
  except CatchableError: discard
  # values are inlined: numbers from the JSON (or NULL), strings via dbQuote
  proc num(k: string): string =
    let v = pick(j, i, k)
    if v.kind in {JInt, JFloat}: $v.getFloat else: "NULL"
  proc txt(x: string): string = (if x.len > 0: dbQuote(x) else: "NULL")
  let code = pick(j, i, "weather_code")
  let dir = pick(j, i, "wind_direction_10m")
  let (t, ta, rh, dp, ws, wg) = (num("temperature_2m"), num("apparent_temperature"),
    num("relative_humidity_2m"), num("dew_point_2m"), num("wind_speed_10m"), num("wind_gusts_10m"))
  let wd = txt(if dir.kind in {JInt, JFloat}: compass(dir.getFloat) else: "")
  let wt = txt(if code.kind == JInt: wmoDesc(code.getInt) else: "")
  db.exec(sql(&"""UPDATE activities SET w_temp = {t}, w_apparent_temp = {ta}, w_humidity = {rh},
                  w_dew_point = {dp}, w_wind_speed = {ws}, w_wind_gust = {wg}, w_wind_dir = {wd},
                  w_type = {wt}, w_source = 'open-meteo' WHERE id = ?"""), id)

proc nextMissing(db: DbConn): tuple[id: int64, lat, lon: float, day: string] =
  let r = db.getRow(sql(&"""SELECT a.id, a.start_lat, a.start_lon, substr(a.start_gmt, 1, 10)
      FROM activities a LEFT JOIN weather_fill f ON f.activity_id = a.id
      WHERE a.w_temp IS NULL AND a.start_lat IS NOT NULL AND a.start_lat != 0 AND a.start_gmt IS NOT NULL
        AND (f.activity_id IS NULL OR (f.ok = 0 AND f.fetched_at < {(getTime() - initDuration(days = RetryAfterDays)).toUnix}))
      ORDER BY a.start_local DESC LIMIT 1"""))
  if r[0].len == 0: return (0'i64, 0.0, 0.0, "")
  (parseBiggestInt(r[0]).int64, parseFloat(r[1]), parseFloat(r[2]), r[3])

proc fetchOne(client: AsyncHttpClient, lat, lon: float, day: string): Future[JsonNode] {.async.} =
  let url = &"{ArchiveUrl}?latitude={round(lat, 1)}&longitude={round(lon, 1)}" &
            &"&start_date={day}&end_date={day}&hourly={HourlyVars}&timezone=GMT&wind_speed_unit=ms"
  let resp = await client.get(url)
  let body = await resp.body
  if resp.code != Http200:
    raise newException(IOError, &"open-meteo {resp.code}: {body[0 ..< min(200, body.len)]}")
  parseJson(body)

proc weatherBackfill*(db: DbConn, delayMs = 3000, idleMs = 3_600_000,
                      log: proc (m: string) {.gcsafe.}) {.async.} =
  ## Runs forever: fill one activity, wait `delayMs`; when nothing is left,
  ## check again after `idleMs` (new imports of old files, retries).
  let client = newAsyncHttpClient(userAgent = "gdi (personal training log)")
  var filled = 0
  while true:
    let (id, lat, lon, day) = db.nextMissing()
    if id == 0:
      if filled > 0: log &"weather backfill: {filled} activities filled from Open-Meteo"
      filled = 0
      await sleepAsync(idleMs)
      continue
    var ok = 0
    var stored = ""
    try:
      let j = await client.fetchOne(lat, lon, day)
      if j{"hourly", "temperature_2m"} != nil and j["hourly"]["temperature_2m"].len == 24:
        ok = 1
        stored = $(%*{"hourly": j["hourly"], "latitude": j{"latitude"}, "longitude": j{"longitude"}})
    except CatchableError as e:
      log &"weather backfill: activity {id}: {e.msg}"
      if "429" in e.msg: await sleepAsync(10 * 60_000)   # rate limited: back off
    db.exec(sql"INSERT OR REPLACE INTO weather_fill(activity_id, fetched_at, ok, json) VALUES (?, ?, ?, ?)",
            id, getTime().toUnix, ok, stored)
    if ok == 1:
      db.applyWeatherFill(id)
      inc filled
    await sleepAsync(delayMs)
