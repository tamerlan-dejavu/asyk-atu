/**
 * Все константы поля и физики. Значения подобраны запуском симуляции
 * (см. docs/DEFENSE.md, раздел «Настройка физики»).
 */

// --- Поле (логические пиксели) ---
export const FIELD_W = 720;
export const FIELD_H = 1080;
/** Кон: круг, внутри которого стоят асыки. Вылет центра за границу = «выбит». */
export const ZONE = { x: 360, y: 350, r: 180 };
/** Линия броска: сақа всегда стартует отсюда. */
export const THROW_LINE_Y = 930;
export const SAKA_START = { x: FIELD_W / 2, y: THROW_LINE_Y };
/** Прицеливание начинается только в нижней трети поля (широкая зона касания). */
export const AIM_ZONE_Y = (FIELD_H * 2) / 3;

// --- Прицеливание ---
/** Оттягивание короче — бросок отменяется без траты попытки. */
export const MIN_PULL = 24;
/** Оттягивание длиннее считается максимальным (сила = 100 %). */
export const MAX_PULL = 170;
/** Макс. отклонение направления броска от «строго вверх», рад (нельзя бросить назад). */
export const MAX_AIM_ANGLE = (75 * Math.PI) / 180;

// --- Физика ---
export const PHYS_HZ = 60;
export const STEP_MS = 1000 / PHYS_HZ;
/** Подшагов на шаг физики: защита от «пролёта» быстрой сақа сквозь асык (tunneling). */
export const SUBSTEPS = 2;
export const POSITION_ITERATIONS = 8;
export const VELOCITY_ITERATIONS = 6;
/** Потолок скорости тел (px за шаг 1/60 с). */
export const MAX_BODY_SPEED = 30;

/** Скорость сақа при слабом/сильном броске (px за шаг). 100 % долетает чуть дальше дальнего края кона. */
export const POWER_MIN = 8;
export const POWER_MAX = 26;

export const ASYK = {
  w: 44,
  h: 26,
  density: 0.001,
  friction: 0.4,
  restitution: 0.4,
  frictionAir: 0.03,
};
export const SAKA = {
  w: 56,
  h: 34,
  density: 0.001 * 2.5, // сақа утяжелена — как в традиции
  friction: 0.4,
  restitution: 0.35,
  frictionAir: 0.03,
};
export const WALL_RESTITUTION = 0.5;

// --- Типы тел (данные уровней: поле type у асыка) ---
/** Очки за выбитое тело каждого типа; блок (препятствие) не выбивается и очков не даёт. */
export const ASYK_VALUE = { normal: 10, golden: 30, heavy: 15, block: 0 } as const;
/** Тяжёлый асык: плотность x2.5 и сопротивление воздуха +30 % — сдвинуть трудно, бить нужно сильно. */
export const HEAVY = { densityMul: 2.5, frictionAirMul: 1.3 };
/** Блок: статичный «камень» 40x40 со скруглёнными углами; сақа и асыки от него отскакивают. */
export const BLOCK = { size: 40, radius: 8, restitution: 0.5 };

// --- Остановка ---
export const SETTLE_SPEED = 0.05;
export const SETTLE_ANGULAR = 0.01;
/** Тела должны «стоять» столько мс подряд. */
export const SETTLE_HOLD_MS = 500;
/** Жёсткий тайм-аут хода. */
export const TURN_TIMEOUT_MS = 7000;
/** Вылет асыка: столько мс он угасает, потом тело удаляется. */
export const OUT_FADE_MS = 300;

// --- Игровые правила ---
export const POINTS_PER_ASYK = 10;
export const COMBO_BONUS = 5;
export const ECONOMY_BONUS = 10;
export const VERSUS_THROWS_EACH = 6;
export const DAILY_THROWS = 6;

// --- Псевдообъём (только визуал; физика этих значений не видит) ---
export const SHADOW_OFFSET = 7;
export const BOUNCE_IMPULSE_MIN = 1.2;
export const BOUNCE_MS = 200;
export const PARALLAX_K = [0.02, 0.05, 0.1];
export const PARALLAX_MAX = 12;
