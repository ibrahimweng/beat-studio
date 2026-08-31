import '@fontsource-variable/inter';
import './styles/tokens.css';
import './styles/layout.css';
import './styles/controls.css';
import './styles/sound-design.css';
import './styles/video-window.css';

import { mountApp } from './app.ts';
import { applyTheme, themeFromUrl } from './ui/theme.ts';

applyTheme(themeFromUrl());

const root = document.getElementById('app');
if (!root) throw new Error('Beat Studio: #app container is missing');

mountApp(root);
