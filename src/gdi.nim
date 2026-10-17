## gdi — Garmin data interface: importer + web server.

import std / [os, times, strformat]
import cligen
import gdi_db, gdi_import, gdi_server, gdi_notes, gdi_linknotes

const
  DefaultDb       = "data/gdi.sqlite"
  DefaultActivity = "exercise-history.raw"
  DefaultHealth   = "garmin-health/raw"

proc importCmd(db = DefaultDb, activities = DefaultActivity,
               health = DefaultHealth) =
  ## Import new / changed raw JSON files into the SQLite database.
  let conn = openDb(db)
  defer: conn.close()
  let t0 = epochTime()
  let st = conn.scanAndImport(activities, health)
  stderr.writeLine &"imported {st.imported}, unchanged {st.unchanged}, " &
                   &"failed {st.failed}, removed {st.removed} " &
                   &"in {epochTime() - t0:.1f}s"

proc serveCmd(db = DefaultDb, activities = DefaultActivity,
              health = DefaultHealth, port = 8091, address = "127.0.0.1",
              staticDir = "", watch = 60, user = "", password = "", notes = "",
              weather = true) =
  ## Serve the web UI + JSON API. Imports changed raw files on startup and
  ## then every `--watch` seconds (0 disables). Basic auth is enabled when
  ## `--user` (or env GDI_USER, GDI_PASSWORD) is set. `--notes` is the Org
  ## file with per-activity notes/tags (default: exercise-notes.org next to
  ## the activities directory). `--weather` backfills weather for activities
  ## without Garmin weather from Open-Meteo's archive (start position rounded
  ## to 0.1°, one request every few seconds).
  let conn = openDb(db)
  let nf = if notes.len > 0: notes.absolutePath else: defaultNotesFile(activities)
  let st = conn.scanAndImport(activities, health, notesFile = nf)
  stderr.writeLine &"startup import: {st.imported} imported, {st.unchanged} unchanged"
  let sdir = if staticDir.len > 0: staticDir
             else: getAppDir() / "static"
  serve(ServerCfg(db: conn, activityDir: activities, healthDir: health, notesFile: nf,
                  staticDir: sdir, watchInterval: watch, weatherFill: weather,
                  user: (if user.len > 0: user else: getEnv("GDI_USER")),
                  password: (if password.len > 0: password else: getEnv("GDI_PASSWORD"))),
        port, address)

when isMainModule:
  dispatchMulti([importCmd, cmdName = "import"],
                [serveCmd, cmdName = "serve"],
                [linkNotes, cmdName = "link-notes",
                 help = {"notes": "the diary Org file (e.g. ~/org/exercise.org)",
                         "write": "actually write (after a timestamped backup)",
                         "byDate": "link entries without a URL when exactly one activity exists that day",
                         "verbose": "list entries without URL and skipped ones"}])
