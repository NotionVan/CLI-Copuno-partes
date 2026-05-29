# Changelog — Versión 1.3.1

**Fecha:** 29 de mayo de 2026

---

## Correcciones

### Fix residual SSE en cerrarDetalles

Al eliminar el SSE en v1.3.0 quedó una referencia a `estadoStreamRef` en la función `cerrarDetalles()` que causaba `ReferenceError: estadoStreamRef is not defined` en consola cada vez que se abría el modal de detalles. No afectaba a la funcionalidad (el modal seguía funcionando) pero generaba ruido en consola y podía enmascarar errores reales.

Sustituida por `estadoPollRef` con `clearInterval`, el ref del polling client-side que reemplaza al SSE.

---

## Verificación

- Smoke tests: 33/33 verdes.
- QA Chrome v1.3.1: modal de detalles abierto 8+ segundos sin errores de consola. Polling a `/estado` visible en Network. Sin `/estado/stream`. ✅
