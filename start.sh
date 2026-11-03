#!/bin/sh
set -eu
node /app/scripts/bootstrap-database.mjs
exec node /app/server.js
