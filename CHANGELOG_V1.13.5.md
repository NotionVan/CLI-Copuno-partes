# Changelog v1.13.5 — El estado deja de «bailar» tras firmar · Lista de empleados con scroll infinito

**Fecha:** 2026-08-18
**Origen:** ambos hallazgos salen del **ensayo real del circuito completo** hecho por Javi.

---

## 1. El estado del parte oscilaba tras firmar

**Reportado:** «al firmar —que se produce en otra web— y volver a la app, el estado
seguía mostrando *Datos Enviados* y ha oscilado, aunque a los pocos segundos se ha
consolidado».

**Causa raíz.** El parche de estado optimista (v1.12.1) solo cedía si el estado
entrante **coincidía** con él:

```js
if (p.estado === parche.estado || ahora - parche.ts > PARCHE_TTL_MS) { ... }
```

Al enviar datos queda un parche `Datos Enviados`. La firma ocurre fuera de la app y el
pipeline avanza el estado a `Listo para firmar` y luego a `Firmado`. Ninguno **coincide**
con el parche, así que este seguía pintando `Datos Enviados` **hasta agotar sus 60 s de
vida**. La oscilación es la caché de 30 s repartida entre instancias: unas respuestas
traían la foto vieja y otras la nueva, con el parche encima.

**El arreglo.** El parche existe para impedir que una foto obsoleta **retroceda** el
estado (hallazgo I8). No debe bloquear un **avance** legítimo. Se introduce el orden
funcional del ciclo de vida:

```
Borrador → Procesando → Datos Enviados → Listo para firmar → Firmado
```

Regla: si el estado del servidor **avanza o iguala** al del parche, el parche se suelta
y manda el servidor. Si **retrocede**, se mantiene (I8 sigue cerrado). Si el estado es
desconocido —por ejemplo uno nuevo en Notion—, manda el servidor.

> **Ojo:** es el orden **funcional**, no el de definición en Notion, que sitúa «Listo
> para firmar» antes que «Datos Enviados». El real lo marca el pipeline: `enviar-datos`
> pone «Datos Enviados», PARTES3/4 pone «Listo para firmar» al generar el PDF y
> PARTES4/4 pone «Firmado» al recibir la firma.

**Verificación:** 4 casos nuevos en la suite cubriendo avance, retroceso, coincidencia,
estado desconocido y normalización de mayúsculas/espacios.

---

## 2. La lista de empleados carga más al llegar abajo

**Pedido:** que al final de la lista se carguen más empleados en lugar de quedarse en
un tope fijo de 300.

**Antes:** «Mostrando 300 de 1533 empleados — escribe para filtrar». Para llegar a
alguien fuera de esos 300 había que filtrar por fuerza.

**Ahora:** tandas de 300 que crecen al desplazarse hasta el final:

```
300 → 600 → 900 → 1200 → 1500 → 1533 «no hay más»
```

El aviso acompaña el recuento y cambia el texto al llegar al final. Al cambiar el filtro
se vuelve a la primera tanda.

**Decisión técnica: se descartó `IntersectionObserver`.** Se implementó primero con un
centinela observado, y **no disparaba nunca**. Depurado en navegador: la lista tiene
scroll propio (~500 px visibles con cientos de filas) y, cuando el usuario llega a ella,
**el contenedor está fuera del viewport** (medido: la lista empieza en el píxel 1.135 de
una ventana de 720). Con el root fuera de pantalla el observador no reporta intersección.

Sustituido por detección directa del scroll del contenedor: se amplía la tanda al llegar
a 300 px del final. Menos elegante, pero determinista y verificado.

---

## Verificación

- Suite **70/70** (4 casos nuevos).
- Navegador contra **datos reales** (1.533 empleados): secuencia completa
  300→600→900→1200→1500→1533; filtrar «garcia» devuelve 74 sin aviso de tanda; limpiar
  el filtro vuelve a 300; el scroll sigue funcionando después.
