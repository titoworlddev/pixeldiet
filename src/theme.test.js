import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readSource = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const globalStyles = readSource('./assets/css/global.css');
const mainSource = readSource('./main.js');
const rootStyles = readSource('./style.css');

describe('default dark theme', () => {
  it('forces the dark PrimeVue theme and semantic dark surfaces', () => {
    expect(mainSource).toContain('lara-dark-indigo/theme.css');
    expect(mainSource).not.toContain('lara-light-indigo/theme.css');
    expect(mainSource.indexOf('lara-dark-indigo/theme.css')).toBeLessThan(
      mainSource.indexOf('./assets/css/global.css')
    );
    expect(mainSource).toContain("import Tooltip from 'primevue/tooltip'");
    expect(mainSource).toContain("app.directive('tooltip', Tooltip)");

    expect(globalStyles).toContain('--app-canvas: #090d17');
    expect(globalStyles).toContain('--app-surface: #111827');
    expect(globalStyles).toContain('--app-surface-raised: #1f2937');
    expect(globalStyles).toContain('--app-text: #f8fafc');
    expect(rootStyles).toContain('color-scheme: dark');
    expect(rootStyles).toContain('backdrop-filter: none');
  });
});
