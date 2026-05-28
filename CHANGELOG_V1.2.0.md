# 📋 Changelog - Versión 1.2.0

**Fecha:** 28 de mayo de 2026

---

## 🆕 Nuevas Funcionalidades

### Banner de actualización disponible

- Cuando el servidor despliega una versión nueva, los usuarios que tienen la app abierta en el navegador ven automáticamente un banner azul en la parte superior con el mensaje "Hay una nueva versión disponible".
- El banner incluye un botón **Actualizar ahora** que recarga la página, y un botón de cierre para ignorarlo temporalmente.
- La comprobación se hace al arrancar la app y cada 5 minutos en segundo plano (sin bloquear la UI).
- Mecanismo: Vite embebe la versión de `package.json` como constante `__APP_VERSION__` en build time. El frontend la compara con la que devuelve `GET /api/health`. Si difieren, se activa el banner.

---

## 📁 Archivos Modificados

| Archivo | Cambios |
|---------|---------|
| `src/App.jsx` | Estado `hayActualizacion`, `useEffect` de comprobación de versión cada 5 min, banner en JSX |
| `src/App.css` | Estilos del banner (`.update-banner`, `.update-banner-btn`, `.update-banner-close`) |
| `CLAUDE.md` | Convención SemVer ampliada: criterio de bump patch/minor/major y su relación con el banner |
| `package.json` | Versión 1.1.0 → 1.2.0 |

---

## 🔄 Migración

No se requieren cambios en Notion, Make ni variables de entorno.

---

## 📋 Notas Técnicas

- El endpoint `/api/health` ya existía y devolvía `version` — no requirió cambios en servidor.
- `__APP_VERSION__` ya estaba definido en `vite.config.js` — no requirió cambios en config de build.
- La convención de bump queda documentada en `CLAUDE.md` sección "Convenciones del proyecto": cada deploy debe incluir un bump acorde al peso del cambio para que el banner funcione.
