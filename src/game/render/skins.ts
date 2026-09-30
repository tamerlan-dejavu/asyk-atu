/**
 * Скины сақа — стили одной 3D-модели асыка (материал поверх текстуры кости).
 * Используются в 3D-виде (ThreeView) и для картинок 2D/магазина (scripts/render-saka-skins.ts).
 * ТОЛЬКО внешний вид: физика и хитбокс сақа (56×34) от скина не зависят.
 */
export interface SkinStyle {
  /** цвет, умножаемый на текстуру кости */
  color: number;
  metalness: number;
  roughness: number;
  /** свечение по рисунку текстуры (0 — нет) */
  emissive: number;
  emissiveIntensity: number;
}

export const SAKA_STYLE: Record<string, SkinStyle> = {
  // без карты окружения сильный металл темнеет: «металличность» умеренная, цвет держит собственное свечение
  saka_bronze: { color: 0xd88a42, metalness: 0.45, roughness: 0.35, emissive: 0x5a2a08, emissiveIntensity: 0.55 },
  saka_silver: { color: 0xa9b8cc, metalness: 0.55, roughness: 0.25, emissive: 0x3c4a5c, emissiveIntensity: 0.65 },
  saka_gold: { color: 0xffcc40, metalness: 0.45, roughness: 0.25, emissive: 0x7a5200, emissiveIntensity: 0.7 },
  saka_oyu: { color: 0x4a78e0, metalness: 0.2, roughness: 0.35, emissive: 0x14306e, emissiveIntensity: 0.6 },
  saka_eagle: { color: 0x7a4a26, metalness: 0.05, roughness: 0.6, emissive: 0x2a1406, emissiveIntensity: 0.4 },
  saka_snowleopard: { color: 0xf6f8fc, metalness: 0.05, roughness: 0.6, emissive: 0x3a4250, emissiveIntensity: 0.45 },
  saka_tulpar: { color: 0x6fb0ff, metalness: 0.15, roughness: 0.35, emissive: 0x2458b0, emissiveIntensity: 0.6 },
  saka_lava: { color: 0x4a2418, metalness: 0.1, roughness: 0.75, emissive: 0xff5a14, emissiveIntensity: 0.28 },
  // набор «Той-Pro»: дракон (нефритово-зелёный) и неон (тёмный с фиолетовым свечением)
  saka_jade: { color: 0x4cc07c, metalness: 0.15, roughness: 0.35, emissive: 0x0e4a24, emissiveIntensity: 0.55 },
  saka_onyx: { color: 0x2c2640, metalness: 0.3, roughness: 0.3, emissive: 0xa24dff, emissiveIntensity: 0.3 },
};

export const sakaStyle = (id: string): SkinStyle => SAKA_STYLE[id] ?? SAKA_STYLE.saka_bronze;
