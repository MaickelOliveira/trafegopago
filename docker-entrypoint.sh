#!/bin/sh
set -eu
# Only the mounted application volumes need ownership preparation. The web and
# WhatsApp processes run without root privileges after this short entry point.
mkdir -p /app/data /app/private/backups
chown -R nextjs:nodejs /app/data /app/private
exec su-exec nextjs:nodejs /app/start.sh
