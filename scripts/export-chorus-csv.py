#!/usr/bin/env python3
"""
export-chorus-csv.py — Exporta los partes de un mes al CSV plano que consume la
macro de Copuno para rellenar los cuadrantes mensuales de Chorus (COPUNO.xlsm).

Salida: CSV con una fila por (obra × trabajador × día) y cabeceras:
    codigo_obra,id_trabajador,horas,fecha

Mapeo de cada columna en el Excel destino (hoja mensual "YYYYMM" por obra):
    codigo_obra   -> selecciona el cuadrante/hoja de esa obra
    id_trabajador -> localiza la fila del trabajador (columna B "Número")
    fecha         -> selecciona la columna del día (H..AL = día 1..31)
    horas         -> valor de la celda

Fuente de datos (Notion API directa, token del cliente en .env → NOTION_TOKEN):
    Partes de trabajo  (filtrados por Fecha en el mes)
      └─ Detalle Horas (relation)   -> Cantidad Horas + Empleados
      └─ Obras (relation)           -> Código Obra
    Empleados: ID COPUNO  (= "Número" de Chorus; NO usar "ID Trabajador",
               que es el unique_id interno de Notion)

Uso:
    NOTION_TOKEN=... python3 export-chorus-csv.py 2026-06  [salida.csv]

Dependencia crítica (ver doc): los códigos de Notion deben coincidir con Chorus
(Código Obra ↔ código de obra Chorus; ID COPUNO ↔ "Número" del trabajador).
Si un trabajador/obra no cuadra en la macro, es un código desincronizado.
"""
import os, sys, json, csv, datetime, urllib.request

TOKEN = os.environ["NOTION_TOKEN"]
NV = "2022-06-28"
PARTES = "20882593a25781258595e15abb37e87a"  # Partes de trabajo (src-server/services/notion.js)

def _post(path, body):
    req = urllib.request.Request("https://api.notion.com/v1/" + path,
        data=json.dumps(body).encode(), method="POST",
        headers={"Authorization": f"Bearer {TOKEN}", "Notion-Version": NV,
                 "Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))

def _get(path):
    req = urllib.request.Request("https://api.notion.com/v1/" + path,
        headers={"Authorization": f"Bearer {TOKEN}", "Notion-Version": NV})
    return json.load(urllib.request.urlopen(req))

def export(mes, salida):
    y, m = mes.split("-")
    ini = f"{y}-{m}-01"
    fin = (datetime.date(int(y), int(m), 28) + datetime.timedelta(days=10))
    fin = fin.replace(day=1) - datetime.timedelta(days=1)  # último día del mes

    partes, cursor = [], None
    while True:
        body = {"filter": {"and": [
            {"property": "Fecha", "date": {"on_or_after": ini}},
            {"property": "Fecha", "date": {"on_or_before": fin.isoformat()}}]},
            "page_size": 100}
        if cursor:
            body["start_cursor"] = cursor
        d = _post(f"databases/{PARTES}/query", body)
        partes += d["results"]
        if not d.get("has_more"):
            break
        cursor = d["next_cursor"]

    emp_cache, obra_cache = {}, {}
    def empleado(eid):
        if eid not in emp_cache:
            p = _get(f"pages/{eid}")["properties"]
            emp_cache[eid] = p.get("ID COPUNO", {}).get("number")
        return emp_cache[eid]
    def obra(oid):
        if oid not in obra_cache:
            p = _get(f"pages/{oid}")["properties"]
            obra_cache[oid] = p.get("Código Obra", {}).get("number")
        return obra_cache[oid]

    rows = []
    excluidos = []
    for parte in partes:
        pp = parte["properties"]
        # Excluir los partes RECTIFICADOS (los que tienen un rectificativo que los
        # sustituye). Si no, sus horas se sumarían a las del rectificativo y el
        # cuadrante quedaría inflado. OJO: el nombre lleva espacio final.
        if pp.get("Rectificado por ", {}).get("relation", []):
            a = pp.get("Nombre", {}).get("title", [])
            excluidos.append(a[0]["plain_text"] if a else parte["id"])
            continue
        fecha = (pp.get("Fecha", {}).get("date") or {}).get("start")
        obras_rel = pp.get("Obras", {}).get("relation", [])
        cod = obra(obras_rel[0]["id"]) if obras_rel else None
        for dr in pp.get("Detalle Horas", {}).get("relation", []):
            dp = _get(f"pages/{dr['id']}")["properties"]
            horas = dp.get("Cantidad Horas", {}).get("number")
            emps = dp.get("Empleados", {}).get("relation", [])
            idc = empleado(emps[0]["id"]) if emps else None
            rows.append((cod, idc, horas, fecha))

    def dmy(iso):
        try:
            return datetime.date.fromisoformat(iso[:10]).strftime("%d/%m/%Y")
        except Exception:
            return iso or ""
    rows.sort(key=lambda r: (r[3] or "", str(r[0]), str(r[1])))
    with open(salida, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["codigo_obra", "id_trabajador", "horas", "fecha"])
        for cod, idc, horas, fecha in rows:
            w.writerow([cod, idc, horas, dmy(fecha)])
    print(f"OK -> {salida}  ({len(rows)} filas, {len(partes) - len(excluidos)} partes)")
    if excluidos:
        print(f"   Excluidos {len(excluidos)} parte(s) rectificado(s): {', '.join(excluidos)}")

if __name__ == "__main__":
    mes = sys.argv[1] if len(sys.argv) > 1 else datetime.date.today().strftime("%Y-%m")
    salida = sys.argv[2] if len(sys.argv) > 2 else f"Partes_{mes.replace('-', '_')}.csv"
    export(mes, salida)
