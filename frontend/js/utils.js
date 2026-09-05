// Utilidades compartidas por todas las secciones: formato, badges de evidencia,
// y la fábrica del mapa choropleth de Leaflet (usado en la sección 4 y reutilizable
// en cualquier otra que necesite pintar un valor por CCAA).

export const fmtPct = (x, decimales = 0) => (x === null || x === undefined ? "N/D" : `${(x * 100).toFixed(decimales)}%`);
export const fmtNum = (x) => (x === null || x === undefined ? "N/D" : new Intl.NumberFormat("es-ES").format(x));

export function badgeEvidencia(esSolida, textoSolida = "evidencia sólida", textoFina = "poca evidencia") {
  const cls = esSolida ? "badge-solid" : "badge-thin";
  const texto = esSolida ? textoSolida : textoFina;
  return `<span class="badge ${cls}">${texto}</span>`;
}

export function el(id) {
  return document.getElementById(id);
}

// --- Indicador de carga global ----------------------------------------------------------
// Una barra fina arriba del todo, visible en cualquier pestaña mientras haya al menos
// una petición en curso (contador, no booleano: si dos llamadas se solapan, la barra no
// desaparece hasta que termina la última). Cualquier fetch que tarde debe pasar por aquí.
let peticionesEnCurso = 0;

export function mostrarCargando() {
  peticionesEnCurso++;
  el("barra-carga")?.classList.add("activa");
}

export function ocultarCargando() {
  peticionesEnCurso = Math.max(0, peticionesEnCurso - 1);
  if (peticionesEnCurso === 0) el("barra-carga")?.classList.remove("activa");
}

// Envuelve una función async cualquiera para que muestre/oculte la barra automáticamente,
// incluso si la función lanza un error (el finally se ejecuta igual).
export async function conCarga(promesa) {
  mostrarCargando();
  try {
    return await promesa;
  } finally {
    ocultarCargando();
  }
}

export function llenarSelect(select, opciones, { valor = "value", etiqueta = "label", placeholder } = {}) {
  select.innerHTML = "";
  if (placeholder) {
    const op = document.createElement("option");
    op.value = "";
    op.textContent = placeholder;
    select.appendChild(op);
  }
  for (const o of opciones) {
    const op = document.createElement("option");
    op.value = typeof o === "string" ? o : o[valor];
    op.textContent = typeof o === "string" ? o : o[etiqueta];
    select.appendChild(op);
  }
}

// --- interpolación de color para el choropleth (lienzo -> rojo primario, en RGB) ---
function hexA(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function interpolarColor(hexBajo, hexAlto, t) {
  const a = hexA(hexBajo);
  const b = hexA(hexAlto);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * Math.max(0, Math.min(1, t))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// Degradado dentro de la familia del verde TUI para barras de ranking: estas barras
// miden "% positivo" (no quejas), así que un degradado de rojo daba a entender que
// se estaba hablando de algo negativo. El valor más bajo (peor dentro del conjunto)
// sale en un verde apagado; el más alto (mejor) en un verde TUI intenso: más
// saturado = más positivo, en vez de "más rojo = más alarma".
const VERDE_APAGADO = "#8CA35B";
const VERDE_INTENSO = "#3D5200";
export function degradadoPositivoPorValor(valores) {
  const numeros = valores.filter((v) => v !== null && v !== undefined);
  const min = numeros.length ? Math.min(...numeros) : 0;
  const max = numeros.length ? Math.max(...numeros) : 1;
  return valores.map((v) => {
    if (v === null || v === undefined) return null;
    const t = max > min ? (v - min) / (max - min) : 0.5;
    return interpolarColor(VERDE_APAGADO, VERDE_INTENSO, t);
  });
}

// Rango de eje ajustado a los datos reales, no fijo 0-100: si todo cae entre 80 y 95,
// un eje 0-100 aplana las barras y no deja ver las diferencias entre CCAA. Redondea a
// múltiplos de `paso` con un margen de un paso a cada lado, sin salirse de [0,100].
export function rangoAjustado(valores, { paso = 5, minAbsoluto = 0, maxAbsoluto = 100 } = {}) {
  const numeros = valores.filter((v) => v !== null && v !== undefined);
  if (!numeros.length) return { min: minAbsoluto, max: maxAbsoluto };
  const minDato = Math.min(...numeros);
  const maxDato = Math.max(...numeros);
  const min = Math.max(minAbsoluto, Math.floor((minDato - paso) / paso) * paso);
  const max = Math.min(maxAbsoluto, Math.ceil((maxDato + paso) / paso) * paso);
  return { min, max };
}

let geojsonCache = null;
async function cargarGeojson() {
  if (!geojsonCache) {
    const res = await fetch("data/ccaa.geojson");
    geojsonCache = await res.json();
  }
  return geojsonCache;
}

function estiloPorValor(feature, valores, opts) {
  const nombre = feature.properties.name;
  let color;
  if (opts.coloresDirectos) {
    // Modo categórico: un color fijo por CCAA (p.ej. la acción sugerida), sin degradado.
    color = opts.coloresDirectos[nombre] ?? opts.sinDato;
  } else {
    const v = valores[nombre];
    color = v === null || v === undefined ? opts.sinDato : interpolarColor(opts.colorBajo, opts.colorAlto, opts.max > opts.min ? (v - opts.min) / (opts.max - opts.min) : 0.5);
  }
  // Borde en gris claro, no blanco: con el mapa ahora sobre fondo blanco, un borde
  // blanco se fundiría con el fondo y las CCAA perderían su silueta.
  return { fillColor: color, fillOpacity: 1, color: "#D7D2C3", weight: 1.5 };
}

/**
 * Crea (si hace falta) un mapa Leaflet en `containerId` y devuelve una función
 * `pintar(valores, opts)` para colorear las CCAA. `valores` es un objeto
 * { [nombreGeojson]: numero|null }.
 *
 * Canarias se pinta aparte, en un recuadro-inset fijo (como en los mapas
 * oficiales del INE): a la escala de España peninsular, el archipiélago queda
 * a miles de km y se reduce a unos pocos píxeles casi invisibles.
 */
export async function crearMapaCoropletico(containerId) {
  const geojson = await cargarGeojson();
  const geoCanarias = { type: "FeatureCollection", features: geojson.features.filter((f) => f.properties.name === "Canarias") };
  const geoResto = { type: "FeatureCollection", features: geojson.features.filter((f) => f.properties.name !== "Canarias") };

  const contenedor = el(containerId);
  contenedor.innerHTML = "";
  contenedor.style.position = "relative";

  const divPrincipal = document.createElement("div");
  divPrincipal.style.cssText = "position:absolute; inset:0;";
  contenedor.appendChild(divPrincipal);

  const divInset = document.createElement("div");
  divInset.className = "mapa-inset";
  divInset.innerHTML = `<span class="mapa-inset-label">Canarias</span><div class="mapa-inset-mapa"></div>`;
  contenedor.appendChild(divInset);

  // Sin mapa de calles de fondo, a propósito: solo las siluetas de las CCAA sobre
  // un fondo plano, como una ilustración, sin nombres de países ni carreteras
  // alrededor tirando de la atención.
  const OPCIONES_ESTATICAS = {
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    touchZoom: false,
    keyboard: false,
  };

  const mapa = L.map(divPrincipal, OPCIONES_ESTATICAS);
  const mapaInset = L.map(divInset.querySelector(".mapa-inset-mapa"), OPCIONES_ESTATICAS);

  let capa, capaInset;
  let capasPorNombre = {}; // nombre (geojson) -> layer, para poder resaltar una CCAA concreta desde fuera

  function pintar(valores, { min, max, colorBajo = "#F3F0EC", colorAlto = "#D40E14", tooltip, sinDato = "#E7E2DB", coloresDirectos, onClick } = {}) {
    const nums = Object.values(valores).filter((v) => v !== null && v !== undefined);
    const opts = coloresDirectos
      ? { coloresDirectos, sinDato }
      : { min: min ?? Math.min(...nums), max: max ?? Math.max(...nums), colorBajo, colorAlto, sinDato };
    capasPorNombre = {};
    const onEachFeature = (feature, layer) => {
      const nombre = feature.properties.name;
      capasPorNombre[nombre] = layer;
      const v = valores[nombre];
      const texto = tooltip ? tooltip(nombre, v) : `${nombre}: ${v ?? "sin dato"}`;
      layer.bindTooltip(texto, { sticky: true });
      if (onClick) layer.on("click", () => onClick(nombre));
    };

    if (capa) mapa.removeLayer(capa);
    capa = L.geoJSON(geoResto, { style: (f) => estiloPorValor(f, valores, opts), onEachFeature }).addTo(mapa);
    mapa.fitBounds(capa.getBounds(), { padding: [10, 10] });

    if (capaInset) mapaInset.removeLayer(capaInset);
    capaInset = L.geoJSON(geoCanarias, { style: (f) => estiloPorValor(f, valores, opts), onEachFeature }).addTo(mapaInset);
    mapaInset.fitBounds(capaInset.getBounds(), { padding: [4, 4] });
  }

  // Resalta una única CCAA (borde grueso oscuro) y devuelve el resto a su estilo normal;
  // sin argumento (o nombre inexistente) simplemente quita cualquier resaltado activo.
  function resaltar(nombreGeojson) {
    Object.entries(capasPorNombre).forEach(([nombre, layer]) => {
      const grupo = nombre === "Canarias" ? capaInset : capa;
      grupo.resetStyle(layer);
    });
    const objetivo = capasPorNombre[nombreGeojson];
    if (objetivo) {
      objetivo.setStyle({ weight: 4, color: "#14181C" });
      objetivo.bringToFront();
    }
  }

  return { mapa, pintar, resaltar };
}
