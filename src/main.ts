import Phaser from 'phaser';
import './ui/styles.css';
import { GameScene } from './game/GameScene';
import { FIELD_H, FIELD_W } from './game/config';
import { initUI } from './ui/ui';
import { setLang } from './i18n';
import { store } from './storage/save';
import { cloud } from './cloud/cloud';
import { logBuild } from './util/build';
import { initAnalytics, initDebugPanel, initErrorReporting } from './util/observability';

logBuild();
initErrorReporting();
setLang(store.data.lang);

// devicePixelRatio ограничен 2: чёткая картинка на HiDPI без лишней нагрузки на телефоны.
const S = Math.min(2, window.devicePixelRatio || 1);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: Math.round(FIELD_W * S),
  height: Math.round(FIELD_H * S),
  backgroundColor: '#b8823f',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [GameScene],
  banner: false,
  disableContextMenu: true,
  // Свой ввод на Pointer Events (AimController), встроенный ввод Phaser не нужен.
  input: { mouse: false, touch: false, keyboard: false, gamepad: false },
  render: { antialias: true, powerPreference: 'high-performance' },
  fps: { target: 60 },
});

initUI();
initAnalytics();
initDebugPanel(() => game.loop.actualFps);
// облако — надстройка: без сети или без настроек игра работает как раньше
void cloud.init();

// e2e и отладка: доступ к игре (только чтение).
Object.defineProperty(window, '__game', { value: game, enumerable: false });
