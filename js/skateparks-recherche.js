/*
 * La recherche par ville des pages Skateparks : on tape une ville, on la
 * choisit, la carte montre les parks à 5, 10 ou 20 km.
 *
 * Les parks et les communes qui en ont viennent de parks.json, fabriqué avec
 * les pages (where2ride/scripts/build-skatepark-pages.mjs). Les communes
 * françaises sans park viennent de geo.api.gouv.fr, gratuit et sans clé.
 * La carte : Leaflet et les tuiles OpenStreetMap, chargés au premier choix.
 */
(() => {
  const bloc = document.querySelector("[data-recherche]");
  if (!bloc) return;

  const champ = bloc.querySelector("input");
  const liste = bloc.querySelector(".sk-suggestions");
  const resultat = bloc.querySelector(".sk-resultat");
  const titre = bloc.querySelector(".sk-resultat-titre");
  const autour = bloc.querySelector(".sk-autour");
  const rayons = bloc.querySelectorAll("[data-km]");

  const LEAFLET = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/";
  const PLAY = "https://play.google.com/store/apps/details?id=com.westtidestudio.rideseek";
  const AU_MOINS = 3;

  let index = null;
  let suggestions = [];
  let actif = -1;
  let ville = null;
  let km = 10;
  let carte = null;
  let calque = null;
  let demande = 0;

  const normal = (t) =>
    t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[-'’]/g, " ").replace(/\s+/g, " ").trim();

  const echap = (t) =>
    String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const distanceKm = (a, b) => {
    const r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r;
    const dLon = (b.lon - a.lon) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  };

  const kmTexte = (d) => `${d < 10 ? d.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) : Math.round(d)} km`;

  function chargerIndex() {
    index ??= fetch("/rideseek/skateparks/parks.json")
      .then((r) => r.json())
      .then((d) => ({ ...d, cles: d.lieux.map((l) => normal(l[0])) }));
    return index;
  }

  // ---------------------------------------------------------------- suggestions

  async function chercher() {
    const q = normal(champ.value);
    const numero = ++demande;
    if (q.length < 2) return afficher([]);

    const { lieux, cles } = await chargerIndex();
    const locaux = [];
    cles.forEach((cle, i) => {
      const rang = cle === q ? 0 : cle.startsWith(q) ? 1 : cle.includes(` ${q}`) ? 2 : -1;
      if (rang >= 0) locaux.push({ rang, i });
    });
    locaux.sort((a, b) => a.rang - b.rang || lieux[a.i][0].localeCompare(lieux[b.i][0], "fr"));
    const trouves = locaux.slice(0, 6).map(({ i }) => {
      const [nom, groupe, lat, lon] = lieux[i];
      return { nom, groupe, lat, lon };
    });
    afficher(trouves);

    // Les communes françaises sans park : la carte montre alors les plus proches.
    try {
      const url = `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(champ.value.trim())}&fields=nom,centre,departement&boost=population&limit=6`;
      const communes = await (await fetch(url)).json();
      if (numero !== demande) return;
      const deja = new Set(trouves.map((t) => normal(t.nom) + "|" + t.groupe));
      for (const c of communes) {
        if (!c.centre) continue;
        const groupe = `${c.departement.nom} (${c.departement.code})`;
        if (deja.has(normal(c.nom) + "|" + groupe)) continue;
        trouves.push({ nom: c.nom, groupe, lat: c.centre.coordinates[1], lon: c.centre.coordinates[0] });
      }
      afficher(trouves.slice(0, 8));
    } catch {
      // Sans le service de l'État, il reste les communes qui ont un park.
    }
  }

  function afficher(items) {
    suggestions = items;
    actif = -1;
    liste.innerHTML = items
      .map(
        (s, i) =>
          `<li role="option" id="sk-s-${i}" data-i="${i}"><strong>${echap(s.nom)}</strong> <span>${echap(s.groupe)}</span></li>`,
      )
      .join("");
    liste.hidden = !items.length;
    champ.setAttribute("aria-expanded", String(!!items.length));
    champ.removeAttribute("aria-activedescendant");
  }

  function surligner(i) {
    actif = i;
    liste.querySelectorAll("li").forEach((li, j) => li.classList.toggle("is-actif", j === i));
    if (i >= 0) champ.setAttribute("aria-activedescendant", `sk-s-${i}`);
  }

  let attente;
  champ.addEventListener("focus", chargerIndex, { once: true });
  champ.addEventListener("input", () => {
    clearTimeout(attente);
    attente = setTimeout(chercher, 200);
  });
  champ.addEventListener("keydown", (e) => {
    if (liste.hidden) return;
    if (e.key === "ArrowDown") surligner(Math.min(actif + 1, suggestions.length - 1));
    else if (e.key === "ArrowUp") surligner(Math.max(actif - 1, 0));
    else if (e.key === "Enter") choisir(suggestions[Math.max(actif, 0)]);
    else if (e.key === "Escape") afficher([]);
    else return;
    e.preventDefault();
  });
  // mousedown plutôt que click : le champ ne perd pas la main avant le choix.
  liste.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    e.preventDefault();
    choisir(suggestions[+li.dataset.i]);
  });
  champ.addEventListener("blur", () => setTimeout(() => afficher([]), 100));

  // ---------------------------------------------------------------- la carte

  let leaflet;
  function chargerLeaflet() {
    leaflet ??= new Promise((ok, ko) => {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = `${LEAFLET}leaflet.min.css`;
      document.head.append(css);
      const js = document.createElement("script");
      js.src = `${LEAFLET}leaflet.min.js`;
      js.onload = () => ok(window.L);
      js.onerror = ko;
      document.head.append(js);
    });
    return leaflet;
  }

  function choisir(s) {
    if (!s) return;
    ville = s;
    champ.value = s.nom;
    afficher([]);
    champ.blur();
    resultat.hidden = false;
    dessiner();
  }

  rayons.forEach((b) =>
    b.addEventListener("click", () => {
      km = +b.dataset.km;
      rayons.forEach((r) => r.setAttribute("aria-pressed", String(r === b)));
      dessiner();
    }),
  );

  async function dessiner() {
    const [{ lieux, parks }, L] = await Promise.all([chargerIndex(), chargerLeaflet()]);
    const centre = { lat: ville.lat, lon: ville.lon };
    const tous = parks
      .map(([lat, lon, nom, pump, i]) => ({ lat, lon, nom, pump, lieu: lieux[i], d: distanceKm(centre, { lat, lon }) }))
      .sort((a, b) => a.d - b.d);
    const dedans = tous.filter((p) => p.d <= km);
    const montres = dedans.length ? dedans : tous.slice(0, AU_MOINS);

    titre.textContent = dedans.length
      ? `${dedans.length} park${dedans.length > 1 ? "s" : ""} à moins de ${km} km de ${ville.nom}`
      : `Aucun park à moins de ${km} km de ${ville.nom}. Les plus proches :`;

    autour.innerHTML =
      montres
        .map(
          (p) => `
        <li>
          <span class="sk-type sk-type-${p.pump ? "pump" : "skate"}">${p.pump ? "Pumptrack" : "Skatepark"}</span>
          <a href="${p.lieu[4]}">${echap(p.nom)} · ${echap(p.lieu[0])}</a>
          <span class="sk-autour-km">${kmTexte(p.d)}</span>
          <a class="sk-autour-aller" rel="nofollow" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}">Y aller</a>
        </li>`,
        )
        .join("") +
      `
        <li class="sk-autour-app">
          <span>La météo de chaque park, et s'il est praticable : c'est dans RideSeek.</span>
          <a href="${PLAY}">Télécharger l'app</a>
        </li>`;

    if (!carte) {
      carte = L.map(bloc.querySelector(".sk-carte"), { scrollWheelZoom: false });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(carte);
    }
    calque?.remove();
    calque = L.layerGroup().addTo(carte);
    const cercle = L.circle([centre.lat, centre.lon], {
      radius: km * 1000,
      color: "#1e6fd9",
      weight: 2,
      fillOpacity: 0.06,
    }).addTo(calque);
    L.circleMarker([centre.lat, centre.lon], { radius: 5, color: "#0b1d4a", fillOpacity: 1 }).addTo(calque);
    for (const p of montres) {
      L.circleMarker([p.lat, p.lon], {
        radius: 8,
        color: "#0b1d4a",
        weight: 2,
        fillColor: p.pump ? "#7cb342" : "#f08a24",
        fillOpacity: 1,
      })
        .bindPopup(
          `<strong>${echap(p.nom)}</strong><br>${echap(p.lieu[0])} · ${kmTexte(p.d)}<br>` +
            `<a rel="nofollow" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}">Y aller</a>`,
        )
        .addTo(calque);
    }
    const cadre = cercle.getBounds();
    for (const p of montres) cadre.extend([p.lat, p.lon]);
    carte.invalidateSize();
    carte.fitBounds(cadre, { padding: [16, 16] });
  }
})();
