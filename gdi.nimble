# Package

version       = "0.1.0"
author        = "Vindaar"
description   = "Local analytics web app for your Garmin Connect data"
license       = "MIT"
srcDir        = "src"
bin           = @["gdi"]

# Dependencies

requires "nim >= 2.0.0"
requires "cligen >= 1.7.0"
requires "zippy >= 0.10.0"
requires "db_connector >= 0.1.0"
requires "https://github.com/Vindaar/orgParser >= 0.3.0"
