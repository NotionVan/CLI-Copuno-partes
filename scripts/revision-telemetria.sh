#!/usr/bin/env bash
# Revisión periódica de la telemetría de la app de Copuno.
#
# PORQUÉ EXISTE: el plan Pro de Vercel desbloquea los log drains, que son lo que tiene
# bloqueado el nivel 3 de observabilidad (I4 de la auditoría) y la única forma de
# confirmar la hipótesis de los 429 de Notion con datos reales de una mañana laborable.
# Pero contratar Pro y no mirar nunca los datos no sirve de nada — y un recordatorio que
# suena cuando todavía no hay nada que mirar enseña a ignorarlo.
#
# Por eso el script COMPRUEBA PRIMERO si Pro está activo:
#   - Plan Hobby  → sale en silencio (código 0). No hay nada que revisar todavía.
#   - Plan Pro    → imprime el checklist y hace las mediciones que puede automatizar.
#
# Uso:  bash scripts/revision-telemetria.sh
set -uo pipefail

TEAM="copunos-projects"
APP="https://app.copuno.com"
AUTH_JSON="$HOME/Library/Application Support/com.vercel.cli/auth.json"

# ── 1. ¿Está Pro activo? ──────────────────────────────────────────────────────
TOKEN="$(python3 -c "
import json, sys
try:
    print(json.load(open('$AUTH_JSON')).get('token', ''))
except Exception:
    print('')
" 2>/dev/null)"

if [ -z "$TOKEN" ]; then
	echo "⚠️  No se pudo leer el token de la CLI de Vercel ($AUTH_JSON)."
	echo "   Ejecuta 'vercel login notionvan@copuno.com' y vuelve a lanzarlo."
	echo "   (Sin esto no se puede saber si el plan ya es Pro.)"
	exit 0
fi

PLAN="$(curl -sS -m 20 -H "Authorization: Bearer $TOKEN" "https://api.vercel.com/v2/teams" 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    print('desconocido'); sys.exit()
for t in d.get('teams', []):
    if t.get('slug') == '$TEAM':
        print((t.get('billing') or {}).get('plan', 'desconocido')); sys.exit()
print('no-encontrado')
" 2>/dev/null)"

case "$PLAN" in
	hobby)
		echo "⏸️  Vercel sigue en plan Hobby — no hay telemetría que revisar todavía."
		echo "   Este chequeo empieza a tener contenido cuando Copuno contrate Pro."
		echo "   (Contexto: docs/AUDITORIA_PRE_SEPTIEMBRE.md, apéndice sobre Hobby→Pro.)"
		exit 0
		;;
	desconocido|no-encontrado|"")
		echo "⚠️  No se pudo determinar el plan del team '$TEAM' (respuesta: '$PLAN')."
		echo "   Compruébalo a mano antes de dar por bueno que no hay nada que revisar."
		exit 0
		;;
esac

# ── 2. Pro activo: esto es lo que hay que mirar ───────────────────────────────
echo "🔍 Vercel en plan '$PLAN' — toca revisar la telemetría de Copuno."
echo

echo "── Medición automática: latencia de la app ──"
echo "   Referencia histórica: la query de partes costaba ~3,5 s (auditoría, 31-jul-2026)."
for i in 1 2 3; do
	printf "   /api/health      intento %s: " "$i"
	curl -sS -o /dev/null -w "%{time_total}s (HTTP %{http_code})\n" -m 30 "$APP/api/health" 2>/dev/null || echo "error"
done
printf "   /api/partes-trabajo         : "
COD=$(curl -sS -o /dev/null -w "%{http_code}" -m 40 "$APP/api/partes-trabajo" 2>/dev/null)
if [ "$COD" = "401" ]; then
	echo "401 — el login ya está activo; para medir esta ruta hace falta un token."
	echo "     Mídela desde el navegador con sesión iniciada (pestaña Red, tiempo total)."
else
	curl -sS -o /dev/null -w "%{time_total}s (HTTP %{http_code})\n" -m 40 "$APP/api/partes-trabajo" 2>/dev/null || echo "error"
fi
echo

echo "── Checklist manual (lo que la CLI no puede responder) ──"
echo "   1. ¿Están configurados los log drains? Si no, no hay telemetría: es el primer paso."
echo "   2. 429 de Notion: ¿aparecen en horario laboral real? Era una HIPÓTESIS sin confirmar."
echo "      Mirar una mañana de entre semana completa, no una tarde de agosto."
echo "   3. p95 de /api/partes-trabajo. Si sigue >3 s tras C2 y C3 → reabrir ADR-007"
echo "      (criterio 1 de reapertura: el problema sería el motor, no la implementación)."
echo "   4. Cold starts: ¿cuántos 504 o timeouts a primera hora?"
echo "   5. ¿Sigue alguien usando copuno-gestion-partes.vercel.app en vez del dominio?"
echo
echo "   Si algo de esto cambia el diagnóstico, actualizar docs/adr/ADR-007-*.md y avisar a Javi."
