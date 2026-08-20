import '@fontsource-variable/inter';
import './styles/tokens.css';
import './styles/layout.css';
import './styles/controls.css';
import './styles/instruments.css';
import './styles/dock.css';
import './styles/sound-design.css';

import { mountApp } from './app.ts';
import { applyTheme, themeFromUrl } from './ui/theme.ts';

applyTheme(themeFromUrl());

const root = document.getElementById('app');
if (!root) throw new Error('Beat Studio: #app container is missing');

// `?samples=off` keeps the app fully self-contained on the built-in synth
// voices, with no request to the third-party soundfont CDN.
const samples = new URLSearchParams(window.location.search).get('samples') !== 'off';

mountApp(root, { samples });
