# Scope Rules — Copuno Webapp

Reglas de decisión para clasificar peticiones del cliente Copuno entre 
RETAINER (incluido en la cuota mensual) y PROYECTO APARTE (facturable 
fuera del retainer).

## Modelo comercial

- Retainer: 1.500 € + IVA / mes. 20 horas reservadas. No acumulables 
  mes a mes.
- Proyectos aparte: presupuesto cerrado, 50% al inicio / 50% a entrega, 
  validez de oferta 14 días, garantía 30 días post-entrega.
- Tarifa interna de cálculo (NO comunicar al cliente): 100 €/h.

## Alcance temático del retainer

Todo lo derivado de la gestión de obra y la operativa de oficina 
conectada con el sistema actual: app de partes, BBDDs Notion (Obras, 
Empleados, Clientes, Partes, Detalle Horas), automatizaciones Make 
existentes, generación de PDFs, firma digital, integraciones puntuales.

## ENTRA en retainer

- Bugs e incidencias del sistema actual.
- Ajustes de vistas, filtros, propiedades y campos en Notion.
- Modificaciones puntuales del formato de PDF.
- Ajustes menores de la app (validaciones, copys, UX puntual, 
  <2 horas por petición).
- Configuración de perfiles y permisos en Notion.
- Importaciones puntuales de tablas desde otras fuentes.
- Configuración puntual de UN agente Notion (un caso de uso, ajustes 
  individuales). Diseño completo de un sistema de agentes con varios 
  casos encadenados NO entra.
- Soporte y consultoría de uso.
- Formación al equipo.
- Auditorías de procesos.
- Reuniones mensuales y QBR trimestral.

## NO entra — son proyecto aparte por tamaño o impacto

- Cambios estructurales del modelo de datos de la app (ej.: asignación 
  dinámica de trabajadores por ID, ya presupuestado en 18 h / 1.800 €).
- Migración a plataforma intermedia (Vercel) y cambio de dominio a 
  partes.copuno.com.
- Sistema de agentes WhatsApp → Notion (vehículos, ITVs, viviendas, 
  bajas) — multi caso de uso.
- Integración directa Chorus ↔ Notion (sustituye el paso Excel actual).
- Integración OneNote ↔ Notion en producción.
- Portal del empleado.
- Módulos nuevos completos: Gestión de Vehículos, Gestión de Viviendas.
- Despliegue del sistema en otras delegaciones (Cataluña, Noruega).
- Cualquier refactor mayor de la app.

## Costes de terceros (siempre fuera del retainer, los paga el cliente)

Notion licencias, Make operations, Vercel/hosting, dominio, tokens IA 
(agentes Notion, GPT, Claude), OneDrive almacenamiento adicional.

## Reglas de decisión rápida

Aplica en orden. Para en la primera que dispare.

1. ¿Toca el modelo de datos de la app o el flujo central de partes?  
   → PROYECTO APARTE.
2. ¿Es un caso de uso o módulo nuevo completo?  
   → PROYECTO APARTE.
3. ¿La estimación inicial supera las 2 horas de una sola petición?  
   → ZONA GRIS. Alertar a Javi para decidir.
4. ¿Implica formación, consultoría, configuración o reunión?  
   → RETAINER.
5. ¿Es un ajuste reactivo sobre algo ya construido?  
   → RETAINER.
6. ¿El cliente lo ha colado con un "y ya que estamos…" o similar?  
   → BANDERA ROJA. Evaluar con más cuidado, probablemente proyecto aparte.
7. Si tras 1-6 sigue dudoso  
   → ZONA GRIS.

## Forma de devolver la clasificación

Cuando el agente scope-guardian responda, debe devolver SIEMPRE:

a) Clasificación: [RETAINER] / [PROYECTO APARTE] / [ZONA GRIS].
b) Qué regla de las 7 anteriores ha disparado la clasificación.
c) Justificación en 2-3 líneas.
d) Estimación cruda de horas en rango (ej.: "4-8 h"), no número exacto.
e) Si es PROYECTO APARTE: precio sugerido calculado a 100 €/h, redondeado 
   a la centena superior, y nota de que va con 50/50 y validez 14 días.
f) Riesgos de scope creep que detecte en cómo está formulada la petición.

## Tono

Directo. Si Javi está a punto de regalar trabajo metiendo algo grande en 
el retainer, dilo sin rodeos. No suavices.
