#!/usr/bin/env bash
# Golden-diff del catálogo contra Notion real — chequeo repetible para cambios
# en PROPS_CATALOGO / mappers (src-server/services/notion.js).
#
# Uso:
#   ./scripts/golden-diff-catalogo.sh capturar antes    # con el código base
#   (aplicar los cambios)
#   ./scripts/golden-diff-catalogo.sh capturar despues  # con el código nuevo
#   ./scripts/golden-diff-catalogo.sh comparar
#
# Requiere .env con NOTION_TOKEN real. Levanta el server en :3002 sin auth
# (SUPABASE_URL vacía) SOLO durante la captura. No escribe nada en Notion.
set -euo pipefail
cd "$(dirname "$0")/.."

DIR="${GOLDEN_DIR:-/tmp/golden-catalogo}"
ACCION="${1:-comparar}"
LADO="${2:-}"

capturar() {
	local lado="$1"
	mkdir -p "$DIR/$lado"
	lsof -ti tcp:3002 | xargs kill 2>/dev/null || true
	SUPABASE_URL= PORT=3002 node server.js >"$DIR/server-$lado.log" 2>&1 &
	local pid=$!
	sleep 4
	for ep in obras jefes-obra empleados partes-trabajo; do
		curl -sf "http://localhost:3002/api/$ep" | python3 -m json.tool --sort-keys > "$DIR/$lado/$ep.json"
	done
	local parte_id
	parte_id=$(python3 -c "import json; print(json.load(open('$DIR/$lado/partes-trabajo.json'))[0]['id'])")
	curl -sf "http://localhost:3002/api/partes-trabajo/$parte_id/estado" | python3 -m json.tool --sort-keys > "$DIR/$lado/estado.json"
	curl -sf "http://localhost:3002/api/empleados/buscar?q=garcia" | python3 -m json.tool --sort-keys > "$DIR/$lado/buscar.json"
	kill "$pid" 2>/dev/null || true
	echo "Capturado $lado en $DIR/$lado/"
}

comparar() {
	local rc=0
	for f in obras jefes-obra empleados partes-trabajo estado buscar; do
		if diff -q "$DIR/antes/$f.json" "$DIR/despues/$f.json" >/dev/null; then
			echo "✔ $f idéntico"
		else
			echo "✘ $f DIFIERE — revisar (¿mejora esperada o regresión?):"
			diff "$DIR/antes/$f.json" "$DIR/despues/$f.json" | head -12
			rc=1
		fi
	done
	exit $rc
}

case "$ACCION" in
	capturar) capturar "$LADO" ;;
	comparar) comparar ;;
	*) echo "uso: $0 capturar antes|despues · $0 comparar"; exit 2 ;;
esac
