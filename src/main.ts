import Phaser from 'phaser';
// шрифты локально (без внешних запросов): кириллица и казахские буквы — подмножество cyrillic-ext
import '@fontsource/montserrat-alternates/700.css';
import '@fontsource/montserrat-alternates/800.css';
import '@fontsource/nunito/400.css';
import '@fontsource/nunito/700.css';
import './styles/tokens.css';
import './ui/styles.css';
import './ui/desktop.css';
import './ui/theme.css';
import { GameScene } from './game/GameScene';
import { FIELD_H, FIELD_W } from './game/config';
import { initUI } from './ui/ui';
import { sfx } from './audio/sfx';
import { prefetchMusic } from './audio/music';
import { initLayout, isWide } from './ui/layout';
import { setLang } from './i18n';
import { store } from './storage/save';
import { cloud } from './cloud/cloud';
import { logBuild } from './util/build';
import { initAnalytics, initDebugPanel, initErrorReporting } from './util/observability';

logBuild();
initErrorReporting();
setLang(store.data.lang);

// Раскладка (телефон / планшет / десктоп) — до создания игры: от неё зависит разрешение холста.
initLayout(() => game.scale.refresh());

// Разрешение холста ограничено 2: чёткая картинка на HiDPI без лишней нагрузки на телефоны.
// На телефоне — devicePixelRatio, как раньше. На широком экране поле вписывается по высоте окна,
// поэтому берём не меньше высоты экрана в физических пикселях (иначе на 1440p/4K картинка растягивается).
const dpr = window.devicePixelRatio || 1;
const S = isWide() ? Math.min(2, Math.max(dpr, ((window.screen?.height || window.innerHeight) * dpr) / FIELD_H)) : Math.min(2, dpr);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: Math.round(FIELD_W * S),
  height: Math.round(FIELD_H * S),
  backgroundColor: '#b8823f',
  // прозрачный canvas: в 3D-виде под ним лежит сцена Three.js (в 2D поле закрашивает всё само)
  transparent: true,
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
// звук и музыка — только после жеста пользователя (touchend — для iOS)
for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, () => sfx.unlock(), { capture: true });
prefetchMusic();
initAnalytics();
initDebugPanel(() => game.loop.actualFps);
// облако — надстройка: без сети или без настроек игра работает как раньше
void cloud.init();

// e2e и отладка: доступ к игре (только чтение).
Object.defineProperty(window, '__game', { value: game, enumerable: false });
