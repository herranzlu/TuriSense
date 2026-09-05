import { api } from "../api.js";
import { el, fmtNum, llenarSelect, conCarga } from "../utils.js";

let cargado = false;
let chartAnual = null;
let chartMensual = null;
let chartBenchmark = null;
let periodoActual = null; // se fija con la respuesta nacional de /contexto, para comparar el mismo mes al elegir una CCAA

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

function renderTerritorial(ccaa, data) {
  const panel = el("contexto-territorial");
  if (!ccaa) {
    panel.innerHTML = `<p class="muted" style="margin-top:1rem">Elige una comunidad arriba para compararla con la media nacional.</p>`;
    return;
  }

  const filas = data.indicadores_mensuales
    .filter((i) => i.valor_ccaa !== null && i.valor_ccaa !== undefined)
    .map((i) => {
      const yoy = i.variacion_interanual_pct_ccaa;
      const yoyHtml =
        yoy === null || yoy === undefined
          ? ""
          : `<span class="kpi-yoy ${yoy >= 0 ? "sube" : "baja"}">${yoy >= 0 ? "▲" : "▼"} ${Math.abs(yoy).toFixed(1)}% interanual</span>`;
      return `
      <div class="kpi-card">
        <div class="kpi-valor">${fmtNum(i.valor_ccaa)}${yoyHtml}</div>
        <div class="kpi-label">
          ${i.unidad}<br>${i.etiqueta}<br>
          <span class="muted">puesto ${i.puesto_ccaa} de ${i.total_ccaa_con_dato} · media España: ${fmtNum(i.valor_nacional)}</span>
        </div>
      </div>`;
    })
    .join("");

  panel.innerHTML = `
    <div class="kpi-row" style="margin-top:1rem">${filas || '<p class="muted">Sin datos oficiales para esta comunidad en el último periodo.</p>'}</div>
    <button type="button" id="btn-ver-ficha-contexto" class="btn-secundario" style="margin-top:.4rem">Ver ficha completa de ${ccaa}</button>
  `;
  el("btn-ver-ficha-contexto").addEventListener("click", () => {
    sessionStorage.setItem("ficha_ccaa", ccaa);
    location.hash = "ficha";
  });
}

async function cargarTerritorial(ccaa) {
  if (!ccaa) return renderTerritorial(null);
  const qs = new URLSearchParams({ ccaa });
  if (periodoActual) qs.set("periodo", periodoActual);
  const data = await conCarga(api.get(`/contexto?${qs.toString()}`));
  renderTerritorial(ccaa, data);
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
      onClick: (ev, elementos, chart) => {
        if (!elementos.length) return;
        const punto = chart.data.datasets[elementos[0].datasetIndex].data[elementos[0].index];
        if (!punto?.ccaa) return;
        sessionStorage.setItem("ficha_ccaa", punto.ccaa);
        location.hash = "ficha";
      },
      onHover: (ev, elementos) => {
        ev.native.target.style.cursor = elementos.length ? "pointer" : "default";
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx2) => `${ctx2.raw.ccaa}: ${ctx2.dataset.label}` } },
      },
      scales: {
        x: { min: 0, max: 1, title: { display: true, text: "Escala: volumen de turismo (percentil entre las 19 CCAA)" } },
        y: { min: 0, max: 1, title: { display: true, text: "Intensidad: turismo respecto a su población (percentil)" } },
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

  const [data, hist, { ccaa: listaCcaa }] = await conCarga(
    Promise.all([api.get("/contexto"), api.get("/contexto/historico"), api.get("/ccaa")]),
  );
  periodoActual = data.periodo;

  renderKpis(data);
  renderHallazgo(hist);
  renderChartAnual(hist);
  renderEstacionalidad(hist);
  renderChartMensual(hist);
  renderBenchmark(hist);
  renderAnualCierre(data);

  llenarSelect(el("contexto-ccaa"), listaCcaa.map((c) => c.ccaa));
  el("contexto-ccaa").insertAdjacentHTML("afterbegin", `<option value="" selected>España (media nacional)</option>`);
  el("contexto-ccaa").addEventListener("change", (ev) => cargarTerritorial(ev.target.value));
  renderTerritorial(null);
}
