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

// Área aproximada de un anillo (fórmula del cordón/shoelace, en grados²): no hace
// falta más precisión que comparar dos anillos de la misma feature entre sí.
function _areaAnillo(anillo) {
  let area = 0;
  for (let i = 0; i < anillo.length; i++) {
    const [x1, y1] = anillo[i];
    const [x2, y2] = anillo[(i + 1) % anillo.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

// El geojson de Ceuta trae, además de su núcleo urbano, dos islotes de soberanía
// española administrados junto a ella (Isla del Perejil y Peñón de Vélez de la
// Gomera), a varios km de distancia y sin apenas superficie. A la escala de un
// mapa de toda España se ven como un punto suelto y aislado del resto de la
// silueta: de un vistazo se puede leer como "Ceuta aparece dos veces". No se
// borra nada del fichero de origen: solo, para ESTA silueta del mapa, nos
// quedamos con el polígono de mayor superficie real (el núcleo urbano).
function _simplificarCeuta(feature) {
  if (feature.properties.name !== "Ceuta" || feature.geometry.type !== "MultiPolygon") return feature;
  const principal = feature.geometry.coordinates.reduce((mayor, poligono) => (_areaAnillo(poligono[0]) > _areaAnillo(mayor[0]) ? poligono : mayor));
  return { ...feature, geometry: { type: "Polygon", coordinates: principal } };
}

let geojsonCache = null;
async function cargarGeojson() {
  if (!geojsonCache) {
    const res = await fetch("data/ccaa.geojson");
    const data = await res.json();
    data.features = data.features.map(_simplificarCeuta);
    geojsonCache = data;
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

// Abre el tooltip de `layer` en el lado con más espacio libre dentro de SU PROPIO
// mapa (el principal o cualquiera de los recuadros-inset -Canarias, Ceuta,
// Melilla-, cada uno con su propio tamaño): compara el margen a los 4 bordes desde
// el centro de la forma y abre hacia el eje/lado con más margen, así el cuadro se
// aleja siempre del borde más cercano en vez de salirse por él. Se recalcula en
// cada apertura (no una vez al cargar) porque en ese momento el mapa aún no tiene
// su tamaño final ajustado.
function abrirTooltipConDireccion(layer, texto) {
  const mapa = layer._map;
  if (!mapa) return;
  const recuadroInset = mapa.getContainer().closest(".mapa-inset");
  const tam = mapa.getSize();
  let anclaEn, direccion, claseExtra;

  if (recuadroInset) {
    // Todos los recuadros-inset son tan pequeños, y están tan pegados a una esquina
    // inferior del mapa grande, que calcular la dirección con el margen DE ESE
    // RECUADRO no sirve: en cuanto el tooltip escapa de él (ver más abajo), lo que
    // de verdad importa es el margen dentro del MAPA GRANDE, no dentro de la
    // cajita. "Arriba" siempre aleja del borde inferior (el único pegado en
    // cualquiera de los recuadros); para el lado horizontal, cada recuadro declara
    // en su propio marcado (data-ancla) el borde de sí mismo contrario a la esquina
    // del mapa grande a la que está pegado (Canarias, a la izquierda, ancla a la
    // derecha; Ceuta y Melilla, a la derecha, anclan a la izquierda), así el
    // tooltip siempre se abre hacia el centro del mapa, con sitio de sobra.
    const x = recuadroInset.dataset.ancla === "left" ? 0 : tam.x;
    anclaEn = mapa.containerPointToLatLng([x, tam.y / 2]);
    direccion = "top";
    claseExtra = " tooltip-ccaa-inset";
  } else {
    const centro = mapa.latLngToContainerPoint(layer.getBounds ? layer.getBounds().getCenter() : layer.getLatLng());
    const espacio = { left: centro.x, right: tam.x - centro.x, top: centro.y, bottom: tam.y - centro.y };
    direccion = Object.entries(espacio).sort((a, b) => b[1] - a[1])[0][0];
    anclaEn = null; // se abre en su propio punto, sin forzar ancla
    claseExtra = "";
  }

  layer.unbindTooltip();
  layer.bindTooltip(texto, { direction: direccion, sticky: false, opacity: 0.97, className: `tooltip-ccaa${claseExtra}` });
  if (anclaEn) layer.openTooltip(anclaEn);
  else layer.openTooltip();

  // El recuadro de Canarias recorta su contenido en reposo, para que sus esquinas
  // redondeadas no dejen ver el cuadrado del mapa interior; mientras el tooltip esté
  // abierto se permite que sobresalga (si no, por pequeño que sea el recuadro, el
  // tooltip siempre quedaría cortado), y se recorta de nuevo en cuanto se cierra.
  if (recuadroInset) {
    recuadroInset.classList.add("mapa-inset-con-tooltip");
    layer.once("tooltipclose", () => recuadroInset.classList.remove("mapa-inset-con-tooltip"));
  }

  // Corrección final, después de pintar: todo lo de arriba elige la dirección según
  // el tamaño DEL MAPA, pero si la página está desplazada (scroll) de forma que el
  // mapa queda pegado arriba de lo que se ve en pantalla, "abrir hacia arriba" se
  // sale igualmente por el borde real de la ventana, aunque dentro del mapa hubiera
  // sitio de sobra. Aquí se mide la posición real en pantalla del tooltip ya
  // pintado y, si se sale por cualquier lado de la ventana visible, se empuja hacia
  // dentro con un pequeño margen. El mapa no hace pan ni zoom (está fijo), así que
  // esta corrección no se deshace sola después de aplicarla.
  requestAnimationFrame(() => {
    const tip = layer.getTooltip?.();
    const elTip = tip?.getElement?.();
    if (!elTip) return;
    const MARGEN = 8;
    const r = elTip.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (r.left < MARGEN) dx = MARGEN - r.left;
    else if (r.right > window.innerWidth - MARGEN) dx = window.innerWidth - MARGEN - r.right;
    if (r.top < MARGEN) dy = MARGEN - r.top;
    else if (r.bottom > window.innerHeight - MARGEN) dy = window.innerHeight - MARGEN - r.bottom;
    if (dx || dy) elTip.style.transform += ` translate(${dx}px, ${dy}px)`;
  });
}

// Canarias, Ceuta y Melilla se pintan aparte, cada una en su propio recuadro-inset
// fijo (como en los mapas oficiales del INE): a la escala de España peninsular,
// Canarias queda a miles de km y Ceuta/Melilla miden apenas ~10km de lado, así que
// las tres se reducen a un puñado de píxeles (Ceuta y Melilla, literalmente 2-3px:
// ahí es donde Melilla "no aparecía" en el mapa) y quedan invisibles e imposibles
// de pinchar dentro del mapa grande. Cada recuadro usa la MISMA silueta del geojson
// que ya usa el resto del mapa (nunca una geometría artificial ni un duplicado: se
// excluyen del mapa grande para que cada una se vea en un único sitio).
const DEFINICION_INSETS = [
  { nombre: "Canarias", clase: "mapa-inset-canarias", ancla: "right", padding: [4, 4], enGrupo: null },
  { nombre: "Ceuta", clase: "mapa-inset-pequeno", ancla: "left", padding: [6, 6], enGrupo: "sur" },
  { nombre: "Melilla", clase: "mapa-inset-pequeno", ancla: "left", padding: [6, 6], enGrupo: "sur" },
];
const NOMBRES_INSET = DEFINICION_INSETS.map((d) => d.nombre);

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

/**
 * Crea (si hace falta) un mapa Leaflet en `containerId` y devuelve una función
 * `pintar(valores, opts)` para colorear las CCAA. `valores` es un objeto
 * { [nombreGeojson]: numero|null }.
 */
export async function crearMapaCoropletico(containerId) {
  const geojson = await cargarGeojson();
  const geoDe = (nombre) => ({ type: "FeatureCollection", features: geojson.features.filter((f) => f.properties.name === nombre) });
  const geoResto = { type: "FeatureCollection", features: geojson.features.filter((f) => !NOMBRES_INSET.includes(f.properties.name)) };

  const contenedor = el(containerId);
  contenedor.innerHTML = "";
  contenedor.style.position = "relative";

  const divPrincipal = document.createElement("div");
  divPrincipal.style.cssText = "position:absolute; inset:0;";
  contenedor.appendChild(divPrincipal);

  const divSur = document.createElement("div");
  divSur.className = "mapa-insets-sur";
  contenedor.appendChild(divSur);

  const mapa = L.map(divPrincipal, OPCIONES_ESTATICAS);
  let capa;
  let capasPorNombre = {}; // nombre (geojson) -> layer, para poder resaltar una CCAA concreta desde fuera

  // insets: nombre (geojson) -> { def, geo, mapa: instancia Leaflet propia, capa }
  const insets = {};
  for (const def of DEFINICION_INSETS) {
    const div = document.createElement("div");
    div.className = `mapa-inset ${def.clase}`;
    div.dataset.ancla = def.ancla;
    div.innerHTML = `<span class="mapa-inset-label">${def.nombre}</span><div class="mapa-inset-mapa"></div>`;
    (def.enGrupo === "sur" ? divSur : contenedor).appendChild(div);
    insets[def.nombre] = { def, geo: geoDe(def.nombre), mapa: L.map(div.querySelector(".mapa-inset-mapa"), OPCIONES_ESTATICAS), capa: null };
  }

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
      // "sticky" (seguir al ratón) es lo primero que revienta con formas diminutas
      // o dentro de un recuadro pequeño: el cursor casi siempre está pegado a un
      // borde, así que el tooltip se sale por ese mismo borde. En su lugar, se abre
      // anclado al centro de la propia forma y se elige, en cada apertura, hacia
      // qué lado hay más sitio dentro del mapa: siempre se abre alejándose del
      // borde más cercano, nunca hacia él.
      layer.on("mouseover click", () => abrirTooltipConDireccion(layer, texto));
      if (onClick) layer.on("click", () => onClick(nombre));
    };

    if (capa) mapa.removeLayer(capa);
    capa = L.geoJSON(geoResto, { style: (f) => estiloPorValor(f, valores, opts), onEachFeature }).addTo(mapa);
    mapa.fitBounds(capa.getBounds(), { padding: [10, 10] });

    for (const inset of Object.values(insets)) {
      if (inset.capa) inset.mapa.removeLayer(inset.capa);
      inset.capa = L.geoJSON(inset.geo, { style: (f) => estiloPorValor(f, valores, opts), onEachFeature }).addTo(inset.mapa);
      inset.mapa.fitBounds(inset.capa.getBounds(), { padding: inset.def.padding });
    }
  }

  // Resalta una única CCAA (borde grueso oscuro) y devuelve el resto a su estilo normal;
  // sin argumento (o nombre inexistente) simplemente quita cualquier resaltado activo.
  function resaltar(nombreGeojson) {
    Object.entries(capasPorNombre).forEach(([nombre, layer]) => {
      const grupo = insets[nombre] ? insets[nombre].capa : capa;
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
