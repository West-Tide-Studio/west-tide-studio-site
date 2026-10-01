/*
 * RideSeek — la marée en direct.
 *
 * La marée de Brest, de 12 h avant à 12 h après
 * maintenant, avec ses pleines et basses mers et leur coefficient. Le même
 * calcul que dans l'app (src/services/coefficient.ts) : la marée semi-diurne
 * reconstituée depuis les constantes harmoniques du marégraphe de Brest
 * (TICON-4). La ligne se trace à l'arrivée ; le point de maintenant bat.
 */
(function () {
  const svg = document.querySelector(".ride-line");
  if (!svg) return;

  const RAD = Math.PI / 180;
  const BREST = {
    M2: [205.11, 108.993], N2: [41.694, 90.618], S2: [74.891, 148.282], K2: [21.368, 145.89],
    "2N2": [5.703, 72.807], MU2: [8.572, 105.072], NU2: [7.778, 86.6], L2: [6.387, 102.92],
    T2: [4.169, 138.562], LAMBDA2: [2.627, 75.818], R2: [0.534, 157.872], EP2: [1.969, 89.435],
    MKS2: [0.76, 174.815], MA2: [1.102, 39.45], MB2: [1.244, 101.15],
  };

  function brest(instant) {
    const T = (instant / 86400000 + 2440587.5 - 2451545) / 36525;
    const s = 218.3165 + 481267.8813 * T;
    const h = 280.4661 + 36000.7698 * T;
    const p = 83.3535 + 4069.0137 * T;
    const N = (125.0445 - 1934.1363 * T) * RAD;
    const p1 = 282.9384 + 1.7195 * T;
    const t = 180 + 15 * ((instant / 3600000) % 24);
    const fM2 = 1 - 0.037 * Math.cos(N), uM2 = -2.1 * Math.sin(N);
    const fK2 = 1.024 + 0.286 * Math.cos(N) + 0.008 * Math.cos(2 * N);
    const uK2 = -17.7 * Math.sin(N) + 0.7 * Math.sin(2 * N);
    const V = {
      M2: [2 * t - 2 * s + 2 * h, fM2, uM2], S2: [2 * t, 1, 0],
      N2: [2 * t - 3 * s + 2 * h + p, fM2, uM2], K2: [2 * t + 2 * h, fK2, uK2],
      "2N2": [2 * t - 4 * s + 2 * h + 2 * p, fM2, uM2], MU2: [2 * t - 4 * s + 4 * h, fM2, uM2],
      NU2: [2 * t - 3 * s + 4 * h - p, fM2, uM2], L2: [2 * t - s + 2 * h - p + 180, fM2, uM2],
      T2: [2 * t - h + p1, 1, 0], LAMBDA2: [2 * t - s + p + 180, fM2, uM2],
      R2: [2 * t + h - p1 + 180, 1, 0], EP2: [2 * t - 5 * s + 4 * h + p, fM2, uM2],
      MKS2: [2 * t - 2 * s + 4 * h, fM2 * fK2, uM2 + uK2], MA2: [2 * t - 2 * s + h, fM2, uM2],
      MB2: [2 * t - 2 * s + 3 * h, fM2, uM2],
    };
    let re = 0, im = 0;
    for (const k in BREST) {
      const [H, g] = BREST[k], [v, f, u] = V[k], a = (v + u - g) * RAD;
      re += f * H * Math.cos(a);
      im += f * H * Math.sin(a);
    }
    return { hauteur: re, coef: Math.round((Math.hypot(re, im) / 305) * 100) };
  }

  const heure = (ms) =>
    new Date(ms)
      .toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })
      .replace(":", "h");

  const W = 1000, HAUT = 70, BAS = 330;
  const maintenant = Date.now();
  const debut = maintenant - 12 * 3600000;
  const PAS = 10 * 60000;
  const points = [];
  for (let t = debut; t <= debut + 24 * 3600000; t += PAS) points.push({ t, ...brest(t) });
  const y = (cm) => BAS - ((cm + 400) / 800) * (BAS - HAUT); // ±4 m sur la hauteur
  const x = (t) => ((t - debut) / (24 * 3600000)) * 1000;

  let d = "";
  points.forEach((pt, i) => (d += (i ? "L" : "M") + x(pt.t).toFixed(1) + " " + y(pt.hauteur).toFixed(1)));

  const NS = "http://www.w3.org/2000/svg";
  const el = (nom, attrs, parent = svg) => {
    const e = document.createElementNS(NS, nom);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    parent.appendChild(e);
    return e;
  };

  svg.setAttribute("viewBox", `0 0 ${W} 480`);
  // L'eau sous la courbe, qui se fond vers le bas.
  const defs = el("defs", {});
  const degrade = el("linearGradient", { id: "eau", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el("stop", { offset: "0", "stop-color": "#37d3ea", "stop-opacity": "0.28" }, degrade);
  el("stop", { offset: "1", "stop-color": "#37d3ea", "stop-opacity": "0" }, degrade);
  el("path", { d: d + ` L1000 480 L0 480 Z`, fill: "url(#eau)" });
  const ligne = el("path", { d, class: "ride-trait" });

  // Les renversements : hautes et basses mers, avec leur coefficient.
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1].hauteur, b = points[i].hauteur, c = points[i + 1].hauteur;
    const haute = b > a && b >= c, basse = b < a && b <= c;
    if (!haute && !basse) continue;
    const px = x(points[i].t), py = y(b);
    if (px < 20 || px > 980) continue;
    el("circle", { cx: px, cy: py, r: 5, class: "ride-extreme" });
    // Près des bords, l'étiquette s'aligne vers l'intérieur pour ne pas sortir.
    const ancre = px < 170 ? "start" : px > 830 ? "end" : "middle";
    const txt = el("text", { x: px, y: haute ? py - 22 : py + 36, class: "ride-label", "text-anchor": ancre });
    txt.textContent = `${haute ? "Haute" : "Basse"} ${heure(points[i].t)} (${points[i].coef})`;
  }

  // Maintenant, au milieu de la marée.
  const ici = brest(maintenant);
  el("line", { x1: 500, x2: 500, y1: 20, y2: 460, class: "ride-now-trait" });
  el("circle", { cx: 500, cy: y(ici.hauteur), r: 11, class: "ride-now" });
  const etiquette = el("text", { x: 516, y: 40, class: "ride-now-label" });
  etiquette.textContent = `Maintenant, ${heure(maintenant)}`;

  const legende = document.querySelector("[data-coef]");
  if (legende) legende.textContent = String(ici.coef);
  const monte = brest(maintenant + 600000).hauteur > ici.hauteur;
  const sens = document.querySelector("[data-sens]");
  if (sens) sens.textContent = monte ? "de coefficient, la mer monte" : "de coefficient, la mer descend";

  // La ligne se trace quand on arrive dessus.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const longueur = ligne.getTotalLength();
  ligne.style.strokeDasharray = longueur;
  ligne.style.strokeDashoffset = longueur;
  ligne.getBoundingClientRect();
  ligne.style.transition = "stroke-dashoffset 2.4s cubic-bezier(.4,.1,.2,1)";
  new IntersectionObserver(([e], o) => {
    if (e.isIntersecting) { ligne.style.strokeDashoffset = "0"; o.disconnect(); }
  }, { threshold: 0.3 }).observe(svg);
})();
