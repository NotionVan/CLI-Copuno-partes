#!/usr/bin/env python3
"""
Exporta los blueprints de los escenarios Make de producción (org Copuno, eu2),
los SANEA de secretos y los deja versionables en docs/blueprints-make/.

Por qué existe: los blueprints crudos contienen un token de integración Notion en
texto plano (DEUDA_TECNICA → M9/E1), por eso `docs/Escenarios Make/` está en
.gitignore. Sin versionado no hay historial de los cambios que se hacen en la UI
de Make — el 28-jul se perdió el diff de un fix por esto. Este script rompe esa
dependencia: la copia saneada SÍ se commitea y da historial y diffs.

Uso:
    python3 scripts/export-blueprints-make.py            # exporta y sanea
    python3 scripts/export-blueprints-make.py --raw      # además guarda el crudo
                                                         # en docs/Escenarios Make/ (ignorado)

Requiere MAKE_TOKEN en .env (token de API de Make con scenarios:read).

IMPORTANTE: si el script encuentra un patrón de secreto que no sabe sanear, aborta
sin escribir nada. Es preferible no exportar a exportar un secreto.
"""

import json
import os
import re
import sys
import urllib.request
from pathlib import Path

ZONE = "eu2.make.com"
TEAM_ID = 2014883          # team Copuno (OJO: la org es 4157465, no es lo mismo)
RAIZ = Path(__file__).resolve().parent.parent
DIR_SANEADO = RAIZ / "docs" / "blueprints-make"      # versionado en git
DIR_CRUDO = RAIZ / "docs" / "Escenarios Make"        # en .gitignore, solo con --raw

# Patrones de secreto → placeholder. El placeholder es estable para que los diffs
# solo muestren cambios reales, nunca rotaciones de credenciales.
SANEADOS = [
    (re.compile(r"ntn_[A-Za-z0-9]{40,}"), "<NOTION_TOKEN_REDACTADO>"),
    (re.compile(r"secret_[A-Za-z0-9]{40,}"), "<NOTION_TOKEN_LEGACY_REDACTADO>"),
    (re.compile(r"Bearer\s+[A-Za-z0-9._\-]{30,}"), "Bearer <TOKEN_REDACTADO>"),
]

# Si algo encaja aquí y NO fue saneado arriba, abortamos: secreto desconocido.
CENTINELAS = [
    re.compile(r"\b(api[_-]?key|apikey|password|passwd|secret|token)\b\s*[\"':=]\s*[\"']?[A-Za-z0-9._\-]{20,}",
               re.IGNORECASE),
]
# Falsos positivos conocidos de los centinelas (nombres de campo, no valores).
PERMITIDOS = [
    re.compile(r"\"name\"\s*:\s*\"Authorization\""),
    re.compile(r"__IMTCONN__"),
]


def leer_token():
    env = RAIZ / ".env"
    if env.exists():
        for linea in env.read_text().splitlines():
            if linea.startswith("MAKE_TOKEN="):
                return linea.split("=", 1)[1].strip()
    tok = os.environ.get("MAKE_TOKEN")
    if not tok:
        sys.exit("ERROR: falta MAKE_TOKEN (en .env o en el entorno)")
    return tok


def api(ruta, token):
    req = urllib.request.Request(
        f"https://{ZONE}/api/v2/{ruta}",
        # OJO: Make responde 403 al User-Agent por defecto de urllib. Hay que
        # mandar uno propio o la petición se rechaza aunque el token sea válido.
        headers={"Authorization": f"Token {token}", "User-Agent": "copuno-export-blueprints/1.0"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def sanear(texto):
    for patron, reemplazo in SANEADOS:
        texto = patron.sub(reemplazo, texto)
    return texto


def comprobar_limpio(texto, nombre):
    """Aborta si queda algo con pinta de secreto sin sanear."""
    for centinela in CENTINELAS:
        for hallazgo in centinela.finditer(texto):
            trozo = hallazgo.group(0)
            if any(p.search(trozo) for p in PERMITIDOS):
                continue
            if "REDACTADO" in trozo:
                continue
            sys.exit(
                f"\nABORTADO: posible secreto sin sanear en «{nombre}».\n"
                f"  Coincidencia: {trozo[:60]}…\n"
                f"  Añade el patrón a SANEADOS en este script y vuelve a ejecutar.\n"
                f"  No se ha escrito ningún fichero."
            )


def main():
    guardar_crudo = "--raw" in sys.argv
    token = leer_token()

    escenarios = api(f"scenarios?teamId={TEAM_ID}", token).get("scenarios", [])
    if not escenarios:
        sys.exit("ERROR: la API no devolvió escenarios (¿token sin scenarios:read?)")

    # Se procesa TODO en memoria y solo se escribe si todo pasa el centinela.
    pendientes = []
    for esc in sorted(escenarios, key=lambda e: e["name"]):
        bp = api(f"scenarios/{esc['id']}/blueprint", token)["response"]["blueprint"]
        crudo = json.dumps(bp, indent=4, ensure_ascii=False)
        limpio = sanear(crudo)
        nombre = re.sub(r"[/\\:]", "-", esc["name"]).strip()
        estado = "activo" if esc.get("isActive") else "inactivo"
        comprobar_limpio(limpio, nombre)
        pendientes.append((nombre, esc["id"], estado, crudo, limpio))

    DIR_SANEADO.mkdir(parents=True, exist_ok=True)
    if guardar_crudo:
        DIR_CRUDO.mkdir(parents=True, exist_ok=True)

    print(f"Escenarios exportados desde {ZONE} (team {TEAM_ID}):\n")
    for nombre, sid, estado, crudo, limpio in pendientes:
        destino = DIR_SANEADO / f"{nombre}.blueprint.json"
        cambio = "nuevo" if not destino.exists() else (
            "sin cambios" if destino.read_text() == limpio else "MODIFICADO")
        destino.write_text(limpio)
        if guardar_crudo:
            (DIR_CRUDO / f"{nombre}.blueprint.json").write_text(crudo)
        redactados = limpio.count("REDACTADO")
        print(f"  [{sid}] {estado:8} {cambio:12} {nombre}"
              + (f"  ({redactados} secreto(s) saneado(s))" if redactados else ""))

    print(f"\nSaneados en: {DIR_SANEADO.relative_to(RAIZ)}  (versionable)")
    if guardar_crudo:
        print(f"Crudos en:   {DIR_CRUDO.relative_to(RAIZ)}  (en .gitignore, NO commitear)")
    print("\nSiguiente paso: git diff 'docs/blueprints-make/' para ver qué cambió en Make.")


if __name__ == "__main__":
    main()
