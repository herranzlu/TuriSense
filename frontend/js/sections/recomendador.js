import { api } from "../api.js";
import { el, llenarSelect, fmtPct, fmtNum, conCarga } from "../utils.js";

let inicializado = false;
let ultimasPreferencias = null;
let topNActual = 15;
const PASO_VER_MAS = 15;
const TOP_N_MAXIMO = 200;

// Dos aspectos se prestan a confusión si se leen como si fueran un filtro físico
// (kilómetros, euros) en vez de lo que de verdad son: qué tan bien habla la gente de
// eso en sus reseñas. No hay coordenadas ni precio en euros en ningún fichero de
// origen, así que aclararlo aquí es más honesto que dejar que alguien crea que 0.5
// en "Ubicación" significa "a 5 km de mi casa".
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

async function poblarFiltros() {
  const [filtros, aspectos] = await Promise.all([api.get("/recomendar/filtros"), api.get("/aspectos")]);

  llenarSelect(el("rec-territorio"), filtros.territorios);
  el("rec-territorio").insertAdjacentHTML("afterbegin", `<option value="todas" selected>Toda España</option>`);

  // Ciudades agrupadas por CCAA (con <optgroup>): son más de 300, una lista plana
  // sería inmanejable. No hay coordenadas para filtrar por "cerca de mí" de verdad,
  // así que la ciudad es el proxy más honesto que permiten los datos.
  const porCcaa = {};
  for (const c of filtros.ciudades) (porCcaa[c.ccaa] ??= []).push(c);
  el("rec-ciudad").innerHTML =
    `<option value="todas" selected>Cualquiera</option>` +
    Object.entries(porCcaa)
      .map(
        ([ccaa, ciudades]) =>
          `<optgroup label="${ccaa}">${ciudades.map((c) => `<option value="${c.ciudad}">${c.ciudad} (${fmtNum(c.n_lugares)})</option>`).join("")}</optgroup>`,
      )
      .join("");

  llenarSelect(
    el("rec-tipo"),
    filtros.tipos_experiencia.map((t) => ({ valor: t.valor, etiqueta: `${t.etiqueta} (${fmtNum(t.n_lugares)})` })),
    { valor: "valor", etiqueta: "etiqueta" },
  );
  el("rec-tipo").insertAdjacentHTML("afterbegin", `<option value="todas" selected>Cualquiera</option>`);

  // Sin tocar ningún slider, el motor ordena por satisfacción general (igual que el
  // motor real cuando no recibe ninguna preferencia de aspecto).
  const contenedor = el("rec-aspectos");
  contenedor.innerHTML = aspectos.aspectos
    .filter((a) => a.key !== ASPECTO_OCULTO_EN_RECOMENDADOR)
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

// Con nombre real (hoteles, restauración, ocio: todo lo que no viene de Airbnb),
// buscar "nombre + ciudad" en Google Maps lleva casi siempre directo al sitio exacto,
// sin necesitar coordenadas (no hay ninguna en los datos de origen). Sin nombre real
// (Airbnb no lo cede como dato reutilizable), la búsqueda por tipo + ciudad sigue
// siendo lo más concreto que se puede ofrecer sin fabricar una dirección falsa.
function enlaceGoogleMaps(l) {
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
  const textoMaps = l.nombre ? "📍 Ir a este sitio en Google Maps" : "📍 Buscar en Google Maps";
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
      <button type="button" class="link-btn lugar-toggle-codigo" data-entity-id="${l.entity_id}">Ver código de referencia</button>
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

  // El código de referencia (entity_id) no se muestra de primeras, solo si se pincha,
  // igual que se decidió para "informarse más" sin ensuciar la tarjeta con un hash.
  el("rec-resultados").addEventListener("click", (ev) => {
    const boton = ev.target.closest(".lugar-toggle-codigo");
    if (!boton) return;
    const codigo = boton.nextElementSibling;
    codigo.hidden = !codigo.hidden;
    if (!codigo.hidden) {
      codigo.textContent = `Código de referencia interno: ${boton.dataset.entityId}`;
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
