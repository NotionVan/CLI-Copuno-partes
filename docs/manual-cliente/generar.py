#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Genera la copia PUBLICABLE del manual a partir del documento interno.

    python3 docs/manual-cliente/generar.py

Entrada:  docs/manual/index.html  (documento interno, 3 capas)
Salida:   public/manual.html                    autocontenido — LO QUE SIRVE LA APP
          docs/manual-cliente/
            manual-copuno-usuario-pegable.html  imágenes en capturas/, para montarlo
                                                en Notion o enviarlo suelto
            capturas/*.jpg|png

El autocontenido va directo a `public/`, que es de donde lo sirve la app (botón
«Ayuda» de la cabecera → /manual.html). Una sola copia del fichero pesado: dos
copias del mismo contenido en el repo acaban divergiendo.

POR QUÉ ES UN SCRIPT Y NO UNA COPIA A MANO
El documento interno se mantiene; la copia del cliente es DERIVADA. Si se editan
las dos a mano, divergen — y la primera vez que se sacó esta copia (4-ago-2026) el
original ya arrastraba una sección desactualizada. Regenerar es la única forma de
que la copia siga al original.

QUÉ SE QUITA, Y POR QUÉ
- Secciones 11-21 (documentación técnica) y 22-25 (interno). El propio documento
  avisa en portada de que la zona interna no se comparte con el cliente.
- De la portada: rama de git, URL de Vercel y la ruta /partes (destino de diseño,
  hoy 404).
- Del cuerpo: menciones al stack (Make, OneDrive, Notion, Vercel, Supabase).

AJUSTES DE CONTENIDO (lista REEMPLAZOS)
Cada entrada es (texto_exacto_del_original, texto_para_el_cliente). El script
ABORTA si alguno no aparece: si el original cambia, hay que revisar el ajuste en
vez de publicar en silencio una copia a medio limpiar.
"""
import base64
import pathlib
import re
import sys

AQUI = pathlib.Path(__file__).resolve().parent
ORIGEN = AQUI.parent / "manual" / "index.html"
FECHA_DOC = "18 de agosto de 2026"
VERSION = "1.12.3"

# Las 10 capturas del manual de usuario, en el ORDEN DE APARICIÓN en el HTML
# (el zip con imgs[2:] depende de este orden — v1.12.2 añadió las tres últimas
# en §a7 y §a10; el toast aparece antes que exportar-csv... comprobar con el
# orden real del documento si se añaden más).
CAPTURAS = [
    "01-login.jpg", "02-inicio.jpg", "03-crear-parte.jpg", "04-empleados-horas.jpg",
    "05-listado-filtros.jpg", "06-detalle-parte.jpg", "08-toast-confirmacion.jpg",
    "07-exportar-csv.jpg", "09-actualizacion-automatica.jpg", "10-sin-conexion.jpg",
]

REEMPLAZOS = [
    # No nombrar el stack de automatización a los usuarios finales.
    ("Detrás de la pantalla, los datos viven en Notion, el PDF se genera y firma a través de Make.com y el documento final se archiva en OneDrive — pero nada de eso requiere acción del usuario: la app lo orquesta todo desde los botones que se describen en este manual.",
     "Detrás de la pantalla, los datos quedan registrados en el sistema de gestión de Copuno y el PDF se genera, se firma y se archiva de forma automática. Nada de eso requiere acción del usuario: la app lo orquesta todo desde los botones que se describen en este manual."),

    ("<p>Desde la versión 1.9.0 la aplicación requiere <strong>iniciar sesión con email y contraseña</strong>. No hay registro público: las cuentas las crea el administrador por invitación.</p>",
     "<p>La aplicación requiere <strong>iniciar sesión con email y contraseña</strong>. No hay registro público ni autoservicio: las cuentas las crea el administrador del sistema.</p>"),

    # El alta por invitación se DESCARTÓ con Efrén el 3-ago-2026 (los enlaces caducan).
    # Criterio vigente: cuenta creada ya confirmada + clave inicial que el usuario cambia al entrar.
    ("""<h3>Primer acceso (invitación)</h3>
<div class="paso"><div class="num">1</div><div>Recibirás un email de invitación con un enlace. <strong>Ábrelo cuanto antes</strong>: el enlace es de un solo uso y caduca.</div></div>
<div class="paso"><div class="num">2</div><div>El enlace te lleva a una pantalla para <strong>fijar tu contraseña</strong> (mínimo 10 caracteres, con letras y números).</div></div>
<div class="paso"><div class="num">3</div><div>A partir de ahí, entra siempre con tu email y esa contraseña.</div></div>""",
     """<h3>Primer acceso</h3>
<div class="paso"><div class="num">1</div><div>El administrador te facilita tu <strong>email de acceso y una contraseña inicial</strong>.</div></div>
<div class="paso"><div class="num">2</div><div>Entra en <strong>app.copuno.com</strong> con esos datos.</div></div>
<div class="paso"><div class="num">3</div><div><strong>Cambia la contraseña</strong> desde el menú de cuenta (arriba a la derecha). Mínimo 10 caracteres, con letras y números.</div></div>
<div class="caja info"><span class="titulo">Cuentas nuevas</span>El alta de un usuario nuevo se pide al administrador del sistema y se resuelve en el momento.</div>"""),

    ('<div class="caja aviso"><span class="titulo">Si el enlace «ha caducado o ya se había usado»</span>Algunos gestores de correo «pre-abren» los enlaces y consumen el token, y en cualquier caso los enlaces expiran pasado un tiempo. La propia pantalla lo avisa: pide un enlace nuevo desde «¿Has olvidado tu contraseña?».</div>',
     '<div class="caja aviso"><span class="titulo">Si el enlace «ha caducado o ya se había usado»</span>Los enlaces para restablecer la contraseña son de <strong>un solo uso y caducan</strong>; además, algunos gestores de correo los «pre-abren» y los consumen. La propia pantalla lo avisa: pide otro desde «¿Has olvidado tu contraseña?».</div>'),

    ("Este es el mecanismo normal de rescate — no hace falta pedir una invitación nueva.",
     "Este es el mecanismo normal de rescate: no hace falta avisar al administrador."),

    ("si Make genera el PDF o el jefe firma mientras miras",
     "si se genera el PDF o el jefe de obra firma mientras miras"),

    ('<tr><td>«El enlace de invitación no funciona»</td><td>Caducó o ya se usó. Pide uno nuevo desde «¿Has olvidado tu contraseña?».</td></tr>',
     '<tr><td>«El enlace para restablecer la contraseña no funciona»</td><td>Caducó o ya se usó. Pide otro desde «¿Has olvidado tu contraseña?».</td></tr>'),
]

INDICE = [
    ("a1", "1. Qué es esta aplicación"), ("a2", "2. Acceso y cuenta"),
    ("a3", "3. Pantalla de inicio"), ("a4", "4. Crear un parte"),
    ("a5", "5. Consultar y filtrar partes"), ("a6", "6. Detalles y estados del parte"),
    ("a7", "7. Enviar datos y firma"), ("a8", "8. Rectificar un parte"),
    ("a9", "9. Exportar CSV (Chorus)"), ("a10", "10. Sincronización y problemas"),
]


def recortar(src):
    """Devuelve (css, cuerpo) quedándose solo con el manual de usuario."""
    style = re.search(r"<style>\n(.*?)\n</style>", src, re.S)
    css = "\n".join(l for l in style.group(1).split("\n")
                    # reglas que solo servían a la zona interna
                    if not l.startswith((".sidebar a.interno::after", ".zona-interna-banner")))
    # de la primera sección del manual al fin de la última, sin tocar el resto
    ini = src.index('<section id="a1">')
    fin = src.index("<!-- ═══════════════ PARTE B")
    return css, src[ini:fin].rstrip()


def render(css, cuerpo, logo, externas):
    if externas:
        n = [0]

        def ruta(_):
            n[0] += 1
            return 'src="capturas/%s"' % CAPTURAS[n[0] - 1]

        cuerpo = re.sub(r'src="data:image/jpeg;base64,[A-Za-z0-9+/=]+"', ruta, cuerpo)
        if n[0] != len(CAPTURAS):
            sys.exit("ERROR: %d capturas en el original, %d nombres en CAPTURAS" % (n[0], len(CAPTURAS)))
    indice = "\n".join('\t<a href="#%s">%s</a>' % x for x in INDICE)
    return f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Grupo Copuno — Gestión de Partes · Manual de usuario</title>
<style>
{css}
</style>
</head>
<body>
<div class="layout">
<nav class="sidebar">
\t<div class="brand">
\t\t<img src="{logo}" alt="Grupo Copuno">
\t\t<span>Gestión de Partes · Manual de usuario</span>
\t</div>
\t<h5>Contenido</h5>
{indice}
</nav>
<main>

<div class="portada">
\t<img class="logo" src="{logo}" alt="Grupo Copuno">
\t<h1>Gestión de Partes de Trabajo</h1>
\t<p class="subtitulo">Manual de usuario</p>
\t<dl class="meta">
\t\t<dt>Aplicación</dt><dd>Gestión de Partes · Grupo Copuno</dd>
\t\t<dt>Dirección de acceso</dt><dd><a href="https://app.copuno.com">app.copuno.com</a></dd>
\t\t<dt>Versión</dt><dd>{VERSION}</dd>
\t\t<dt>Fecha del documento</dt><dd>{FECHA_DOC}</dd>
\t\t<dt>Elaborado por</dt><dd>NotionVan · Javi Collado</dd>
\t</dl>
\t<p class="aviso">Documento de consulta para los usuarios de la aplicación. Recoge el funcionamiento de la versión {VERSION}; cuando la aplicación cambie, el manual se actualiza y se vuelve a distribuir.</p>
</div>

<div class="contenido">

{cuerpo}

<section>
<p style="margin-top:34px;color:var(--text-3);font-size:.9rem;text-align:center">Gestión de Partes v{VERSION} · Manual de usuario · {FECHA_DOC}<br>NotionVan para Grupo Copuno</p>
</section>

</div><!-- /contenido -->
</main>
</div><!-- /layout -->
</body>
</html>"""


def main():
    if not ORIGEN.exists():
        sys.exit("ERROR: no encuentro %s" % ORIGEN)
    src = ORIGEN.read_text(encoding="utf-8")
    css, cuerpo = recortar(src)

    for viejo, nuevo in REEMPLAZOS:
        if viejo not in cuerpo:
            sys.exit("ERROR: el original ya no contiene este texto, revisa el ajuste:\n  %s…" % viejo[:110])
        cuerpo = cuerpo.replace(viejo, nuevo, 1)

    # el stack no debe sobrevivir al recorte (NotionVan sí: es la firma)
    for palabra in ("Make", "OneDrive", "Vercel", "Supabase"):
        if palabra in cuerpo:
            sys.exit("ERROR: '%s' sigue apareciendo en el manual de usuario — revísalo antes de publicar" % palabra)
    if re.search(r"Notion(?!Van)", cuerpo):
        sys.exit("ERROR: 'Notion' sigue apareciendo en el manual de usuario — revísalo antes de publicar")

    caps = AQUI / "capturas"
    caps.mkdir(exist_ok=True)
    imgs = re.findall(r"data:image/[a-z]+;base64,([A-Za-z0-9+/=]+)", src)
    (caps / "logo-copuno.png").write_bytes(base64.b64decode(imgs[0]))
    for nombre, dato in zip(CAPTURAS, imgs[2:]):
        (caps / nombre).write_bytes(base64.b64decode(dato))

    logo_b64 = re.search(r"data:image/png;base64,[A-Za-z0-9+/=]+", src).group(0)
    servido = AQUI.parent.parent / "public" / "manual.html"
    servido.write_text(render(css, cuerpo, logo_b64, False), encoding="utf-8")
    (AQUI / "manual-copuno-usuario-pegable.html").write_text(
        render(css, cuerpo, "capturas/logo-copuno.png", True), encoding="utf-8")

    print("OK · public/manual.html (%d KB) + versión pegable + %d capturas"
          % (servido.stat().st_size // 1024, len(CAPTURAS)))


if __name__ == "__main__":
    main()
