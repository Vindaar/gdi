## gdi — Garmin data interface: importer + web server.

import std / [os, times, strformat]
import cligen
import gdi_db, gdi_import, gdi_server

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
              staticDir = "", watch = 60, user = "", password = "") =
  ## Serve the web UI + JSON API. Imports changed raw files on startup and
  ## then every `--watch` seconds (0 disables). Basic auth is enabled when
  ## `--user` (or env GDI_USER, GDI_PASSWORD) is set.
  let conn = openDb(db)
  let st = conn.scanAndImport(activities, health)
  stderr.writeLine &"startup import: {st.imported} imported, {st.unchanged} unchanged"
  let sdir = if staticDir.len > 0: staticDir
             else: getAppDir() / "static"
  serve(ServerCfg(db: conn, activityDir: activities, healthDir: health,
                  staticDir: sdir, watchInterval: watch,
                  user: (if user.len > 0: user else: getEnv("GDI_USER")),
                  password: (if password.len > 0: password else: getEnv("GDI_PASSWORD"))),
        port, address)

when isMainModule:
  dispatchMulti([importCmd, cmdName = "import"],
                [serveCmd, cmdName = "serve"])
