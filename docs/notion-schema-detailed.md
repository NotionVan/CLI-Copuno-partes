# Esquema Detallado de Bases de Datos - Notion

## Configuración API
- Define `NOTION_TOKEN` en tu entorno (no publiques este valor)
- **API**: `https://api.notion.com/v1`

## Bases de Datos

### OBRAS (Obras)
- **ID**: `20882593a257810083d6dc8ec0a99d58`
- **Descripción**: Obras

#### Propiedades:
- **Fecha de creación**: created_time (tiempo creado)
- **Encargado**: select (selección - 4 opciones)
- **Responsables PRL **: relation (relación con otra BD)
- **Última edición**: last_edited_time (última edición)
- **Precio Encargado**: number (número - euro)
- **Precio Peón **: number (número - euro)
- **Provincia**: select (selección - 15 opciones)
- **Estado**: status (status)
- **Precio Capataz**: number (número - euro)
- **Creado por**: created_by (creado por)
- **Empleados**: relation (relación con otra BD)
- **Última edición por**: last_edited_by (editado por)
- **Precio Oficial 2ª**: number (número - euro)
- **Partes de trabajo**: relation (relación con otra BD)
- **Precio Oficial 1ª**: number (número - euro)
- **Clientes**: relation (relación con otra BD)
- **AUX Fechas del parte**: rollup (rollup)
- **Obra - Codigo**: title (título)

#### Ejemplo de Registro:
- **Fecha de creación**: 2025-08-22T22:30:00.000Z
- **Encargado**: Pedro Garcia Acacio
- **Responsables PRL **: [0 relaciones]
- **Última edición**: 2025-08-22T22:33:00.000Z
- **Precio Encargado**: 
- **Precio Peón **: 
- **Provincia**: MADRID
- **Estado**: [status]
- **Precio Capataz**: 
- **Creado por**: Efrén
- **Empleados**: [0 relaciones]
- **Última edición por**: Efrén
- **Precio Oficial 2ª**: 
- **Partes de trabajo**: [0 relaciones]
- **Precio Oficial 1ª**: 
- **Clientes**: [1 relaciones]
- **AUX Fechas del parte**: [rollup]
- **Obra - Codigo**: Saucedilla

---

### JEFE_OBRAS (Persona Autorizada)
- **ID**: `20882593a25781b4a3b9e0ff5589ea4e`
- **Descripción**: Persona Autorizada

#### Propiedades:
- **Partes de trabajo**: relation (relación con otra BD)
- ** Email**: email (email)
- **Persona Autorizada**: title (título)

#### Ejemplo de Registro:
- **Partes de trabajo**: [2 relaciones]
- ** Email**: rfayos@copuno.com
- **Persona Autorizada**: Raul Fayos Martinez

---

### DETALLES_HORA (Detalle Horas)
- **ID**: `20882593a25781838da1fe6741abcfd9`
- **Descripción**: Detalle Horas

#### Propiedades:
- **AUX_Categoria**: formula (fórmula)
- **Empleados**: relation (relación con otra BD)
- **Fecha Parte**: rollup (rollup)
- **Aux Empleado**: rollup (rollup)
- **Categoría-roll-aux**: rollup (rollup)
- **Partes de trabajo**: relation (relación con otra BD)
- **Estado Parte**: rollup (rollup)
- **Cantidad Horas**: number (número - number)
- **Hoy - 0 horas**: formula (fórmula)
- **Fecha PArte de Trabajo**: rollup (rollup)
- **ID Parte Trabajo**: rollup (rollup)
- **AUX_Categoría**: formula (fórmula)
- **AUX Estado**: rollup (rollup)
- **ID**: unique_id (unique_id)
- **Detalle**: title (título)

#### Ejemplo de Registro:
- **AUX_Categoria**: 08- OF. 2ª ALBAÑIL
- **Empleados**: [1 relaciones]
- **Fecha Parte**: [rollup]
- **Aux Empleado**: [rollup]
- **Categoría-roll-aux**: [rollup]
- **Partes de trabajo**: [1 relaciones]
- **Estado Parte**: [rollup]
- **Cantidad Horas**: 7.5
- **Hoy - 0 horas**: 
- **Fecha PArte de Trabajo**: [rollup]
- **ID Parte Trabajo**: [rollup]
- **AUX_Categoría**: [08- OF. 2ª ALBAÑIL]
- **AUX Estado**: [rollup]
- **ID**: [unique_id]
- **Detalle**:  

---

### EMPLEADOS (Empleados)
- **ID**: `20882593a257814db882c4b70cb0cbab`
- **Descripción**: Empleados

#### Propiedades:
- **Categoría**: select (selección - 48 opciones)
- **Obras**: relation (relación con otra BD)
- **Delegado**: select (selección - 8 opciones)
- **1R COGNOM**: rich_text (texto)
- **Obra**: rollup (rollup)
- **Detalle Horas**: relation (relación con otra BD)
- **Provincia**: select (selección - 62 opciones)
- **Caduca**: date (fecha)
- **Estado**: select (selección - 13 opciones)
- **R. Medica**: date (fecha)
- **ID Trabajador**: unique_id (unique_id)
- **Teléfono**: phone_number (teléfono)
- **2N COGNOM**: rich_text (texto)
- **Parte**: rollup (rollup)
- **Localidad**: select (selección - 317 opciones)
- **Fecha Nacimiento**: date (fecha)
- **Otros**: rich_text (texto)
- **Fecha Alta**: date (fecha)
- **AUX **: formula (fórmula)
- **DNI**: rich_text (texto)
- **Adjunto**: files (files)
- **NAF**: number (número - number)
- **Nombre Completo**: title (título)

#### Ejemplo de Registro:
- **Categoría**: 09- PEON ESPECIALISTA 
- **Obras**: [0 relaciones]
- **Delegado**: JOSE Mº
- **1R COGNOM**: HERNANDEZ
- **Obra**: [rollup]
- **Detalle Horas**: [0 relaciones]
- **Provincia**: CACERES
- **Caduca**: 
- **Estado**: ON - Disponible
- **R. Medica**: 
- **ID Trabajador**: [unique_id]
- **Teléfono**: 646795742
- **2N COGNOM**: RODRIGUEZ
- **Parte**: [rollup]
- **Localidad**: MORALEJA
- **Fecha Nacimiento**: 
- **Otros**: 
- **Fecha Alta**: 
- **AUX **: LUIS MIGUEL HERNANDEZ RODRIGUEZ HERNANDEZ RODRIGUEZ
- **DNI**: 76013537D
- **Adjunto**: [files]
- **NAF**: 100044040610
- **Nombre Completo**: LUIS MIGUEL HERNANDEZ RODRIGUEZ

---

### PARTES_TRABAJO (Partes de trabajo)
- **ID**: `20882593a25781258595e15abb37e87a`
- **Descripción**: Partes de trabajo
- **Props nuevas (rectificativos, 2026-05-28 — pendientes de crear en Notion):** `Rectifica a` (relation reflexiva → Partes de trabajo, dual), `Rectificado por` (lado sincronizado), `Es Rectificativo` (formula `not empty(prop("Rectifica a"))`). El backend escribe `Rectifica a` al crear un rectificativo; Make lee `Es Rectificativo` para marcar el PDF.

#### Propiedades:
- **AUX Pr OF1**: rollup (rollup)
- **Última edición por**: last_edited_by (editado por)
- **AUX Pr OF2**: rollup (rollup)
- **Detalle Horas**: relation (relación con otra BD)
- **AUX Obra en Texto**: formula (fórmula)
- **RP Horas Encargado**: formula (fórmula)
- **Enviar Datos**: button (button)
- **AUX Pr Peón**: rollup (rollup)
- **AUX Obra**: formula (fórmula)
- **Imp Horas Peon**: formula (fórmula)
- **Fecha**: date (fecha)
- **RP Horas Oficial 1ª**: formula (fórmula)
- **Enviado a cliente**: checkbox (checkbox)
- **Horas Peon**: formula (fórmula)
- **Horas Oficial 1ª**: formula (fórmula)
- **TOCAR URL PARA FIRMAR**: rich_text (texto)
- **AUX Jefe de Obra**: formula (fórmula)
- **Email Jefe Obra**: rollup (rollup)
- **Horas Capataz**: formula (fórmula)
- **RP Horas Oficial **: formula (fórmula)
- **RP Horas Peon**: formula (fórmula)
- **URL PDF**: url (URL)
- **Firmar**: formula (fórmula)
- **RP Horas Capataz **: formula (fórmula)
- **Horas Encargado **: formula (fórmula)
- **RP Horas Oficial 2ª**: formula (fórmula)
- **Imp Horas Of 1ª**: formula (fórmula)
- **AUX Pr Capataz**: rollup (rollup)
- **Importe total**: formula (fórmula)
- **RP Importe Parte**: formula (fórmula)
- **Última edición**: last_edited_time (última edición)
- **AUX Pr Encargado**: rollup (rollup)
- **Notas**: rich_text (texto)
- **Vehiculos**: rich_text (texto, SIN tilde desde v1.5.1 — el editor de Make trunca paths no-ASCII) — matrículas separadas por comas (creada 2026-07-14)
- **Imp Horas Capataz**: formula (fórmula)
- **Persona Autorizada**: relation (relación con otra BD)
- **Horas Oficial 2ª **: formula (fórmula)
- **AUX ID PDF Onedrive**: rich_text (texto)
- **Documento Firmado**: files (files)
- **Obras**: relation (relación con otra BD)
- **ID**: unique_id (unique_id)
- **RP Horas totales**: formula (fórmula)
- **Horas totales**: rollup (rollup)
- **Imp Horas Encargado**: formula (fórmula)
- **Estado**: status (status)
- **Total Horas Oficial**: formula (fórmula)
- **Enviar email al cliente**: button (button)
- **AUX Obra para filtro softr**: rollup (rollup)
- **Imp Horas Of 2ª**: formula (fórmula)
- **AUX Precios Hora**: relation (relación con otra BD)
- **Nombre**: title (título)

#### Ejemplo de Registro:
- **AUX Pr OF1**: [rollup]
- **Última edición por**: Make
- **AUX Pr OF2**: [rollup]
- **Detalle Horas**: [3 relaciones]
- **AUX Obra en Texto**: Pelayo
- **RP Horas Encargado**: 16 Horas de encargado con un importe de 368€
- **Enviar Datos**: [button]
- **AUX Pr Peón**: [rollup]
- **AUX Obra**: Pelayo
- **Imp Horas Peon**: 
- **Fecha**: 2025-08-25T00:00:00.000+02:00
- **RP Horas Oficial 1ª**: 0 Horas de oficial de 1ª con un importe de 0€
- **Enviado a cliente**: No
- **Horas Peon**: 
- **Horas Oficial 1ª**: 
- **TOCAR URL PARA FIRMAR**: TOCAR ESTA URL PARA FIRMAR ⬇️
- **AUX Jefe de Obra**: Adolfo Montes
- **Email Jefe Obra**: [rollup]
- **Horas Capataz**: 
- **RP Horas Oficial **: 0 Horas de oficial con un importe de 0 €
- **RP Horas Peon**: 0 Horas de peón con un importe de 0€
- **URL PDF**: 
- **Firmar**: https://www.copuno.com/es/notion/?parteId=97&obra=Pelayo
- **RP Horas Capataz **: 0 Horas de capataz con un importe de 0€
- **Horas Encargado **: 16
- **RP Horas Oficial 2ª**: 0 Horas de oficial de 2ª con un importe de 0€
- **Imp Horas Of 1ª**: 
- **AUX Pr Capataz**: [rollup]
- **Importe total**: 368
- **RP Importe Parte**: Importe del parte:  368€
- **Última edición**: 2025-08-25T11:43:00.000Z
- **AUX Pr Encargado**: [rollup]
- **Notas**: nota del parte
- **Vehiculos**: matrículas de los vehículos del parte (texto, separadas por comas)
- **Imp Horas Capataz**: 
- **Persona Autorizada**: [1 relaciones]
- **Horas Oficial 2ª **: 
- **AUX ID PDF Onedrive**: 
- **Documento Firmado**: [files]
- **Obras**: [1 relaciones]
- **ID**: [unique_id]
- **RP Horas totales**: Este parte tiene un total de 16 Horas
- **Horas totales**: [rollup]
- **Imp Horas Encargado**: 368
- **Estado**: [status]
- **Total Horas Oficial**: 
- **Enviar email al cliente**: [button]
- **AUX Obra para filtro softr**: [rollup]
- **Imp Horas Of 2ª**: 
- **AUX Precios Hora**: [0 relaciones]
- **Nombre**: Parte Pelayo97

---


## BD Vehículos (flota) — v1.6.0

- **ID:** `fa4028b246494415aee021f3569ce8f8` · Título: "Vehículos " (con espacio final)
- Mantenida por el equipo de Copuno. Usada por `GET /api/vehiculos/buscar` (autocompletado del campo Vehículos del parte). Solo lectura desde la app.
- Propiedades relevantes para la app: **Matrícula** (title), **Tipo** (select), **Marca / Modelo** (rich_text), **Estado** (status — se muestra ⚠️ en las sugerencias si no está operativo).
- Otras propiedades (no usadas por la app): ITV/Próxima revisión, Talleres, Baliza, Conductor, Obra, Kilómetros… — base del futuro módulo de flota (Mapon/Solred).
