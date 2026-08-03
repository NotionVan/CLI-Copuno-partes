#!/usr/bin/env bash
# Regenera "docs/Contexto para claude app/": el paquete de documentación que se sube
# como knowledge a un proyecto de Claude (app web/escritorio).
#
# POR QUÉ EXISTE ESTE SCRIPT: la carpeta se montó a mano en mayo-2026 y para agosto
# llevaba dos meses de deriva — citaba como producción dos subdominios que nunca
# existieron. Una lista de ficheros copiada a mano caduca; un glob, no.
#
# La carpeta está en .gitignore (es un artefacto, no fuente). Lo versionado es ESTE script.
#
# Uso:  bash scripts/gen-contexto-claude-app.sh
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESTINO="$RAIZ/docs/Contexto para claude app"
FECHA="$(date +%Y-%m-%d)"

cd "$RAIZ"

# ── 1. Limpiar y recrear ──────────────────────────────────────────────────────
rm -rf "$DESTINO"
mkdir -p "$DESTINO"

# ── 2. Copiar la documentación viva (por glob, nunca por lista a mano) ────────
cp README.md CLAUDE.md AGENTS.md "$DESTINO/"
cp docs/*.md "$DESTINO/"
cp docs/adr/*.md "$DESTINO/"

# Del historial de versiones, solo las tres últimas: el resto es ruido para un LLM
# y consume ventana de contexto sin aportar.
ls -1 CHANGELOG_V*.md | sort -V | tail -3 | while read -r f; do cp "$f" "$DESTINO/"; done

# NO se copian:
#   docs/Escenarios Make/     → gitignorado, contiene secretos sin sanear
#   docs/blueprints-make/     → JSON pesado, poco útil como prosa para un LLM
#   docs/manual/              → HTML con imágenes embebidas, no es texto plano

# ── 3. Índice con fecha de generación ─────────────────────────────────────────
{
	echo "# Contexto del proyecto — Copuno · Gestión de Partes"
	echo
	echo "**Paquete generado el $FECHA** con \`scripts/gen-contexto-claude-app.sh\`."
	echo "Si esta fecha tiene más de un mes, vuelve a generarlo antes de fiarte de lo que diga."
	echo
	echo "## Cómo leer esto"
	echo
	echo "- \`CLAUDE.md\` y \`AGENTS.md\` son la fuente principal: estado, convenciones y gotchas."
	echo "- \`ADR-00X-*.md\` son las decisiones de arquitectura, con su contexto y sus alternativas descartadas."
	echo "- El resto son referencias temáticas (API, despliegue, deuda técnica, esquema de Notion)."
	echo
	echo "## Ficheros incluidos"
	echo
	(cd "$DESTINO" && ls -1 *.md | grep -v '^_INDICE.md$' | sed 's/^/- /')
	echo
	echo "---"
	echo
	echo "_Artefacto regenerable. No editar a mano: los cambios se pierden en la siguiente_"
	echo "_generación. La fuente son los ficheros del repositorio._"
} > "$DESTINO/_INDICE.md"

# ── 4. Red de seguridad: abortar si se ha colado un secreto ───────────────────
# Mismo criterio que scripts/export-blueprints-make.py. El paquete SALE del repo
# (se sube a un servicio externo), así que aquí no vale el "ya lo revisaré".
if grep -rlEi 'ntn_[A-Za-z0-9]{20,}|secret_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{30,}|sb_secret_|service_role' "$DESTINO" 2>/dev/null; then
	echo "❌ ABORTADO: hay posibles secretos en los ficheros de arriba." >&2
	echo "   El paquete NO se sube hasta sanearlos. Carpeta borrada." >&2
	rm -rf "$DESTINO"
	exit 1
fi

N=$(find "$DESTINO" -name '*.md' | wc -l | tr -d ' ')
echo "✅ Contexto regenerado: $N ficheros en 'docs/Contexto para claude app/' ($FECHA)"
echo "   Sin secretos detectados. Listo para subir al proyecto de Claude."
