# ADR-008 — Notion Workers frente a Make para el módulo de vehículos

- **Fecha:** 2026-08-13
- **Estado:** 🟢 **DECIDIDO — Make/backend para el módulo de vehículos.** Workers queda como
  candidato acotado a evaluar tras el 15-oct-2026, con el experimento descrito abajo.
- **Autor:** Javi Collado — evaluación en sesión de trabajo del 13-ago-2026 (investigación con
  fuentes oficiales de Notion + inventario del workspace del cliente por API)
- **Depende de:** [ADR-001](./ADR-001-notion-como-bbdd.md) (Notion como BBDD),
  [ADR-002](./ADR-002-capa-abstraccion-datos.md) (capa `data.js`),
  [ADR-007](./ADR-007-sincronizacion-notion-supabase.md) (Notion sigue siendo el puesto de trabajo)

---

## Contexto

El presupuesto del **módulo de vehículos** (precio cerrado, 13-ago-2026) plantea siete piezas:
ingesta y cotejo de facturas de taller, sync de telemetría Mapon → Notion, motor de avisos, informe
semanal a central, operativa por comandos y vigilancia de combustible. La arquitectura propuesta es
la que ya está en producción para el módulo de partes: **Make.com como músculo de ingesta y ETL +
backend Node/Express + API de Notion**, con Notion como puesto de trabajo del cliente.

En mayo de 2026 Notion lanzó la **Developer Platform** con una pieza nueva —**Workers**— que se
solapa con parte de ese trabajo. La pregunta que este ADR responde es la que se hará cualquiera que
audite el proyecto dentro de un año: **¿por qué se construyó con Make habiendo Workers?**

## Qué son los Workers (verificado en documentación oficial, 13-ago-2026)

Programas **Node/TypeScript propios** desplegados con la CLI `ntn` y **alojados en la
infraestructura de Notion** (sandbox). No son agentes de IA ni automatizaciones de base de datos:
son código. Tres disparadores: **Syncs** (traen datos externos a bases de Notion por horario, mín.
5 min / máx. 7 días, con cursor persistente), **Tools** (funciones que un Custom Agent invoca) y
**Webhooks** entrantes.

Lo relevante para este proyecto: **pueden hacer peticiones HTTP a APIs externas** desde el sandbox
—*"you can make HTTP requests to external APIs"*, overview oficial—, lo que las automatizaciones
nativas de Notion no pueden (su acción webhook es **solo POST** y solo envía propiedades, no el
contenido de la página). Coste: **0,0023 $/run**; un sync diario son ~0,07 $/mes.

## Condiciones del cliente (verificadas)

- **Copuno está en plan Business** → cumplen el requisito de Workers y Custom Agents.
- **No hay resistencia al coste de IA asociado al workspace** → el modelo de créditos no es una
  objeción comercial.
- Make ya está **contratado, en producción y auditado** en ese mismo workspace (escenarios PARTES,
  blueprints versionados en este repo, auditoría de edge cases E1-E10 de julio de 2026).

Es decir: **la decisión no se toma por imposibilidad, sino por criterio de riesgo.** Conviene que
quede escrito así.

## Decisión

**El módulo de vehículos se construye con Make + backend propio.** Workers no entra en el alcance
contratado. Razones, por peso:

1. **Beta con límites no documentados.** A 13-ago-2026 no existe página oficial de límites
   (`/workers/reference/limits` devuelve 404): no hay cifra oficial de *timeout* ni de memoria, y
   queda sin resolver si el sandbox aplica **allowlist de dominios salientes** —un tercero lo
   afirma, ninguna fuente oficial lo confirma ni lo desmiente—. Si Mapon no fuera alcanzable desde
   el sandbox, se descubriría a mitad de construcción.
2. **El calendario de facturación se cruza con el de entrega.** Workers es gratis en beta y
   **empieza a consumir créditos el 15-oct-2026**. La entrega del módulo cae a primeros de octubre:
   el sistema entraría en producción dos semanas antes de que cambie su modelo de coste.
3. **Auditabilidad desigual.** Make ofrece historial de ejecuciones por escenario con el payload de
   cada módulo y capacidad de repetición; para Workers, la documentación oficial solo describe
   `ntn workers sync status` y el panel de créditos. En un módulo del que depende la facturación de
   obra, poder reconstruir qué pasó a las 3 de la mañana no es accesorio.
4. **No hay ahorro que compense.** Make ya está pagado y rodado en este workspace. Migrar la pieza
   de sync a Workers no reduce el trabajo de diseño, integración, pruebas ni formación —que es
   donde está el coste real del proyecto—, y sí añade una superficie nueva que mantener.

### Lo que esta decisión NO afirma

- No afirma que Workers sea mala tecnología. Para el **sync de Mapon** (pieza 3) es literalmente su
  caso de uso de manual, y a 0,07 $/mes.
- No afirma que el precio del módulo dependa de la herramienta. **El presupuesto habría sido el
  mismo con Workers**: lo que se factura es el diseño sobre datos reales, la integración, las
  pruebas con la flota, la formación y la garantía — no las licencias.
- No cierra la puerta: fija cuándo se reabre.

## Criterios de reapertura

Se reevalúa **cuando se cumplan las tres**:

1. Ha pasado el **15-oct-2026** y el coste real de Workers es visible en el panel de créditos del
   cliente (no una estimación).
2. Notion publica límites oficiales de ejecución (timeout, memoria) y aclara la cuestión de la
   allowlist de dominios salientes.
3. El módulo de vehículos está entregado y estable — nunca durante la construcción.

### Experimento mínimo, cuando toque

Un Worker de tipo **Sync que traiga kilómetros de 5 vehículos** (no de los 158) a una base de
pruebas, **en paralelo** al Make que sigue siendo la fuente real. Mide tres cosas y ninguna más:

- si Mapon es alcanzable desde el sandbox (resuelve la allowlist),
- cuánto tarda una pasada real con datos del cliente (resuelve el timeout),
- qué se ve y qué avisa cuando falla a propósito (resuelve la auditabilidad).

Si las tres salen bien, migrar la pieza 3 se plantea **como mejora de mantenimiento**, nunca como
parte de un alcance cerrado.

## Nota sobre los agentes nativos de Notion

Hallazgo colateral de la investigación, verificado contra la API del workspace del cliente el
13-ago-2026: **los agentes de IA de Notion no aparecen en `GET /v1/users`**. Se ven las personas y
los bots de integración (Make, Softr, CodePen, Notion MCP, la integración propia), pero ningún
agente — el asistente que el cliente usa a diario es invisible por API; solo se intuye por un bot
llamado `Notion Agent Computer Session`.

Consecuencia de diseño: **no se puede inventariar ni auditar por API lo que un cliente tiene montado
con agentes nativos**. Por eso los agentes se reservan para lo conversacional y lo narrativo, y no
se ponen en el camino crítico del dato.
