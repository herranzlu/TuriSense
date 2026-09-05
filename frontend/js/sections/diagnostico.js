import { api } from "../api.js";
import { el, llenarSelect, fmtPct, interpolarColor, degradadoPositivoPorValor, rangoAjustado, conCarga } from "../utils.js";

let chart = null;
let inicializado = false;

// Verde, no rojo: esta tabla es "% positivo" (no quejas), así que un degradado de
// rojo daba a entender que se estaba hablando de algo negativo. Más verde e intenso
// dentro de esa columna = más positivo, comparado solo con las demás CCAA en ese
// mismo aspecto. El extremo apagado sigue siendo bastante oscuro (no un verde pálido)
// porque el texto va siempre en blanco y necesita contraste en toda la escala.
const VERDE_APAGADO = "#6E7F3D";
const VERDE_INTENSO = "#2E4000";

function colorCelda(pct01, min, max) {
  const t = max > min ? (pct01 * 100 - min) / (max - min) : 0.5;
  return interpolarColor(VERDE_APAGADO, VERDE_INTENSO, t);
}

// Escala por columna (aspecto), no una única escala global: aspectos como Ubicación
// rondan siempre el 90%+ en todas las CCAA, y aspectos como Masificación rondan el
// 55-60%: con una sola escala para las 209 celdas, todo Ubicación saldría del mismo
// rojo clarito y no se vería ninguna diferencia real entre CCAA dentro de esa columna.
function rangoPorColumna(matriz, aspectos) {
  const rango = {};
  for (const a of aspectos) {
    const valores = matriz.map((f) => f.aspectos[a.key].pct_positivo).filter((v) => v !== null).map((v) => v * 100);
    rango[a.key] = valores.length ? { min: Math.min(...valores), max: Math.max(...valores) } : { min: 0, max: 100 };
  }
  return rango;
}

async function cargarHeatmap() {
  const data = await conCarga(api.get("/aspectos/matriz"));
  const rango = rangoPorColumna(data.matriz, data.aspectos);

  // La celda [0,0] necesita ser sticky en las dos direcciones a la vez (columna Y fila),
  // si no, al hacer scroll horizontal en móvil los títulos de columna (que no son
  // sticky) se deslizan y acaban pintándose encima de los nombres de CCAA (que sí lo
  // son): sin esta celda de esquina fijándolos a ambos en el mismo punto, se pisan.
  const encabezado = `<tr><th class="heatmap-esquina"></th>${data.aspectos.map((a) => `<th title="${a.label}">${a.label}</th>`).join("")}</tr>`;
  const filas = data.matriz
    .map((fila) => {
      const celdas = data.aspectos
        .map((a) => {
          const c = fila.aspectos[a.key];
          if (c.pct_positivo === null) {
            return `<td class="heatmap-celda-vacia" title="${a.label} en ${fila.ccaa}: sin datos">–</td>`;
          }
          const { min, max } = rango[a.key];
          const bg = colorCelda(c.pct_positivo, min, max);
          const marcaEvidencia = c.evidencia_suficiente ? "" : " ·";
          const attrs = `data-ccaa="${fila.ccaa}" data-aspecto="${a.label}" data-pct="${fmtPct(c.pct_positivo)}" data-menciones="${c.menciones}" data-evidencia="${c.evidencia_suficiente}" data-min="${min.toFixed(0)}" data-max="${max.toFixed(0)}"`;
          return `<td class="heatmap-celda" style="background:${bg};color:#FFFFFF" ${attrs} title="Pincha para ver la explicación">${fmtPct(c.pct_positivo)}${marcaEvidencia}</td>`;
        })
        .join("");
      return `<tr><th class="heatmap-fila-ccaa">${fila.ccaa}</th>${celdas}</tr>`;
    })
    .join("");

  el("tabla-heatmap").innerHTML = encabezado + filas;
}

function abrirInfoHeatmap() {
  el("modal-detalle-contenido").innerHTML = `
    <h2>Cómo leer este mapa de calor</h2>
    <p>Cada columna (aspecto) tiene su propia escala de color, de su peor a su mejor CCAA: si no,
    aspectos que van bien en todas partes (como Ubicación) saldrían siempre del mismo color y no
    se vería ninguna diferencia real.</p>
    <p><strong>Más verde e intenso = mejor</strong> dentro de esa columna, comparado solo con las
    demás CCAA en ese mismo aspecto (nunca entre columnas distintas: todo aquí es "% positivo",
    nunca negativo).</p>
    <p class="muted">Una celda con un punto (·) detrás del porcentaje tiene menos de 5 menciones
    detrás: es poca evidencia, no un error. Pincha cualquier celda para ver su explicación.</p>`;
  el("modal-detalle").hidden = false;
}

async function cargarRanking(ccaa) {
  const qs = ccaa ? `?ccaa=${encodeURIComponent(ccaa)}` : "";
  const data = await conCarga(api.get(`/aspectos/ranking${qs}`));

  const ctx = el("chart-aspectos").getContext("2d");
  const etiquetas = data.aspectos.map((a) => a.etiqueta);
  const valores = data.aspectos.map((a) => (a.pct_positivo !== null ? +(a.pct_positivo * 100).toFixed(1) : null));
  const degradado = degradadoPositivoPorValor(valores);
  const colores = data.aspectos.map((a, i) => (a.evidencia_suficiente ? degradado[i] : "#D7D2C3"));
  const { min, max } = rangoAjustado(valores);

  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: etiquetas,
      datasets: [{ label: "% positivo", data: valores, backgroundColor: colores, borderRadius: 4 }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: { display: true, text: `${data.ccaa} · peor aspecto arriba` },
      },
      scales: { x: { min, max, title: { display: true, text: "% positivo" } } },
    },
  });
}

// Explicación en una frase, redactada para un ejecutivo, no un volcado de datos: solo
// al pinchar (no al pasar el ratón), para no llenar la pantalla de tooltips sin querer.
function abrirExplicacionCelda(celda) {
  const { ccaa, aspecto, pct, menciones, evidencia, min, max } = celda.dataset;
  const avisoEvidencia =
    evidencia === "true"
      ? ""
      : `<p class="muted" style="margin-top:.6rem">Con solo ${menciones} menciones, esta cifra hay que tomarla con cautela: es poca evidencia para sacar una conclusión firme.</p>`;
  el("modal-detalle-contenido").innerHTML = `
    <h2>${ccaa} · ${aspecto}</h2>
    <p>El <strong>${pct}</strong> de las opiniones que mencionan "${aspecto.toLowerCase()}" en ${ccaa} son positivas
    (sobre ${menciones} menciones analizadas).</p>
    <p class="muted">Entre las 19 comunidades, este aspecto va del ${min}% al ${max}%: esta comunidad se sitúa
    ${pct.replace("%", "") > (Number(min) + Number(max)) / 2 ? "por encima" : "por debajo"} de la mitad de ese rango.</p>
    ${avisoEvidencia}`;
  el("modal-detalle").hidden = false;
}

export async function render() {
  if (!inicializado) {
    inicializado = true;
    await cargarHeatmap();
    el("btn-info-heatmap").addEventListener("click", abrirInfoHeatmap);
    el("tabla-heatmap").addEventListener("click", (ev) => {
      const celda = ev.target.closest(".heatmap-celda");
      if (celda) abrirExplicacionCelda(celda);
    });
    const { ccaa } = await api.get("/ccaa");
    llenarSelect(
      el("diag-ccaa"),
      ccaa.map((c) => c.ccaa),
    );
    el("diag-ccaa").insertAdjacentHTML("afterbegin", `<option value="" selected>España (todas las CCAA)</option>`);
    el("diag-ccaa").addEventListener("change", (ev) => cargarRanking(ev.target.value));
  }
  await cargarRanking(el("diag-ccaa").value);
}
