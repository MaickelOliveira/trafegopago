#!/bin/sh
# Inicia o wa-service (porta 3002) em background e o Next.js (porta 3000) em foreground
node /app/wa-service.js &
exec node /app/server.js
