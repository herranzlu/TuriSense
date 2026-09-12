import { api } from "../api.js";
import { el, llenarSelect, fmtPct, fmtNum, conCarga } from "../utils.js";

let inicializado = false;
let ultimasPreferencias = null;
let topNActual = 15;
const PASO_VER_MAS = 15;
const TOP_N_MAXIMO = 200;

// Ciudades agrupadas por CCAA, tal como las devuelve /recomendar/filtros: se guardan
// aquí (en vez de releer el DOM) para poder reconstruir el selector de Ciudad cada vez
// que cambia el de Territorio, sin otra llamada al backend.
let ciudadesPorCcaa = {};
// aspectos: la lista completa de los 11 (para poder pintar cada slider una sola vez).
// aspectosPorTipo: qué claves de esas mostrar según el tipo_experiencia elegido (ver
// config.ASPECTOS_POR_TIPO_EXPERIENCIA en el backend: una sola fuente de verdad, no
// una copia de la lista mantenida aparte en el frontend).
let aspectosTodos = [];
let aspectosPorTipo = {};

// Dos aspectos se prestan a confusión si se leen como si fueran un filtro físico
// (kilómetros, euros) en vez de lo que de verdad son: qué tan bien habla la gente de
// eso en sus reseñas. Aunque ahora hay coordenadas reales por entity_id (ver
// entity_id_ubicacion_precisa.csv), no se usan como filtro de distancia ni el
// perfil trae un precio en euros, así que aclararlo aquí sigue siendo más honesto
// que dejar que alguien crea que 0.5 en "Ubicación" significa "a 5 km de mi casa".
const ACLARACION_ASPECTO = {
  ubicacion: "valoración de la zona en las reseñas, no distancia en km",
  precio: "valoración de la relación calidad-precio, no un importe en euros",
};

// "Masificación" ya tiene su propio control, específico y con semántica clara
// ("Evitar masificaciones", más abajo): mantenerla también aquí como un aspecto
// genérico más era redundante y, además, confuso (esta columna mide sentimiento
// positivo sobre las pocas reseñas que mencionan masificación explícitamente, no
// "cuánto evitar" el destino). No se toca /api/aspectos ni config.ASPECTOS: esa
// lista la siguen usando tal cual el mapa de calor, el ranking y la ficha de destino.
const ASPECTO_OCULTO_EN_RECOMENDADOR = "masificacion";

// Reconstruye el selector de Ciudad a partir de ciudadesPorCcaa, respetando el
// territorio actualmente elegido: "todas" muestra todas las ciudades agrupadas por
// CCAA (con <optgroup>, son más de 300: una lista plana sería inmanejable); una CCAA
// concreta muestra solo sus ciudades, sin agrupar (agrupar por una sola CCAA no
// aporta nada). Si la ciudad que estaba seleccionada ya no pertenece al territorio
// elegido, se resetea a "Cualquiera" en vez de dejar un filtro imposible aplicado sin
// que se note en el desplegable.
function actualizarCiudadesPorTerritorio() {
  const territorio = el("rec-territorio").value;
  const ciudadPrevia = el("rec-ciudad").value;

  const opciones =
    territorio === "todas"
      ? Object.entries(ciudadesPorCcaa)
          .map(
            ([ccaa, ciudades]) =>
              `<optgroup label="${ccaa}">${ciudades.map((c) => `<option value="${c.ciudad}">${c.ciudad} (${fmtNum(c.n_lugares)})</option>`).join("")}</optgroup>`,
          )
          .join("")
      : (ciudadesPorCcaa[territorio] ?? []).map((c) => `<option value="${c.ciudad}">${c.ciudad} (${fmtNum(c.n_lugares)})</option>`).join("");

  el("rec-ciudad").innerHTML = `<option value="todas">Cualquiera</option>${opciones}`;

  const sigueDisponible = territorio === "todas" || (ciudadesPorCcaa[territorio] ?? []).some((c) => c.ciudad === ciudadPrevia);
  el("rec-ciudad").value = sigueDisponible ? ciudadPrevia : "todas";
}

// Todos los sliders se pintan una sola vez (siempre en el DOM, con su peso guardado):
// cambiar de tipo de experiencia solo oculta los que no aplican, nunca los destruye,
// así no se pierde lo que el usuario ya había ajustado si vuelve a un tipo anterior.
// Los aspectos ocultos, además, se ponen a 0: así la barra de progreso y el número
// que se ven en pantalla nunca mienten sobre lo que de verdad se va a usar (el
// backend, aparte, ya los ignora siempre pase lo que pase en el frontend: ver
// pesos_validados en schemas.py).
function actualizarAspectosVisibles() {
  const tipo = el("rec-tipo").value;
  const aplicables = new Set(aspectosPorTipo[tipo] ?? aspectosPorTipo.todas ?? aspectosTodos.map((a) => a.key));
  el("rec-aspectos").querySelectorAll(".aspecto-slider").forEach((div) => {
    const input = div.querySelector(".peso-aspecto");
    const visible = aplicables.has(input.dataset.aspecto);
    div.hidden = !visible;
    if (!visible && input.value !== "0") {
      input.value = "0";
      el(`val-${input.dataset.aspecto}`).textContent = "0.0";
    }
  });
}

async function poblarFiltros() {
  const [filtros, aspectos] = await Promise.all([api.get("/recomendar/filtros"), api.get("/aspectos")]);

  llenarSelect(el("rec-territorio"), filtros.territorios);
  el("rec-territorio").insertAdjacentHTML("afterbegin", `<option value="todas" selected>Toda España</option>`);

  // El filtro sigue siendo por ciudad, no por cercanía a un punto exacto (eso sería
  // una función nueva de "buscar cerca de mí", no solo mostrar la coordenada ya
  // disponible); la ciudad sigue siendo el filtro real de esta pantalla.
  ciudadesPorCcaa = {};
  for (const c of filtros.ciudades) (ciudadesPorCcaa[c.ccaa] ??= []).push(c);
  actualizarCiudadesPorTerritorio();

  llenarSelect(
    el("rec-tipo"),
    filtros.tipos_experiencia.map((t) => ({ valor: t.valor, etiqueta: `${t.etiqueta} (${fmtNum(t.n_lugares)})` })),
    { valor: "valor", etiqueta: "etiqueta" },
  );
  el("rec-tipo").insertAdjacentHTML("afterbegin", `<option value="todas" selected>Cualquiera</option>`);

  // aspectos_por_tipo viene del backend (config.ASPECTOS_POR_TIPO_EXPERIENCIA): una
  // sola fuente de verdad para qué aspectos aplican a cada tipo, en vez de mantener
  // aquí una copia que se pueda desincronizar del cálculo real.
  aspectosTodos = aspectos.aspectos.filter((a) => a.key !== ASPECTO_OCULTO_EN_RECOMENDADOR);
  aspectosPorTipo = filtros.aspectos_por_tipo ?? {};

  // Sin tocar ningún slider, el motor ordena por satisfacción general (igual que el
  // motor real cuando no recibe ninguna preferencia de aspecto).
  const contenedor = el("rec-aspectos");
  contenedor.innerHTML = aspectosTodos
    .map((a) => {
      const aclaracion = ACLARACION_ASPECTO[a.key] ? `<span class="muted" style="display:block;font-size:.7rem">${ACLARACION_ASPECTO[a.key]}</span>` : "";
      return `
      <div class="aspecto-slider">
        <span>${a.label}${aclaracion}</span>
        <span class="muted" id="val-${a.key}">0.0</span>
        <input type="range" min="0" max="1" step="0.1" value="0" data-aspecto="${a.key}" class="peso-aspecto" />
      </div>`;
    })
    .join("");

  contenedor.querySelectorAll(".peso-aspecto").forEach((input) => {
    input.addEventListener("input", () => {
      el(`val-${input.dataset.aspecto}`).textContent = Number(input.value).toFixed(1);
    });
  });
  actualizarAspectosVisibles();
}

function leerPreferencias(topN) {
  const pesos = {};
  document.querySelectorAll(".peso-aspecto").forEach((input) => {
    pesos[input.dataset.aspecto] = Number(input.value);
  });
  return {
    territorio: el("rec-territorio").value,
    ciudad: el("rec-ciudad").value,
    tipo_experiencia: el("rec-tipo").value,
    pesos_aspectos: pesos,
    peso_anti_masificacion: Number(el("rec-antimasif").value),
    top_n: topN,
  };
}

// Con ubicación precisa (data/entity_id_ubicacion_precisa.csv, cruzada por entity_id
// en el backend: ver _con_ubicacion_precisa en recomendador.py), el enlace apunta a
// la coordenada exacta de la fuente original, no a un centroide. Sin ella (2,3% de
// los lugares, o cuando tampoco hay nombre real), "nombre + ciudad" o "tipo + ciudad"
// sigue siendo lo más concreto que se puede ofrecer sin fabricar una ubicación.
function tieneUbicacionPrecisa(l) {
  return l.latitud !== null && l.latitud !== undefined && l.longitud !== null && l.longitud !== undefined;
}

function enlaceGoogleMaps(l) {
  if (tieneUbicacionPrecisa(l)) {
    return `https://www.google.com/maps/search/?api=1&query=${l.latitud}%2C${l.longitud}`;
  }
  const lugar = l.ciudad ?? l.ccaa;
  const consulta = l.nombre ? `${l.nombre}, ${lugar}` : `${l.tipo_alojamiento} en ${lugar}, ${l.ccaa}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(consulta)}`;
}

function tarjetaLugar(l) {
  const lugar = l.ciudad ?? l.ccaa;
  const aprox = l.ciudad_es_aproximada ? ` <span class="muted">(zona aprox.)</span>` : "";
  const notaRedistribucion = l.nota_redistribucion ? `<div class="lugar-nota lugar-nota-redistribucion">🔀 ${l.nota_redistribucion}</div>` : "";
  // Con nombre real, ESE es el titular (lo que se busca al decidir); sin él, la
  // ciudad sigue siendo lo más concreto que hay, como hasta ahora.
  const titulo = l.nombre ?? `${lugar}${aprox}`;
  const subtitulo = l.nombre ? `${lugar}${aprox} · ${l.tipo_alojamiento} · ${l.ccaa}` : `${l.tipo_alojamiento} · ${l.ccaa}`;
  const conUbicacion = tieneUbicacionPrecisa(l);
  const textoMaps = conUbicacion ? "📍 Ver ubicación exacta en Google Maps" : l.nombre ? "📍 Ir a este sitio en Google Maps" : "📍 Buscar en Google Maps";
  // La trazabilidad (entity_id + ubicación, si la hay) siempre está en la tarjeta,
  // solo que oculta detrás del mismo botón que ya se usaba para el código interno.
  const detalleUbicacion = conUbicacion
    ? `Ubicación: ${l.latitud}, ${l.longitud} (fuente: ${l.fuente_ubicacion})`
    : "Ubicación precisa: no disponible para este entity_id.";
  return `
    <div class="lugar-card">
      <div class="lugar-card-cabecera">
        <div>
          <div class="lugar-titulo">${titulo}</div>
          <div class="lugar-subtitulo">${subtitulo}</div>
        </div>
        <div class="lugar-match-badge">${fmtPct(l.match_score)} coincide con tu búsqueda</div>
      </div>
      <div class="lugar-stats-linea"><strong>${fmtNum(l.n_resenas)}</strong> reseñas · <strong>${fmtPct(l.pct_positivo_general)}</strong> positivas</div>
      <div class="lugar-nota">💬 ${l.por_que}</div>
      ${notaRedistribucion}
      <a class="lugar-cta-maps" href="${enlaceGoogleMaps(l)}" target="_blank" rel="noopener">${textoMaps}</a>
      <button type="button" class="link-btn lugar-toggle-codigo" data-entity-id="${l.entity_id}" data-detalle-ubicacion="${detalleUbicacion}">Ver código de referencia</button>
      <div class="lugar-codigo muted" hidden></div>
    </div>`;
}

function pintarResultados(data, prefs) {
  ultimasPreferencias = prefs;
  const hayMas = data.lugares.length < data.n_candidatos && topNActual < TOP_N_MAXIMO;

  el("rec-meta").textContent = `${fmtNum(data.n_candidatos)} lugares encajan con ese filtro. Mostrando los ${data.lugares.length} mejores.`;
  el("rec-resultados").innerHTML =
    data.lugares.map(tarjetaLugar).join("") ||
    `<p class="muted">No hay lugares con datos suficientes para este filtro. Prueba a ampliar la búsqueda.</p>`;

  if (hayMas) {
    const restantes = Math.min(PASO_VER_MAS, TOP_N_MAXIMO - topNActual, data.n_candidatos - data.lugares.length);
    el("rec-ver-mas").textContent = `Ver ${restantes} más`;
  }
  el("rec-ver-mas").hidden = !hayMas;
}

// Un 404 crudo ("no hay lugares para ese territorio/ciudad/tipo") no le dice nada a
// quien no es programador. Se traduce a un aviso humano, en el propio modal que ya
// usa el resto de la app, con una sugerencia concreta de qué cambiar.
function mostrarAvisoSinResultados() {
  el("modal-detalle-contenido").innerHTML = `
    <h2>Sin resultados para esa combinación</h2>
    <div class="rec-mensaje-vacio">
      <span class="icono">🔍</span>
      <p>No hay ningún lugar que cumpla a la vez el territorio, la ciudad y el tipo de experiencia elegidos.</p>
      <p class="muted">Prueba a quitar la ciudad, elegir "Toda España" en territorio, o cambiar el tipo de experiencia.</p>
    </div>`;
  el("modal-detalle").hidden = false;
  el("rec-meta").textContent = "Sin resultados: ajusta los filtros e inténtalo de nuevo.";
  el("rec-resultados").innerHTML = "";
  el("rec-ver-mas").hidden = true;
}

async function buscar(ev) {
  if (ev) ev.preventDefault();
  topNActual = 15;
  el("rec-meta").textContent = "Buscando…";
  el("rec-ver-mas").hidden = true;
  const prefs = leerPreferencias(topNActual);
  try {
    const data = await conCarga(api.post("/recomendar", prefs));
    pintarResultados(data, prefs);
  } catch (err) {
    if (err.status === 404) mostrarAvisoSinResultados();
    else el("rec-meta").textContent = `No se pudo completar la búsqueda: ${err.detalle || err.message}`;
  }
}

async function verMas() {
  topNActual = Math.min(TOP_N_MAXIMO, topNActual + PASO_VER_MAS);
  const prefs = { ...ultimasPreferencias, top_n: topNActual };
  try {
    const data = await conCarga(api.post("/recomendar", prefs));
    pintarResultados(data, prefs);
  } catch (err) {
    el("rec-meta").textContent = `No se pudo cargar más resultados: ${err.detalle || err.message}`;
  }
}

export async function render() {
  if (inicializado) return;
  inicializado = true;

  await poblarFiltros();

  // Ciudad depende de Territorio: cambiar de CCAA actualiza al momento las ciudades
  // disponibles (sin recargar la página) y resetea la selección si deja de encajar.
  el("rec-territorio").addEventListener("change", actualizarCiudadesPorTerritorio);
  // Los sliders visibles dependen del tipo de experiencia: ver actualizarAspectosVisibles.
  el("rec-tipo").addEventListener("change", actualizarAspectosVisibles);

  // El código de referencia (entity_id) no se muestra de primeras, solo si se pincha,
  // igual que se decidió para "informarse más" sin ensuciar la tarjeta con un hash.
  el("rec-resultados").addEventListener("click", (ev) => {
    const boton = ev.target.closest(".lugar-toggle-codigo");
    if (!boton) return;
    const codigo = boton.nextElementSibling;
    codigo.hidden = !codigo.hidden;
    if (!codigo.hidden) {
      codigo.innerHTML = `Código de referencia interno: ${boton.dataset.entityId}<br>${boton.dataset.detalleUbicacion}`;
      boton.textContent = "Ocultar código de referencia";
    } else {
      boton.textContent = "Ver código de referencia";
    }
  });

  el("rec-antimasif").addEventListener("input", (ev) => {
    el("rec-antimasif-val").textContent = `${Math.round(Number(ev.target.value) * 100)}%`;
  });
  el("btn-info-antimasif").addEventListener("click", () => {
    el("modal-detalle-contenido").innerHTML = `
      <h2>Evitar masificaciones</h2>
      <p>Cuanto más alto pongas este porcentaje, más penalizamos en los resultados los
      lugares con más reseñas relativas a otros parecidos (nuestra mejor aproximación,
      con los datos disponibles, a mayor afluencia): al 0% no influye en el orden; al
      100%, se prioriza con fuerza a los que reciben menos reseñas en proporción.</p>
      <p class="muted">Un 90% en este control significa que estás pidiendo, con mucha
      fuerza, destinos poco masificados; no es una puntuación del propio lugar.</p>`;
    el("modal-detalle").hidden = false;
  });
  el("form-recomendador").addEventListener("submit", buscar);
  el("rec-ver-mas").addEventListener("click", verMas);

  await buscar();
}
