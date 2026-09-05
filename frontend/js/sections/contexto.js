import { api } from "../api.js";
import { el, fmtNum } from "../utils.js";

let cargado = false;
let chartAnual = null;
let chartMensual = null;
let chartBenchmark = null;

const COLOR_CUADRANTE = {
  escala_alta__intensidad_alta: "#D40E14",
  escala_alta__intensidad_moderada: "#092A5E",
  escala_moderada__intensidad_alta: "#FFE100",
  escala_moderada__intensidad_moderada: "#AAD700",
};
const ETIQUETA_CUADRANTE = {
  escala_alta__intensidad_alta: "Mercado maduro",
  escala_alta__intensidad_moderada: "Con margen de crecimiento",
  escala_moderada__intensidad_alta: "Presión alta, poco territorio",
  escala_moderada__intensidad_moderada: "En desarrollo",
};

function renderKpis(data) {
  if (data.resumen) {
    el("contexto-resumen").hidden = false;
    el("contexto-resumen").textContent = data.resumen;
  } else {
    el("contexto-resumen").hidden = true;
  }

  el("contexto-kpis").innerHTML = data.indicadores_mensuales
    .map((i) => {
      const yoy = i.variacion_interanual_pct;
      const yoyHtml =
        yoy === null || yoy === undefined
          ? ""
          : `<span class="kpi-yoy ${yoy >= 0 ? "sube" : "baja"}">${yoy >= 0 ? "▲" : "▼"} ${Math.abs(yoy).toFixed(1)}% interanual</span>`;

      // Con cifra absoluta reconstruida (turistas, pasajeros...): esa es la protagonista,
      // grande y fácil de leer; la tasa por 1.000 residentes queda como dato secundario
      // para quien quiera comparar territorios. Sin ella, la tasa/% sigue siendo la única.
      const tieneAbsoluta = i.valor_absoluto_nacional !== null && i.valor_absoluto_nacional !== undefined;
      const cifraGrande = tieneAbsoluta ? fmtNum(i.valor_absoluto_nacional) : fmtNum(i.valor_nacional);
      const subEtiqueta = tieneAbsoluta ? i.unidad_absoluta : i.etiqueta;
      const detalleTasa = tieneAbsoluta ? `<br>${fmtNum(i.valor_nacional)} ${i.unidad}` : "";

      return `
      <div class="kpi-card">
        <div class="kpi-valor">${cifraGrande}${yoyHtml}</div>
        <div class="kpi-label">${subEtiqueta}${detalleTasa}<br><span class="muted">${i.fuente}${i.provisional ? " · provisional" : ""}</span></div>
      </div>`;
    })
    .join("");
}

function renderHallazgo(hist) {
  const panel = el("contexto-hallazgo");
  if (!hist.hallazgo) {
    panel.hidden = true;
    return;
  }
  const partes = hist.hallazgo.match(/([+-]?\d+)%/);
  const cifra = partes ? partes[0] : "";
  panel.innerHTML = `
    <div class="hallazgo-cifra">${cifra}</div>
    <div class="hallazgo-texto">${hist.hallazgo}</div>
  `;
}

function renderChartAnual(hist) {
  const ctx = el("chart-anual").getContext("2d");
  if (chartAnual) chartAnual.destroy();
  chartAnual = new Chart(ctx, {
    type: "bar",
    data: {
      labels: hist.serie_anual.map((a) => a.anio),
      datasets: [
        {
          label: "Pernoctaciones regladas",
          data: hist.serie_anual.map((a) => a.pernoctaciones),
          backgroundColor: hist.serie_anual.map((a) => (a.anio === 2020 ? "#FFE100" : a.anio === 2019 ? "#D7D2C3" : "#D40E14")),
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { title: { display: true, text: "Pernoctaciones (nº de noches reservadas)" }, ticks: { callback: (v) => fmtNum(v) } } },
    },
  });

  el("leyenda-anual").innerHTML = `
    <span class="leyenda-item"><span class="leyenda-swatch" style="background:#D7D2C3"></span> 2019, referencia pre-pandemia</span>
    <span class="leyenda-item"><span class="leyenda-swatch" style="background:#FFE100"></span> 2020, caída por el confinamiento</span>
    <span class="leyenda-item"><span class="leyenda-swatch" style="background:#D40E14"></span> resto de años</span>
  `;
}

function renderChartMensual(hist) {
  const ctx = el("chart-mensual").getContext("2d");
  if (chartMensual) chartMensual.destroy();
  chartMensual = new Chart(ctx, {
    type: "line",
    data: {
      labels: hist.serie_mensual.map((p) => p.periodo),
      datasets: [
        {
          label: "Pernoctaciones",
          data: hist.serie_mensual.map((p) => p.pernoctaciones),
          borderColor: "#092A5E",
          backgroundColor: "rgba(9,42,94,.08)",
          pointRadius: 0,
          borderWidth: 1.5,
          fill: true,
          tension: 0.15,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { maxTicksLimit: 14 } },
        y: { title: { display: true, text: "Pernoctaciones ese mes (nº de noches reservadas)" }, ticks: { callback: (v) => fmtNum(v) } },
      },
    },
  });
}

function renderEstacionalidad(hist) {
  const est = hist.estacionalidad_nacional;
  el("contexto-estacionalidad").innerHTML = `
    <h3>Estacionalidad</h3>
    <div class="estacionalidad-item">
      <div class="muted">Mes de mayor actividad</div>
      <div class="estacionalidad-cifra" style="text-transform:capitalize">${est.mes_pico ?? "N/D"}</div>
    </div>
    <div class="estacionalidad-item">
      <div class="muted">Se concentra en los 3 meses punta</div>
      <div class="estacionalidad-cifra">${est.concentracion_top3_meses_pct ?? "N/D"}%</div>
    </div>
    <p class="muted">${est.nota}</p>
  `;
}

function renderBenchmark(hist) {
  const grupos = {};
  for (const c of hist.benchmark_ccaa) {
    if (!c.cuadrante || c.escala_percentil === null || c.intensidad_percentil === null) continue;
    (grupos[c.cuadrante] ??= []).push({ x: c.escala_percentil, y: c.intensidad_percentil, ccaa: c.ccaa });
  }

  const ctx = el("chart-benchmark").getContext("2d");
  if (chartBenchmark) chartBenchmark.destroy();
  chartBenchmark = new Chart(ctx, {
    type: "scatter",
    data: {
      datasets: Object.entries(grupos).map(([cuadrante, puntos]) => ({
        label: ETIQUETA_CUADRANTE[cuadrante] ?? cuadrante,
        data: puntos,
        backgroundColor: COLOR_CUADRANTE[cuadrante] ?? "#737373",
        pointRadius: 6,
        pointHoverRadius: 8,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx2) => `${ctx2.raw.ccaa}: ${ctx2.dataset.label}` } },
      },
      scales: {
        x: { min: 0, max: 1, title: { display: true, text: "Escala (percentil entre las 19 CCAA)" } },
        y: { min: 0, max: 1, title: { display: true, text: "Intensidad respecto a su población (percentil)" } },
      },
    },
  });

  el("benchmark-leyenda").innerHTML = Object.entries(ETIQUETA_CUADRANTE)
    .map(
      (
        [cuadrante, etiqueta],
      ) => `
      <div class="benchmark-leyenda-item">
        <span class="benchmark-leyenda-swatch" style="background:${COLOR_CUADRANTE[cuadrante]}"></span>
        <span>${etiqueta}<br><span class="muted">${hist.cuadrante_definicion[cuadrante] ?? ""}</span></span>
      </div>`,
    )
    .join("");
}

function renderAnualCierre(data) {
  const est = data.contexto_estructural_anual;
  el("contexto-anual").innerHTML = `
    <h3>${est.anio}, cerrado</h3>
    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-valor">${fmtNum(Math.round(est.pernoctaciones_regladas_totales_espana))}</div>
        <div class="kpi-label">pernoctaciones regladas totales, España</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-valor">${est.ocupacion_hotelera_media_ponderada_pct}%</div>
        <div class="kpi-label">ocupación hotelera media, ponderada por población</div>
      </div>
    </div>
  `;
}

export async function render() {
  if (cargado) return;
  cargado = true;

  const [data, hist] = await Promise.all([api.get("/contexto"), api.get("/contexto/historico")]);

  renderKpis(data);
  renderHallazgo(hist);
  renderChartAnual(hist);
  renderEstacionalidad(hist);
  renderChartMensual(hist);
  renderBenchmark(hist);
  renderAnualCierre(data);
}
