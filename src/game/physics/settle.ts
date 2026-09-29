/**
 * Определение остановки: тело «стоит», если и линейная, и угловая скорости ниже порогов.
 * Ход заканчивается, когда ВСЕ динамические тела стоят SETTLE_HOLD_MS подряд
 * (счётчик — в Sim) либо сработал жёсткий тайм-аут TURN_TIMEOUT_MS.
 */
export function isSettledNow(speed: number, angularSpeed: number, maxSpeed: number, maxAngular: number): boolean {
  return speed < maxSpeed && Math.abs(angularSpeed) < maxAngular;
}
