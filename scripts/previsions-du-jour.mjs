/**
 * Les prévisions du jour, écrites dans les pages Surf et Skateparks (17 nov. 2026).
 *
 *   node scripts/previsions-du-jour.mjs                     # depuis wts-website
 *   node scripts/previsions-du-jour.mjs --liste=urls.txt    # et la liste des pages changées
 *
 * Le bloc « les 3 prochains jours » est rempli par js/previsions.js chez le
 * visiteur : Google le lit mal, et une page qui ne change jamais est moins
 * souvent revisitée. Ce script écrit chaque matin, dans la page même, un
 * résumé en phrases des 3 jours (entre <!--prev-resume--> et <!--/prev-resume-->),
 * et date du jour, dans les plans du site, les pages qui ont changé.
 *
 * Les règles sont celles de js/previsions.js (et du panneau de l'app) :
 * matin 6h–12h, après-midi 12h–20h, ciel le plus fréquent, pluie au-delà du
 * code 48, vent offshore à 45° près de la terre, onshore à 45° près du large.
 *
 * Lancé par .github/workflows/previsions.yml, et par les générateurs de
 * where2ride après une régénération. Sans dépendance : Node 20 suffit.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SITE = 'https://www.westtidestudio.com';
const arg = (nom) => process.argv.find((a) => a.startsWith(`--${nom}=`))?.slice(nom.length + 3);
const racine = arg('racine') ?? process.cwd();
const fichierListe = arg('liste');

/** Open-Meteo prend plusieurs lieux par demande : 50 à la fois garde des adresses courtes. */
const PAR_DEMANDE = 50;

const MATIN = [6, 12];
const APRES_MIDI = [12, 20];

// ---------------------------------------------------------------------------
// Les pages et leurs lieux : lus dans le bloc lui-même (data-lat, data-lon…).
// ---------------------------------------------------------------------------

function* pagesHtml(dossier) {
  for (const e of readdirSync(dossier, { withFileTypes: true })) {
    const chemin = join(dossier, e.name);
    if (e.isDirectory()) yield* pagesHtml(chemin);
    else if (e.name === 'index.html') yield chemin;
  }
}

const attributs = (balise) => Object.fromEntries([...balise.matchAll(/data-([a-z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const deHtml = (t) => t.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const echap = (t) =>
  String(t).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

const pages = [];
for (const fichier of pagesHtml(join(racine, 'rideseek'))) {
  const html = readFileSync(fichier, 'utf8');
  if (!html.includes('<!--prev-resume-->')) continue;
  const balise = html.match(/<div class="prev [^>]*data-previsions=[^>]*>/)?.[0];
  if (!balise) continue;
  const a = attributs(balise);
  const chemin = `/${relative(racine, fichier).split(sep).join('/').replace(/index\.html$/, '')}`;
  pages.push({
    fichier,
    chemin,
    html,
    surf: a.previsions === 'surf',
    lat: +a.lat,
    lon: +a.lon,
    orientation: a.orientation != null ? +a.orientation : null,
    lieu: a.lieu ? deHtml(a.lieu) : null,
  });
}

// ---------------------------------------------------------------------------
// Open-Meteo : la météo de chaque lieu, la houle des spots de surf.
// ---------------------------------------------------------------------------

async function parLots(lieux, base) {
  const res = [];
  for (let i = 0; i < lieux.length; i += PAR_DEMANDE) {
    const lot = lieux.slice(i, i + PAR_DEMANDE);
    const url = `${base}&latitude=${lot.map((l) => l.lat).join(',')}&longitude=${lot.map((l) => l.lon).join(',')}`;
    let corps;
    for (let essai = 1; ; essai++) {
      const r = await fetch(url);
      if (r.ok) {
        corps = await r.json();
        break;
      }
      if (essai === 4) throw new Error(`Open-Meteo ${r.status} : ${(await r.text()).slice(0, 200)}`);
      // 429 : la limite par minute d'Open-Meteo, qui se vide en une minute.
      await new Promise((ok) => setTimeout(ok, r.status === 429 ? 65000 : 5000 * essai));
    }
    res.push(...(Array.isArray(corps) ? corps : [corps]));
  }
  return res;
}

const cleLieu = (p) => `${p.lat},${p.lon}`;
const lieuxMeteo = [...new Map(pages.map((p) => [cleLieu(p), p])).values()];
const lieuxMer = [...new Map(pages.filter((p) => p.surf).map((p) => [cleLieu(p), p])).values()];
const COMMUN = 'timezone=auto&forecast_days=3';
const [meteos, mers] = await Promise.all([
  parLots(
    lieuxMeteo,
    `https://api.open-meteo.com/v1/forecast?${COMMUN}&wind_speed_unit=kmh&hourly=weather_code,temperature_2m,precipitation,wind_speed_10m,wind_direction_10m`,
  ),
  parLots(lieuxMer, `https://marine-api.open-meteo.com/v1/marine?${COMMUN}&hourly=swell_wave_height,swell_wave_period,swell_wave_direction`),
]);
const meteoDe = new Map(lieuxMeteo.map((l, i) => [cleLieu(l), meteos[i]]));
const merDe = new Map(lieuxMer.map((l, i) => [cleLieu(l), mers[i]]));

// ---------------------------------------------------------------------------
// Le résumé, en phrases.
// ---------------------------------------------------------------------------

const SECTEURS = [
  'nord', 'nord-nord-est', 'nord-est', 'est-nord-est', 'est', 'est-sud-est', 'sud-est', 'sud-sud-est',
  'sud', 'sud-sud-ouest', 'sud-ouest', 'ouest-sud-ouest', 'ouest', 'ouest-nord-ouest', 'nord-ouest', 'nord-nord-ouest',
];
const secteur = (deg) => SECTEURS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
const de = (mot) => (/^[aeiouy]/.test(mot) ? `d'${mot}` : `de ${mot}`);
const ecart = (a, b) => {
  const x = Math.abs(a - b) % 360;
  return x > 180 ? 360 - x : x;
};
const virgule = (x, n = 1) => x.toFixed(n).replace('.', ',');
const moyenne = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const cap = (degs) => {
  const s = moyenne(degs.map((x) => Math.sin((x * Math.PI) / 180)));
  const c = moyenne(degs.map((x) => Math.cos((x * Math.PI) / 180)));
  return ((Math.atan2(s, c) * 180) / Math.PI + 360) % 360;
};
function dominant(codes) {
  const n = new Map();
  for (const c of codes) n.set(c, (n.get(c) || 0) + 1);
  let best = null;
  for (const [c, k] of n) if (best == null || k > n.get(best) || (k === n.get(best) && c > best)) best = c;
  return best;
}
function ciel(code) {
  if (code === 0) return { mot: 'soleil', pluie: false };
  if (code <= 2) return { mot: 'éclaircies', pluie: false };
  if (code <= 48) return { mot: code >= 45 ? 'brouillard' : 'couvert', pluie: false };
  if (code >= 95) return { mot: 'orage', pluie: true };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { mot: 'neige', pluie: true };
  return { mot: code <= 57 ? 'bruine' : 'pluie', pluie: true };
}
const RELATIONS = { offshore: 'offshore', cross: 'de travers', onshore: 'onshore' };
function relation(ventDeg, orientation) {
  if (orientation == null) return null;
  const depuisLaTerre = ecart(ventDeg, (orientation + 180) % 360);
  return depuisLaTerre <= 45 ? 'offshore' : depuisLaTerre >= 135 ? 'onshore' : 'cross';
}

/** Une demi-journée : la moyenne de ses heures, comme js/previsions.js. */
function demi(h, m, iMer, date, [debut, fin]) {
  const idx = [];
  h.time.forEach((t, i) => {
    const hh = +t.slice(11, 13);
    if (t.startsWith(date) && hh >= debut && hh < fin && h.weather_code[i] != null) idx.push(i);
  });
  if (!idx.length) return null;
  const x = {
    ciel: ciel(dominant(idx.map((i) => h.weather_code[i]))),
    temp: Math.round(Math.max(...idx.map((i) => h.temperature_2m[i]))),
    pluieMm: idx.reduce((s, i) => s + (h.precipitation[i] || 0), 0),
    vent: Math.round(moyenne(idx.map((i) => h.wind_speed_10m[i]))),
    ventDeg: cap(idx.map((i) => h.wind_direction_10m[i])),
  };
  if (m) {
    const im = idx.map((i) => iMer.get(h.time[i])).filter((j) => j != null && m.swell_wave_height[j] != null);
    if (im.length) {
      x.houle = moyenne(im.map((j) => m.swell_wave_height[j]));
      x.periode = Math.round(moyenne(im.map((j) => m.swell_wave_period[j])));
      x.houleDeg = cap(im.map((j) => m.swell_wave_direction[j]));
    }
  }
  return x;
}

const nomDuJour = (date) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const majuscule = (t) => t.charAt(0).toUpperCase() + t.slice(1);

function phraseSurf(nom, x, orientation) {
  const morceaux = [];
  if (x.houle != null) morceaux.push(`houle de ${virgule(x.houle)} m à ${x.periode} s ${de(secteur(x.houleDeg))}`);
  const rel = relation(x.ventDeg, orientation);
  morceaux.push(`vent de ${x.vent} km/h ${de(secteur(x.ventDeg))}${rel ? `, ${RELATIONS[rel]}` : ''}`);
  return `${nom}, ${morceaux.join(', ')}`;
}

function phraseSkate(nom, x) {
  const pluie = x.ciel.pluie && x.pluieMm >= 0.1 ? ` (${virgule(x.pluieMm)} mm)` : '';
  return `${nom}, ${x.ciel.mot}${pluie}, ${x.temp}°, vent de ${x.vent} km/h`;
}

function resume(p) {
  const meteo = meteoDe.get(cleLieu(p));
  const h = meteo?.hourly;
  if (!h?.time?.length) return null;
  const m = p.surf ? merDe.get(cleLieu(p))?.hourly : null;
  if (p.surf && !m?.time?.length) return null;
  const iMer = new Map((m?.time || []).map((t, i) => [t, i]));
  const dates = [...new Set(h.time.map((t) => t.slice(0, 10)))].slice(0, 3);
  const jours = dates.map((date) => ({ date, matin: demi(h, m, iMer, date, MATIN), apresMidi: demi(h, m, iMer, date, APRES_MIDI) }));
  if (p.surf && !jours.some((j) => (j.matin || j.apresMidi)?.houle != null)) return null;

  const lignes = jours.map((j) => {
    const moities = [
      ['le matin', j.matin],
      ["l'après-midi", j.apresMidi],
    ].filter(([, x]) => x);
    const texte = moities.map(([nom, x]) => (p.surf ? phraseSurf(nom, x, p.orientation) : phraseSkate(nom, x))).join(' ; ');
    return `<li><strong>${echap(majuscule(nomDuJour(j.date)))}</strong> : ${echap(texte)}.</li>`;
  });

  let bilan = '';
  if (p.surf) {
    // Le créneau le plus propre reste dans l'app : ici, seulement la plus grosse houle.
    const avecHoule = jours.flatMap((j) => [j.matin, j.apresMidi].map((x) => ({ j, x }))).filter(({ x }) => x?.houle != null);
    const max = avecHoule.reduce((a, b) => (b.x.houle > a.x.houle ? b : a));
    bilan = `La plus grosse houle des 3 jours : ${virgule(max.x.houle)} m, ${nomDuJour(max.j.date)}. Le meilleur créneau, la marée et les 6 jours suivants sont dans l'app RideSeek.`;
  } else {
    let pluie = null;
    for (const j of jours) {
      for (const [nom, x] of [['matin', j.matin], ['après-midi', j.apresMidi]]) if (!pluie && x?.ciel.pluie) pluie = `${nomDuJour(j.date)} ${nom}`;
    }
    bilan = pluie ? `Première pluie annoncée : ${pluie}. Le béton mouillé ne se ride pas.` : 'Pas de pluie annoncée : praticable ces 3 jours.';
  }

  const fuseau = meteo.timezone || 'Europe/Paris';
  const maintenant = new Date();
  const quand = maintenant.toLocaleString('fr-FR', { timeZone: fuseau, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const titre = p.surf ? `Prévisions surf ${p.lieu ?? ''}`.trim() : `Météo ${p.lieu ?? ''} pour skater`.trim();
  return `<h3>${echap(titre)}, du ${echap(nomDuJour(dates[0]))} au ${echap(nomDuJour(dates.at(-1)))}</h3><ul>${lignes.join('')}</ul><p>${echap(bilan)}</p><p class="prev-resume-maj">Mis à jour le <time datetime="${maintenant.toISOString()}">${echap(quand)}</time>.</p>`;
}

// ---------------------------------------------------------------------------
// L'écriture : les pages, puis les dates des plans du site.
// ---------------------------------------------------------------------------

const MARQUES = /<!--prev-resume-->[\s\S]*?<!--\/prev-resume-->/;
const changees = [];
let vides = 0;
for (const p of pages) {
  const r = resume(p);
  if (!r) {
    vides++;
    continue;
  }
  const html = p.html.replace(MARQUES, `<!--prev-resume-->${r}<!--/prev-resume-->`);
  if (html !== p.html) {
    writeFileSync(p.fichier, html);
    changees.push(p.chemin);
  }
}

const jour = new Date().toISOString().slice(0, 10);
const changeesSet = new Set(changees.map((c) => `${SITE}${c}`));
const plansChanges = new Set();
for (const plan of ['rideseek/surf/sitemap.xml', 'rideseek/skateparks/sitemap.xml']) {
  const fichier = join(racine, plan);
  let xml;
  try {
    xml = readFileSync(fichier, 'utf8');
  } catch {
    continue;
  }
  const neuf = xml.replace(/<url><loc>([^<]+)<\/loc><lastmod>[^<]+<\/lastmod><\/url>/g, (tout, loc) =>
    changeesSet.has(loc) ? `<url><loc>${loc}</loc><lastmod>${jour}</lastmod></url>` : tout,
  );
  if (neuf !== xml) {
    writeFileSync(fichier, neuf);
    plansChanges.add(`${SITE}/${plan}`);
  }
}
if (plansChanges.size) {
  const fichier = join(racine, 'sitemap.xml');
  const xml = readFileSync(fichier, 'utf8');
  writeFileSync(
    fichier,
    xml.replace(/<sitemap><loc>([^<]+)<\/loc><lastmod>[^<]+<\/lastmod><\/sitemap>/g, (tout, loc) =>
      plansChanges.has(loc) ? `<sitemap><loc>${loc}</loc><lastmod>${jour}</lastmod></sitemap>` : tout,
    ),
  );
}

if (fichierListe) writeFileSync(fichierListe, changees.map((c) => `${SITE}${c}`).join('\n') + (changees.length ? '\n' : ''));
console.log(`Prévisions du jour : ${pages.length} pages, ${changees.length} mises à jour, ${vides} sans prévision.`);
