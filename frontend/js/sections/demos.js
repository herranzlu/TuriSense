// Demos: 2-3 casos reales de principio a fin (señal → aspecto → contexto oficial →
// oportunidad/riesgo → decisión), pensados para presentar la herramienta sin
// capturas ni cifras preparadas. Cada caso pide datos en vivo a los mismos
// endpoints que ya usan Actualidad, Experiencia del viajero, Mercado turístico y
// Oportunidades: no hay ningún dato nuevo ni calculado aquí, solo una lectura
// narrada de datos que la herramienta ya muestra en otro sitio.
import { api } from "../api.js";
import { el, fmtPct, fmtNum, conCarga } from "../utils.js";
import { ETIQUETA_ACCION } from "./oportunidad.js";
import { cifraConUnidad, esPorcentaje } from "./contexto.js";

let inicializado = false;
let etiquetaAspecto = {}; // key -> label, de /api/aspectos
let casoActivo = null;
const cache = {}; // caso.id -> datos ya pedidos, para no repetir peticiones al cambiar de pestaña

// La elección de los 3 casos es curatorial (qué historia merece la pena contar),
// pero ninguna cifra de las que se muestran está escrita a mano: se piden en vivo
// a partir de esta CCAA + aspecto + indicador oficial elegidos.
const CASOS = [
  {
    id: "cantabria-precio",
    etiqueta: "Cantabria · Precio",
    ccaa: "Cantabria",
    aspecto: "precio",
    indicadorOficial: "egatur_spend_per_nonresident_tourist_eur",
  },
  {
    id: "baleares-precio",
    etiqueta: "Illes Balears · Precio",
    ccaa: "Illes Balears",
    aspecto: "precio",
    indicadorOficial: "hotel_occupancy_capacity_pct",
  },
  {
    id: "madrid-equipamiento",
    etiqueta: "Comunidad de Madrid · Equipamiento",
    ccaa: "Comunidad de Madrid",
    aspecto: "equipamiento",
    indicadorOficial: "hotel_occupancy_capacity_pct",
  },
];

// Qué podría hacer un Product Manager: una elaboración razonada de la
// acción_sugerida real (nunca una acción distinta a la que ya calcula
// /api/oportunidad/mapa), pero "vigilar" no puede quedarse en "esperar y ver":
// se apoya en el resto de datos ya mostrados (posición en el aspecto, dato
// oficial) para proponer algo concreto y realista, no un placeholder vacío.
function decisionTexto(caso, oportunidad, posicion, indicador) {
  const accion = oportunidad.accion_sugerida;
  const aspectoLabel = (etiquetaAspecto[caso.aspecto] ?? caso.aspecto).toLowerCase();
  const malPosicionado = posicion && posicion.puesto > posicion.total / 2;
  const yoy = indicador?.variacion_interanual_pct_ccaa;
  const yoyTxt = typeof yoy === "number" ? ` (${yoy >= 0 ? "+" : ""}${yoy.toFixed(1)}% interanual)` : "";

  if (accion === "renegociar") {
    return `Abrir una renegociación de condiciones con los alojamientos de ${caso.ccaa} antes de la próxima temporada alta, centrada en ${aspectoLabel}: es el aspecto que ya pesaba más en su Opportunity Score, y la tendencia reciente lo confirma con datos de los últimos meses.`;
  }

  if (accion === "vigilar" && malPosicionado) {
    // Caso Baleares: el sistema todavía no lo marca como "renegociar", pero ya
    // es de las peor valoradas del país en este aspecto: vale la pena adelantarse.
    return `El sistema todavía lo marca como "vigilar", no como una renegociación directa, pero ${caso.ccaa} ya es de las comunidades peor valoradas de España en ${aspectoLabel} (puesto ${posicion.puesto} de ${posicion.total})${indicador ? `, con ${indicador.etiqueta.toLowerCase()} moviéndose${yoyTxt}` : ""}. Una línea de actuación realista, sin esperar a que se convierta en el motor dominante: revisar con los partners de alojamiento si hay margen para ajustar precio o crear paquetes específicos en temporada baja, antes de fijar las tarifas de la próxima campaña sobre estos mismos números.`;
  }

  if (accion === "vigilar" && !malPosicionado) {
    // Caso Madrid: sigue bien valorado, la racha es la señal nueva que el
    // Opportunity Score histórico todavía no ha capturado.
    return `${caso.ccaa} sigue bien valorada en ${aspectoLabel} (puesto ${posicion.puesto} de ${posicion.total}), así que no hace falta una renegociación de precio. Pero con una racha de esta evidencia${indicador ? ` mientras ${indicador.etiqueta.toLowerCase()} se mueve${yoyTxt}` : ""}, una línea de actuación realista es pedir a los alojamientos con más reseñas negativas recientes de ${aspectoLabel} una revisión de mantenimiento concreta (el equipamiento suele desgastarse más rápido cuanta más ocupación hay), antes de que la próxima temporada alta lo empeore todavía más.`;
  }

  if (accion === "diagnosticar") {
    return `Abrir un diagnóstico cualitativo antes de decidir nada a nivel de comunidad: revisar a mano una muestra de las reseñas negativas recientes de ${aspectoLabel} en ${caso.ccaa} para ver si el problema se concentra en unos pocos establecimientos o zonas concretas, o si es realmente generalizado.`;
  }

  if (accion === "promocionar") {
    return `Aprovechar el buen momento para promocionar ${caso.ccaa}: la tendencia detectada en ${aspectoLabel} no compromete, por ahora, su posicionamiento general.`;
  }

  return "Sin una acción sugerida reconocida para elaborar una decisión.";
}

function panelVacio(mensaje) {
  return `<p class="muted">${mensaje}</p>`;
}

function bloqueSenal(caso, alerta) {
  if (!alerta) {
    return panelVacio(
      `Ahora mismo no hay ninguna racha activa de empeoramiento en ${etiquetaAspecto[caso.aspecto] ?? caso.aspecto} en ${caso.ccaa}: la señal que motivó este caso ya no está vigente con los datos más recientes (esto es justo lo que se espera de un radar en vivo: no siempre hay una racha activa).`,
    );
  }
  return `
    <div class="caso-dato-fila">
      <span><b>${alerta.meses_consecutivos_empeorando}</b> meses seguidos empeorando</span>
      <span><b>${fmtPct(alerta.tasa_negativa_actual)}</b> de reseñas negativas sobre ${alerta.etiqueta_aspecto.toLowerCase()}</span>
      <span>sobre <b>${fmtNum(alerta.n_reviews)}</b> reseñas · último dato: ${alerta.periodo}</span>
    </div>
    <p>Durante ${alerta.meses_consecutivos_empeorando} meses consecutivos, el porcentaje de reseñas negativas sobre <b>${alerta.etiqueta_aspecto.toLowerCase()}</b> en <b>${caso.ccaa}</b> no ha dejado de empeorar mes a mes. Es una racha activa ahora mismo, no un pico aislado de un solo mes.</p>`;
}

function bloqueAspecto(caso, posicion) {
  if (!posicion) return panelVacio("No hay evidencia suficiente de este aspecto en esta comunidad para calcular su posición nacional.");
  // La lectura cambia según dónde esté realmente la CCAA: si ya está mal posicionada
  // en general, la racha reciente confirma un problema estructural; si está bien
  // posicionada, la racha es la señal más interesante de las dos, porque el ranking
  // general todavía no lo refleja (justo lo que un radar en vivo tiene que anunciar).
  const malPosicionada = posicion.puesto > posicion.total / 2;
  const lectura = malPosicionada
    ? `en el conjunto de reseñas de alojamientos y restauración de ${caso.ccaa}, es de los peor valorados del país en este aspecto concreto: no es una queja aislada, es una posición estructuralmente baja que la racha reciente empeora todavía más.`
    : `en el conjunto de reseñas de alojamientos y restauración de ${caso.ccaa}, sigue siendo de los mejor valorados del país en este aspecto. La racha reciente es, precisamente por eso, la señal más interesante de las dos: algo está cambiando que el ranking general todavía no refleja.`;
  return `
    <div class="caso-dato-fila">
      <span><b>${fmtPct(posicion.pct)}</b> de valoraciones positivas en general</span>
      <span>puesto <b>${posicion.puesto}</b> de <b>${posicion.total}</b> CCAA</span>
    </div>
    <p><b>${posicion.etiqueta}</b> es el aspecto que explica la señal: ${lectura}</p>`;
}

function bloqueContexto(indicador) {
  if (!indicador) return panelVacio("No hay dato oficial disponible para este indicador en esta comunidad.");
  const yoy = indicador.variacion_interanual_pct_ccaa;
  const yoyTxt =
    yoy === null || yoy === undefined ? "" : ` (${yoy >= 0 ? "+" : ""}${yoy.toFixed(1)}% interanual)`;
  // Con unidades en "%" el símbolo ya va pegado a la cifra (cifraConUnidad): repetir
  // el texto completo de la unidad al lado sería "44,82% % de plazas hoteleras".
  const unidadSecundaria = esPorcentaje(indicador.unidad) ? "" : ` ${indicador.unidad}`;
  return `
    <div class="caso-dato-fila">
      <span><b>${cifraConUnidad(indicador.valor_ccaa, indicador.unidad)}</b>${unidadSecundaria}</span>
      <span>puesto <b>${indicador.puesto_ccaa}</b> de <b>${indicador.total_ccaa_con_dato}</b>${yoyTxt}</span>
    </div>
    <p>Según datos oficiales (${indicador.fuente}), este es el contexto de <b>${indicador.etiqueta.toLowerCase()}</b> en ${indicador.provisional ? "el último mes disponible (dato provisional)" : "el último mes disponible"}: no es una lectura de reseñas, es una cifra institucional, el dato con el que contrastar si la señal detectada arriba encaja con lo que también dicen las fuentes oficiales.</p>`;
}

function bloqueOportunidad(caso, oportunidad) {
  if (!oportunidad) return panelVacio("Esta comunidad no aparece con evidencia suficiente en el Opportunity Score.");
  const motorLabel = etiquetaAspecto[oportunidad.aspecto_motor] ?? oportunidad.aspecto_motor;
  const coincide = oportunidad.aspecto_motor === caso.aspecto;
  const notaCoincidencia = coincide
    ? `El aspecto que más pesa en esta puntuación es, precisamente, <b>${motorLabel.toLowerCase()}</b>: la tendencia reciente confirma, con datos de los últimos meses, lo que el Opportunity Score ya venía señalando.`
    : `El aspecto que más pesa en esta puntuación hoy es <b>${motorLabel.toLowerCase()}</b>, distinto del que muestra la señal reciente: es justo el tipo de cambio que conviene detectar pronto, antes de que se convierta en el motor dominante de la puntuación.`;
  return `
    <div class="caso-dato-fila">
      <span>puesto <b>${oportunidad.puesto}</b> de 19 en Opportunity Score</span>
      <span>puntuación <b>${oportunidad.puntuacion.toFixed(1)}</b>/100</span>
      <span>acción sugerida: <b>${ETIQUETA_ACCION[oportunidad.accion_sugerida] ?? oportunidad.accion_sugerida}</b></span>
    </div>
    <p>${notaCoincidencia}</p>`;
}

function bloqueDecision(caso, oportunidad, posicion, indicador) {
  if (!oportunidad) return panelVacio("Sin Opportunity Score calculado para esta comunidad, no hay una acción sugerida que elaborar.");
  return `<div class="caso-decision"><p>${decisionTexto(caso, oportunidad, posicion, indicador)}</p></div>`;
}

async function cargarCaso(caso) {
  if (!cache[caso.id]) {
    const [alertas, rankingNacional, contexto, oportunidadTodas] = await conCarga(
      Promise.all([
        api.get(`/tendencia/alertas?ccaa=${encodeURIComponent(caso.ccaa)}`),
        api.get(`/ccaa/ranking?metrica=${caso.aspecto}`),
        api.get(`/contexto?ccaa=${encodeURIComponent(caso.ccaa)}`),
        api.get("/oportunidad/mapa"),
      ]),
    );
    cache[caso.id] = { alertas, rankingNacional, contexto, oportunidadTodas };
  }
  const { alertas, rankingNacional, contexto, oportunidadTodas } = cache[caso.id];

  const alerta = alertas.alertas.find((a) => a.aspecto === caso.aspecto) ?? null;

  const ordenados = rankingNacional.ccaa;
  const idx = ordenados.findIndex((c) => c.ccaa === caso.ccaa);
  const posicion =
    idx >= 0
      ? { puesto: idx + 1, total: ordenados.length, pct: ordenados[idx].pct_positivo, etiqueta: etiquetaAspecto[caso.aspecto] ?? caso.aspecto }
      : null;

  const indicador = contexto.indicadores_mensuales.find((i) => i.indicator_id === caso.indicadorOficial) ?? null;

  const oportunidad = oportunidadTodas.ccaa.find((c) => c.ccaa === caso.ccaa) ?? null;

  el("demos-contenido").innerHTML = `
    <div class="panel caso-resumen">
      <h3>${caso.etiqueta}</h3>
      <p class="muted">Un caso real, no un ejemplo preparado: si en el momento de ver esto la racha ya no está activa, es la propia herramienta funcionando como radar en vivo, no un guion fijo.</p>
    </div>
    <div class="caso-timeline">
      <div class="caso-etapa">
        <div class="caso-etapa-num">1</div>
        <div class="caso-etapa-cuerpo"><h4>Señal detectada</h4>${bloqueSenal(caso, alerta)}</div>
      </div>
      <div class="caso-etapa">
        <div class="caso-etapa-num">2</div>
        <div class="caso-etapa-cuerpo"><h4>Aspecto que la explica</h4>${bloqueAspecto(caso, posicion)}</div>
      </div>
      <div class="caso-etapa">
        <div class="caso-etapa-num">3</div>
        <div class="caso-etapa-cuerpo"><h4>Contexto con datos oficiales</h4>${bloqueContexto(indicador)}</div>
      </div>
      <div class="caso-etapa">
        <div class="caso-etapa-num">4</div>
        <div class="caso-etapa-cuerpo"><h4>Oportunidad / riesgo</h4>${bloqueOportunidad(caso, oportunidad)}</div>
      </div>
      <div class="caso-etapa">
        <div class="caso-etapa-num">5</div>
        <div class="caso-etapa-cuerpo"><h4>Decisión de un Product Manager</h4>${bloqueDecision(caso, oportunidad, posicion, indicador)}</div>
      </div>
    </div>`;
}

async function cambiarCaso(id) {
  casoActivo = id;
  document.querySelectorAll("#demos-tabs .vista-tab").forEach((b) => b.classList.toggle("is-active", b.dataset.caso === id));
  const caso = CASOS.find((c) => c.id === id);
  await cargarCaso(caso);
}

export async function render() {
  if (!inicializado) {
    inicializado = true;
    const { aspectos } = await api.get("/aspectos");
    etiquetaAspecto = Object.fromEntries(aspectos.map((a) => [a.key, a.label]));

    el("demos-tabs").innerHTML = CASOS.map(
      (c, i) => `<button type="button" class="vista-tab${i === 0 ? " is-active" : ""}" data-caso="${c.id}">${c.etiqueta}</button>`,
    ).join("");
    el("demos-tabs").addEventListener("click", (ev) => {
      const boton = ev.target.closest(".vista-tab");
      if (boton) cambiarCaso(boton.dataset.caso);
    });
  }
  await cambiarCaso(casoActivo ?? CASOS[0].id);
}
