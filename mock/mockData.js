const { v4: uuidv4 } = require('uuid')

// Opciones de estado simuladas para la propiedad Estado de Notion
const estadoOptions = [
  { name: 'Activo', color: 'green' },
  { name: 'En pausa', color: 'yellow' },
  { name: 'Baja', color: 'red' },
  { name: 'Finalizado', color: 'blue' }
]

// Datos simulados para obras, jefes de obra, empleados, partes y detalles
const mockObras = [
  { id: 'obra-1', nombre: 'Reforma Sede Central', provincia: 'Madrid', estado: 'En curso' },
  { id: 'obra-2', nombre: 'Ampliación Planta Norte', provincia: 'Barcelona', estado: 'Planificada' },
  { id: 'obra-3', nombre: 'Mantenimiento Sur', provincia: 'Sevilla', estado: 'Finalizada' }
]

const mockJefesObra = [
  { id: 'jefe-1', nombre: 'Luis Pérez', email: 'luis.perez@example.com' },
  { id: 'jefe-2', nombre: 'Marta Ruiz', email: 'marta.ruiz@example.com' },
  { id: 'jefe-3', nombre: 'Daniel Gómez', email: 'daniel.gomez@example.com' }
]

const mockEmpleados = [
  {
    id: 'empleado-1',
    obraId: 'obra-1',
    nombre: 'Ana Gómez',
    categoria: 'Oficial 1ª',
    provincia: 'Madrid',
    localidad: 'Madrid',
    telefono: '600000001',
    dni: '12345678A',
    estado: 'Activo',
    delegado: 'Delegado Centro'
  },
  {
    id: 'empleado-2',
    obraId: 'obra-1',
    nombre: 'Carlos Martín',
    categoria: 'Peón especialista',
    provincia: 'Madrid',
    localidad: 'Getafe',
    telefono: '600000002',
    dni: '23456789B',
    estado: 'Activo',
    delegado: 'Delegado Centro'
  },
  {
    id: 'empleado-3',
    obraId: 'obra-2',
    nombre: 'Eva López',
    categoria: 'Oficial 2ª',
    provincia: 'Barcelona',
    localidad: 'Sabadell',
    telefono: '600000003',
    dni: '34567890C',
    estado: 'En pausa',
    delegado: 'Delegado Cataluña'
  },
  {
    id: 'empleado-4',
    obraId: 'obra-2',
    nombre: 'Javier Sánchez',
    categoria: 'Encargado',
    provincia: 'Barcelona',
    localidad: 'Terrassa',
    telefono: '600000004',
    dni: '45678901D',
    estado: 'Activo',
    delegado: 'Delegado Cataluña'
  },
  {
    id: 'empleado-5',
    obraId: 'obra-3',
    nombre: 'Lucía Fernández',
    categoria: 'Capataz',
    provincia: 'Sevilla',
    localidad: 'Dos Hermanas',
    telefono: '600000005',
    dni: '56789012E',
    estado: 'Baja',
    delegado: 'Delegado Andalucía'
  }
]

const mockPartes = [
  {
    id: 'parte-1',
    nombre: 'Parte Reforma Sede Central 10/03',
    fecha: '2024-03-10T08:00:00.000Z',
    ultimaEdicion: '2024-03-10T18:45:00.000Z',
    estado: 'Borrador',
    obra: 'Reforma Sede Central',
    obraId: 'obra-1',
    personaAutorizadaId: 'jefe-1',
    personaAutorizada: 'Luis Pérez',
    rpHorasTotales: 16,
    horasOficial1: 8,
    horasOficial2: 4,
    horasCapataz: 2,
    horasEncargado: 2,
    urlPDF: '',
    enviadoCliente: false,
    notas: 'Cableado planta 1',
    firmarUrl: 'https://mock.notion.local/firma/parte-1'
  },
  {
    id: 'parte-2',
    nombre: 'Revisión maquinaria Planta Norte',
    fecha: '2024-03-12T07:45:00.000Z',
    ultimaEdicion: '2024-03-12T15:30:00.000Z',
    estado: 'Firmado',
    obra: 'Ampliación Planta Norte',
    obraId: 'obra-2',
    personaAutorizadaId: 'jefe-2',
    personaAutorizada: 'Marta Ruiz',
    rpHorasTotales: 12,
    horasOficial1: 6,
    horasOficial2: 3,
    horasCapataz: 1.5,
    horasEncargado: 1.5,
    urlPDF: '',
    enviadoCliente: true,
    notas: 'Revisión preventiva completada',
    firmarUrl: 'https://mock.notion.local/firma/parte-2'
  }
]

mockPartes.forEach(parte => {
  parte.firmarUrl = parte.firmarUrl || buildFirmarUrl(parte)
})

const mockDetalles = [
  {
    id: 'detalle-1',
    parteId: 'parte-1',
    empleadoId: 'empleado-1',
    empleadoNombre: 'Ana Gómez',
    categoria: 'Oficial 1ª',
    horas: 8,
    fecha: '2024-03-10',
    detalle: 'Cableado eléctrico planta 1'
  },
  {
    id: 'detalle-2',
    parteId: 'parte-1',
    empleadoId: 'empleado-2',
    empleadoNombre: 'Carlos Martín',
    categoria: 'Peón especialista',
    horas: 8,
    fecha: '2024-03-10',
    detalle: 'Apoyo instalación bandejas'
  },
  {
    id: 'detalle-3',
    parteId: 'parte-2',
    empleadoId: 'empleado-3',
    empleadoNombre: 'Eva López',
    categoria: 'Oficial 2ª',
    horas: 6,
    fecha: '2024-03-12',
    detalle: 'Verificación maquinaria'
  },
  {
    id: 'detalle-4',
    parteId: 'parte-2',
    empleadoId: 'empleado-4',
    empleadoNombre: 'Javier Sánchez',
    categoria: 'Encargado',
    horas: 6,
    fecha: '2024-03-12',
    detalle: 'Coordinación de equipo'
  }
]

const clone = (value) => JSON.parse(JSON.stringify(value))

const findObra = (obraId) => mockObras.find((obra) => obra.id === obraId)
const findJefe = (jefeId) => mockJefesObra.find((jefe) => jefe.id === jefeId)
const findEmpleado = (empleadoId) => mockEmpleados.find((empleado) => empleado.id === empleadoId)
const findParte = (parteId) => mockPartes.find((parte) => parte.id === parteId)

const NON_EDITABLE_STATES = ['firmado', 'datos enviados', 'procesando']

const formatDateForName = (isoDate) => {
  try {
    return new Date(isoDate).toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    })
  } catch (error) {
    return new Date().toLocaleDateString('es-ES')
  }
}

const mapEmpleado = (empleado) => ({
  id: empleado.id,
  nombre: empleado.nombre,
  categoria: empleado.categoria,
  provincia: empleado.provincia,
  localidad: empleado.localidad,
  telefono: empleado.telefono,
  dni: empleado.dni,
  estado: empleado.estado,
  delegado: empleado.delegado,
  obraId: empleado.obraId
})

const buildFirmarUrl = (parte) => {
  const idParam = encodeURIComponent(parte?.id || '')
  const obraParam = encodeURIComponent(parte?.obra || '')
  return `https://www.copuno.com/es/notion/?parteId=${idParam}&obra=${obraParam}`
}

const mapParte = (parte) => ({
  id: parte.id,
  nombre: parte.nombre,
  fecha: parte.fecha,
  ultimaEdicion: parte.ultimaEdicion,
  estado: parte.estado,
  obra: parte.obra,
  obraId: parte.obraId,
  rpHorasTotales: parte.rpHorasTotales,
  horasOficial1: parte.horasOficial1,
  horasOficial2: parte.horasOficial2,
  horasCapataz: parte.horasCapataz,
  horasEncargado: parte.horasEncargado,
  urlPDF: parte.urlPDF,
  enviadoCliente: parte.enviadoCliente,
  notas: parte.notas,
  firmarUrl: parte.firmarUrl || buildFirmarUrl(parte),
  rectificaAId: parte.rectificaAId || null,
  rectificadoPorIds: parte.rectificadoPorIds || [],
  esRectificativo: Boolean(parte.rectificaAId)
})

const mapDetalle = (detalle) => ({
  id: detalle.id,
  empleadoId: detalle.empleadoId,
  empleadoNombre: detalle.empleadoNombre,
  categoria: detalle.categoria,
  horas: detalle.horas,
  fecha: detalle.fecha,
  detalle: detalle.detalle
})

const calculateHorasFromDetalles = (parteId) => {
  return mockDetalles
    .filter((detalle) => detalle.parteId === parteId)
    .reduce((total, detalle) => total + (Number(detalle.horas) || 0), 0)
}

const recalculateHoras = (parte) => {
  const totalHoras = calculateHorasFromDetalles(parte.id)
  parte.rpHorasTotales = totalHoras
  if (parte.horasOficial1 === undefined || parte.horasOficial1 === null) {
    parte.horasOficial1 = totalHoras
  }
  if (parte.horasOficial2 === undefined || parte.horasOficial2 === null) {
    parte.horasOficial2 = 0
  }
  if (parte.horasCapataz === undefined || parte.horasCapataz === null) {
    parte.horasCapataz = 0
  }
  if (parte.horasEncargado === undefined || parte.horasEncargado === null) {
    parte.horasEncargado = 0
  }
}

const createNotionLikePage = (parte) => ({
  object: 'page',
  id: parte.id,
  created_time: parte.fecha || new Date().toISOString(),
  last_edited_time: parte.ultimaEdicion || new Date().toISOString(),
  parent: {
    type: 'database_id',
    database_id: 'mock-database'
  },
  archived: false,
  properties: {
    'Nombre': {
      id: 'title',
      type: 'title',
      title: [
        {
          type: 'text',
          text: { content: parte.nombre },
          plain_text: parte.nombre
        }
      ]
    },
    'Fecha': {
      id: 'mock-fecha',
      type: 'date',
      date: {
        start: parte.fecha || new Date().toISOString(),
        end: null,
        time_zone: null
      }
    },
    'Estado': {
      id: 'mock-estado',
      type: 'status',
      status: {
        id: 'mock-status',
        name: parte.estado || 'Borrador',
        color: 'blue'
      }
    },
    'Notas': {
      id: 'mock-notas',
      type: 'rich_text',
      rich_text: parte.notas
        ? [
            {
              type: 'text',
              text: { content: parte.notas },
              plain_text: parte.notas
            }
          ]
        : []
    },
    'Obras': {
      id: 'mock-obras',
      type: 'relation',
      relation: parte.obraId ? [{ id: parte.obraId }] : [],
      has_more: false
    },
    'Persona Autorizada': {
      id: 'mock-persona-autorizada',
      type: 'relation',
      relation: parte.personaAutorizadaId ? [{ id: parte.personaAutorizadaId }] : [],
      has_more: false
    },
    'Enviar Datos': {
      id: 'mock-enviar-datos',
      type: 'button',
      button: {
        type: 'checked'
      }
    },
    'Firmar': {
      id: 'mock-firmar',
      type: 'formula',
      formula: {
        type: 'string',
        string: parte.firmarUrl || buildFirmarUrl(parte)
      }
    }
  },
  url: `https://mock.notion.local/${parte.id}`
})

const getHealthStatus = () => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
  notionToken: 'mock',
  mode: 'mock'
})

const getObras = () => clone(mockObras)
const getJefesObra = () => clone(mockJefesObra)
const getEmpleados = () => mockEmpleados.map(mapEmpleado)
const getEmpleadosPorObra = (obraId) => mockEmpleados.filter((empleado) => empleado.obraId === obraId).map(mapEmpleado)
const getEstadoOpciones = () => ({ type: 'status', options: clone(estadoOptions) })

const updateEmpleadoEstado = (empleadoId, nuevoEstado) => {
  const empleado = findEmpleado(empleadoId)
  if (!empleado) {
    throw new Error('Empleado no encontrado')
  }
  empleado.estado = nuevoEstado
  return mapEmpleado(empleado)
}

const getPartesTrabajo = () => {
  return mockPartes
    .slice()
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
    .map((parte) => {
      recalculateHoras(parte)
      return mapParte(parte)
    })
}

const getDetallesEmpleados = (parteId) => {
  return mockDetalles
    .filter((detalle) => detalle.parteId === parteId)
    .map(mapDetalle)
}

const getParteDetallesCompletos = (parteId) => {
  const parte = findParte(parteId)
  if (!parte) {
    throw new Error('Parte no encontrado')
  }
  recalculateHoras(parte)
  return {
    parte: {
      id: parte.id,
      nombre: parte.nombre,
      fecha: parte.fecha,
      obra: parte.obra,
      obraId: parte.obraId,
      estado: parte.estado,
      ultimaEdicion: parte.ultimaEdicion,
      notas: parte.notas,
      personaAutorizada: parte.personaAutorizadaId,
      firmarUrl: parte.firmarUrl || buildFirmarUrl(parte)
    },
    empleados: getDetallesEmpleados(parteId)
  }
}

const getParteEstado = (parteId) => {
  const parte = findParte(parteId)
  if (!parte) {
    throw new Error('Parte no encontrado')
  }
  return {
    estado: parte.estado,
    ultimaEdicion: parte.ultimaEdicion
  }
}

const createParteTrabajo = ({ obra, obraId, fecha, jefeObraId, notas, empleados = [], empleadosHoras = {} }) => {
  const obraInfo = findObra(obraId)
  const jefeInfo = findJefe(jefeObraId)
  if (!obraInfo) {
    throw new Error('Obra no encontrada')
  }
  if (!jefeInfo) {
    throw new Error('Persona Autorizada no encontrada')
  }

  const ahora = new Date().toISOString()
  const parteId = uuidv4()
  const parteNombre = `Parte ${obra || obraInfo.nombre} - ${formatDateForName(fecha)}`

  const nuevoParte = {
    id: parteId,
    nombre: parteNombre,
    fecha,
    ultimaEdicion: ahora,
    estado: 'Borrador',
    obra: obra || obraInfo.nombre,
    obraId: obraId,
    personaAutorizadaId: jefeObraId,
    personaAutorizada: jefeInfo.nombre,
    rpHorasTotales: 0,
    horasOficial1: 0,
    horasOficial2: 0,
    horasCapataz: 0,
    horasEncargado: 0,
    urlPDF: '',
    enviadoCliente: false,
    notas: notas || '',
    firmarUrl: buildFirmarUrl({ id: parteId, obra: obra || obraInfo.nombre })
  }

  mockPartes.unshift(nuevoParte)

  const detallesCreados = []
  empleados.forEach((empleadoId) => {
    const empleado = findEmpleado(empleadoId)
    if (!empleado) return
    const horas = Number(empleadosHoras[empleadoId] ?? 8)
    const detalle = {
      id: uuidv4(),
      parteId,
      empleadoId,
      empleadoNombre: empleado.nombre,
      categoria: empleado.categoria,
      horas,
      fecha: fecha?.split('T')?.[0] || new Date(fecha).toISOString().split('T')[0],
      detalle: `Horas registradas para ${empleado.nombre}`
    }
    mockDetalles.push(detalle)
    detallesCreados.push(detalle)
  })

  recalculateHoras(nuevoParte)

  return {
    ...createNotionLikePage(nuevoParte),
    empleadosCreados: empleados.length,
    detallesCreados: detallesCreados.length,
    erroresDetalles: 0,
    mensaje: `Parte creado exitosamente. ${detallesCreados.length} empleados asignados.`
  }
}

const updateParteTrabajo = (parteId, { obraId, fecha, personaAutorizadaId, notas, empleados = [], empleadosHoras = {} }) => {
  const parte = findParte(parteId)
  if (!parte) {
    throw new Error('Parte no encontrado')
  }
  const estadoLower = (parte.estado || '').toLowerCase()
  if (NON_EDITABLE_STATES.includes(estadoLower)) {
    const error = new Error('El parte no es editable por su estado actual')
    error.code = 'NOT_EDITABLE'
    error.meta = { estado: parte.estado }
    throw error
  }

  const obraInfo = obraId ? findObra(obraId) : null
  const jefeInfo = personaAutorizadaId ? findJefe(personaAutorizadaId) : null
  if (obraId && !obraInfo) {
    throw new Error('Obra no encontrada')
  }
  if (personaAutorizadaId && !jefeInfo) {
    throw new Error('Persona Autorizada no encontrada')
  }

  parte.fecha = fecha || parte.fecha
  parte.ultimaEdicion = new Date().toISOString()
  if (obraInfo) {
    parte.obraId = obraInfo.id
    parte.obra = obraInfo.nombre
  }
  if (jefeInfo) {
    parte.personaAutorizadaId = jefeInfo.id
    parte.personaAutorizada = jefeInfo.nombre
  }
  parte.notas = notas || ''

  // Eliminar detalles existentes del parte
  for (let i = mockDetalles.length - 1; i >= 0; i--) {
    if (mockDetalles[i].parteId === parteId) {
      mockDetalles.splice(i, 1)
    }
  }

  // Crear nuevos detalles con las horas actualizadas
  const detallesCreados = []
  empleados.forEach((empleadoId) => {
    const empleado = findEmpleado(empleadoId)
    if (!empleado) return
    const horas = Number(empleadosHoras[empleadoId] ?? 8)
    const detalle = {
      id: uuidv4(),
      parteId,
      empleadoId,
      empleadoNombre: empleado.nombre,
      categoria: empleado.categoria,
      horas,
      fecha: fecha?.split('T')?.[0] || new Date().toISOString().split('T')[0],
      detalle: `Horas registradas para ${empleado.nombre}`
    }
    mockDetalles.push(detalle)
    detallesCreados.push(detalle)
  })

  parte.firmarUrl = buildFirmarUrl(parte)
  recalculateHoras(parte)

  return {
    ...createNotionLikePage(parte),
    empleadosActualizados: empleados.length,
    detallesCreados: detallesCreados.length,
    erroresDetalles: 0,
    mensaje: `Parte actualizado exitosamente. ${detallesCreados.length} empleados asignados.`
  }
}

const rectificarParte = (parteOriginalId) => {
  const original = findParte(parteOriginalId)
  if (!original) {
    const error = new Error('Parte no encontrado')
    error.code = 'NOT_FOUND'
    throw error
  }
  if (!['firmado', 'datos enviados'].includes(String(original.estado || '').toLowerCase())) {
    const error = new Error('Solo los partes firmados o con datos enviados pueden rectificarse')
    error.code = 'NOT_RECTIFICABLE'
    error.meta = { estado: original.estado }
    throw error
  }

  if (original.rectificadoPorIds && original.rectificadoPorIds.length > 0) {
    const error = new Error('Este parte ya tiene un rectificativo asociado')
    error.code = 'NOT_RECTIFICABLE'
    error.meta = { estado: original.estado, rectificadoPorId: original.rectificadoPorIds[0] }
    throw error
  }

  const ahora = new Date().toISOString()
  const nuevoId = uuidv4()
  const nuevoParte = {
    id: nuevoId,
    nombre: `Parte rectificativo ${original.obra}`,
    fecha: original.fecha,
    ultimaEdicion: ahora,
    estado: 'Borrador',
    obra: original.obra,
    obraId: original.obraId,
    personaAutorizadaId: original.personaAutorizadaId,
    personaAutorizada: original.personaAutorizada,
    rpHorasTotales: 0,
    horasOficial1: 0,
    horasOficial2: 0,
    horasCapataz: 0,
    horasEncargado: 0,
    urlPDF: '',
    enviadoCliente: false,
    notas: original.notas && !original.notas.startsWith('PARTE RECTIFICATIVO')
      ? `PARTE RECTIFICATIVO\n${original.notas}`
      : original.notas || 'PARTE RECTIFICATIVO',
    firmarUrl: buildFirmarUrl({ id: nuevoId, obra: original.obra }),
    rectificaAId: parteOriginalId,
    rectificadoPorIds: []
  }
  mockPartes.unshift(nuevoParte)
  original.rectificadoPorIds = [...(original.rectificadoPorIds || []), nuevoId]

  const detallesCopiados = []
  mockDetalles
    .filter((detalle) => detalle.parteId === parteOriginalId)
    .forEach((d) => {
      const detalle = {
        id: uuidv4(),
        parteId: nuevoId,
        empleadoId: d.empleadoId,
        empleadoNombre: d.empleadoNombre,
        categoria: d.categoria,
        horas: d.horas,
        fecha: d.fecha,
        detalle: d.detalle
      }
      mockDetalles.push(detalle)
      detallesCopiados.push(detalle)
    })

  recalculateHoras(nuevoParte)

  return {
    ...createNotionLikePage(nuevoParte),
    parteOriginalId,
    detallesCopiados: detallesCopiados.length,
    erroresDetalles: 0,
    mensaje: `Parte rectificativo creado. ${detallesCopiados.length} empleados copiados.`
  }
}

const sendParteDatos = (parteId) => {
  const parte = findParte(parteId)
  if (!parte) {
    const error = new Error('Parte no encontrado')
    error.code = 'NOT_FOUND'
    throw error
  }

  const estadoActual = String(parte.estado || '').toLowerCase()
  if (estadoActual !== 'borrador') {
    const error = new Error('Solo se pueden enviar partes en estado Borrador')
    error.code = 'INVALID_STATE'
    error.meta = { estado: parte.estado }
    throw error
  }

  const data = createNotionLikePage(parte)
  const buttonEntry = data.properties?.['Enviar Datos'] || null
  const payload = {
    parteId,
    notionPageId: parte.id,
    page_id: parte.id,
    property_id: buttonEntry?.id || null,
    property_name: 'Enviar Datos',
    source: {
      type: 'copuno-app',
      action: 'enviar-datos',
      triggeredAt: new Date().toISOString(),
      mode: 'mock'
    },
    data
  }

  parte.estado = 'Procesando'
  parte.ultimaEdicion = new Date().toISOString()
  // Simula el PATCH final a "Datos Enviados" (en live lo hace server.js tras el webhook)
  parte.estado = 'Datos Enviados'

  return {
    parte: mapParte(parte),
    payload
  }
}

module.exports = {
  getHealthStatus,
  getObras,
  getJefesObra,
  getEmpleados,
  getEmpleadosPorObra,
  getEstadoOpciones,
  updateEmpleadoEstado,
  getPartesTrabajo,
  getDetallesEmpleados,
  getParteDetallesCompletos,
  getParteEstado,
  createParteTrabajo,
  updateParteTrabajo,
  rectificarParte,
  sendParteDatos
}
