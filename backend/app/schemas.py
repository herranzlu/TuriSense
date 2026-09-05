"""Modelos Pydantic. Solo hace falta validar de verdad el body del recomendador;
el resto de endpoints son GET de solo lectura y devuelven dict/JSON directamente."""
from pydantic import BaseModel, Field

from . import config


class PreferenciasRecomendador(BaseModel):
    territorio: str | None = Field(
        default=None,
        description="Nombre oficial de una CCAA (ver /api/ccaa), o None/'todas' para España entera.",
    )
    tipo_experiencia: str | None = Field(
        default=None,
        description="'alojamiento', 'restauracion', 'ocio', 'otro' (ver /api/recomendar/filtros), o None/'todas'.",
    )
    ciudad: str | None = Field(
        default=None,
        description=(
            "Nombre de una ciudad (ver /api/recomendar/filtros), o None/'todas'. No hay coordenadas en los "
            "datos de origen, así que esto es lo más parecido a un filtro de 'cerca de mí' que se puede ofrecer "
            "honestamente: por ciudad, no por kilómetros exactos."
        ),
    )
    pesos_aspectos: dict[str, float] = Field(
        default_factory=dict,
        description=(
            "Peso 0-1 por cada uno de los 11 aspectos (clave = key de config.ASPECTOS). "
            "Los aspectos no incluidos, o con peso 0, no cuentan en el match. "
            "Si el diccionario está vacío, se ordena directamente por satisfacción general "
            "(igual que hace el motor real cuando no se le da ninguna preferencia)."
        ),
    )
    peso_anti_masificacion: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="0 = ignora el volumen relativo del lugar. 1 = penaliza al máximo los lugares muy masificados.",
    )
    top_n: int = Field(default=20, ge=1, le=200)
    incluir_baja_evidencia: bool = Field(
        default=False,
        description=(
            f"Si es False (por defecto), descarta lugares con menos de {config.MIN_RESENAS_RECOMENDADOR} reseñas: "
            "con muy pocas, un 100% positivo puede ser pura casualidad de muestra."
        ),
    )

    def pesos_validados(self) -> dict[str, float]:
        return {k: v for k, v in self.pesos_aspectos.items() if k in config.ASPECTO_KEYS and v > 0}
