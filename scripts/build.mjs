import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const path of ['index.html', 'styles.css', 'duel.css', 'light.css', 'manifest.webmanifest', 'sw.js', 'src', 'assets', 'vendor']) await cp(path, `dist/${path}`, { recursive: true });
await writeFile('dist/.nojekyll', '');
console.log('Static PWA ready in dist/. All paths are relative for GitHub Pages.');
