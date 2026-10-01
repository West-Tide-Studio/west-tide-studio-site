/*
 * La houle de l'accueil : des lignes de crête qui roulent vers la côte.
 *
 * Chaque ligne est une somme de deux sinusoïdes (la houle longue et le clapot),
 * décalée dans le temps : elles se dessinent une fois à l'arrivée, puis
 * ondulent lentement. Si le visiteur a demandé moins d'animations, elles
 * restent immobiles.
 */
(function () {
  const svg = document.querySelector(".swell-field");
  if (!svg) return;

  const NS = "http://www.w3.org/2000/svg";
  const LIGNES = 16;
  const W = 1440;
  const H = 900;
  const calme = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid slice");

  const lignes = [];
  for (let i = 0; i < LIGNES; i++) {
    const p = document.createElementNS(NS, "path");
    const k = i / (LIGNES - 1); // 0 = au large, 1 = près du bord
    // Les crêtes se resserrent et s'éclaircissent en approchant du rivage.
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", "#eaf1f2");
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("stroke-width", (0.6 + k * 1.4).toFixed(2));
    p.setAttribute("opacity", (0.06 + k * 0.22).toFixed(3));
    svg.appendChild(p);
    lignes.push({ el: p, k, base: 220 + Math.pow(k, 1.35) * 640, phase: i * 0.9 });
  }

  function crete(l, t) {
    const amp = 10 + l.k * 26;
    let d = "";
    for (let x = -40; x <= W + 40; x += 24) {
      const y =
        l.base +
        Math.sin(x * 0.0042 + t * 0.35 + l.phase) * amp +
        Math.sin(x * 0.011 - t * 0.6 + l.phase * 1.7) * amp * 0.28;
      d += (x === -40 ? "M" : "L") + x + " " + y.toFixed(1);
    }
    return d;
  }

  function dessiner(t) {
    for (const l of lignes) l.el.setAttribute("d", crete(l, t));
  }

  dessiner(0);
  if (calme) return;

  // L'arrivée : chaque crête se trace de gauche à droite, du large vers le bord.
  for (const l of lignes) {
    const longueur = l.el.getTotalLength();
    l.el.style.strokeDasharray = longueur;
    l.el.style.strokeDashoffset = longueur;
    l.el.style.transition = `stroke-dashoffset 2.2s cubic-bezier(.3,.6,.2,1) ${(l.k * 0.9).toFixed(2)}s`;
  }
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      for (const l of lignes) l.el.style.strokeDashoffset = "0";
    })
  );
  setTimeout(() => {
    for (const l of lignes) {
      l.el.style.transition = "";
      l.el.style.strokeDasharray = "";
      l.el.style.strokeDashoffset = "";
    }
  }, 3400);

  // Puis la houle roule, sans fin, et se met en pause hors de l'écran.
  let visible = true;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(svg);
  const debut = performance.now();
  (function boucle(now) {
    if (visible) dessiner((now - debut) / 1000);
    requestAnimationFrame(boucle);
  })(debut);
})();
