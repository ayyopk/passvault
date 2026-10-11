import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '../src/version.js';
const root = new URL('../', import.meta.url);
export const standaloneName = `PassVault_${APP_VERSION}.html`;
export async function standaloneHtml() {
  const modules = ['version', 'model', 'crypto', 'search', 'platform', 'export', 'import', 'app'];
  const sources = await Promise.all(modules.map(name => fs.readFile(new URL(`src/${name}.js`, root), 'utf8')));
  const code = sources.map(source => source.replace(/^import .+;\r?\n/gm, '').replace(/^export /gm, '')).join('\n');
  const css = await fs.readFile(new URL('styles/app.css', root), 'utf8');
  const html = await fs.readFile(new URL('index.html', root), 'utf8');
  return html.replace('<link rel="stylesheet" href="./styles/app.css">', () => `<style>${css}</style>`)
    .replace('<script type="module" src="./src/app.js"></script>', () => `<script>\n(()=>{\n'use strict';\n${code.replace(/<\/script/gi, '<\\/script')}\n})();\n</script>`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await fs.writeFile(new URL(standaloneName, root), await standaloneHtml());
  console.log(`Built ${standaloneName} from shared modules`);
}
