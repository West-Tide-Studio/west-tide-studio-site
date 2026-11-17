/**
 * Prévient Bing (et Yandex, Seznam, Naver : IndexNow est partagé) des pages
 * changées, pour qu'il les relise sans attendre (17 nov. 2026). Google ne lit
 * pas IndexNow : lui suit les dates du plan du site.
 *
 *   node scripts/indexnow.mjs urls.txt     # une adresse par ligne
 *   node scripts/indexnow.mjs --tout       # toutes les pages des plans du site
 *
 * La clé est publique par construction : le fichier /e2e4b2fb49971d12485467be01edd3f7.txt la
 * montre, c'est ce qui prouve que le site est à nous.
 */
import { readFileSync } from 'node:fs';

const HOTE = 'www.westtidestudio.com';
const CLE = 'e2e4b2fb49971d12485467be01edd3f7';

let urls;
if (process.argv[2] === '--tout') {
  const plans = ['sitemap-site.xml', 'rideseek/surf/sitemap.xml', 'rideseek/skateparks/sitemap.xml'];
  urls = plans.flatMap((p) => [...readFileSync(p, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
} else {
  urls = readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean);
}
if (!urls.length) {
  console.log('IndexNow : rien à signaler.');
  process.exit(0);
}

// 10 000 adresses au plus par envoi.
for (let i = 0; i < urls.length; i += 10000) {
  const r = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOTE, key: CLE, keyLocation: `https://${HOTE}/${CLE}.txt`, urlList: urls.slice(i, i + 10000) }),
  });
  // 200 et 202 : reçu. 403 : la clé n'est pas encore en ligne. 422 : une adresse hors du site.
  console.log(`IndexNow : ${Math.min(i + 10000, urls.length)} adresses envoyées, réponse ${r.status}.`);
  if (r.status >= 400) process.exitCode = 1;
}
