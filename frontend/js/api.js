// Cliente mínimo contra el backend FastAPI. El frontend solo hace fetch() y pinta
// lo que recibe: nunca calcula un indicador nuevo aquí (regla de arquitectura).
const BASE = "/api";

async function peticion(path, opts) {
  const res = await fetch(BASE + path, opts);
  if (!res.ok) {
    let detalle = "";
    try {
      detalle = (await res.json()).detail ?? "";
    } catch {
      /* respuesta sin cuerpo JSON */
    }
    // status/detalle como propiedades propias: así cada pantalla puede mostrar un
    // mensaje humano según el caso, en vez de enseñarle a quien usa esto un código
    // HTTP en crudo (un 404 no le dice nada a alguien que no es programador).
    const err = new Error(`${res.status} ${res.statusText}${detalle ? ": " + detalle : ""}`);
    err.status = res.status;
    err.detalle = detalle;
    throw err;
  }
  return res.json();
}

export const api = {
  get: (path) => peticion(path),
  post: (path, body) =>
    peticion(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
};
