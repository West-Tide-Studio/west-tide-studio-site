/*
 * La carte des pages Surf (refaite le 9 nov. 2026, sur le modèle de
 * skateparks-recherche.js) : elle s'ouvre tout de suite avec tous les spots,
 * regroupés quand on dézoome, colorés par niveau. Au-dessus, une ville (ou un
 * code postal), « Autour de moi » et le filtre par niveau ; à côté, la liste
 * des spots visibles, qui suit la carte. Sur une page de côte (département,
 * province, région), la carte s'ouvre cadrée dessus.
 *
 * Les spots et leurs communes viennent de spots.json, fabriqué avec les pages
 * (where2ride/scripts/build-surf-pages.mjs). Les autres communes françaises
 * viennent de geo.api.gouv.fr, gratuit et sans clé : depuis Lyon, la carte
 * montre les spots les plus proches. La carte : Leaflet, Leaflet.markercluster
 * et les tuiles OpenStreetMap. Chaque recherche part dans PostHog
 * (`surf_recherche`) ; « Autour de moi » n'envoie pas la position.
 */
(() => {
  const bloc = document.querySelector("[data-recherche-surf]");
  if (!bloc) return;

  const champ = bloc.querySelector("input");
  const liste = bloc.querySelector(".sk-suggestions");
  const titre = bloc.querySelector(".sk-resultat-titre");
  const autour = bloc.querySelector(".sk-autour");
  const boutonMoi = bloc.querySelector("[data-moi]");
  const filtres = bloc.querySelectorAll("[data-niveau]");
  const zones = bloc.querySelector(".sk-zones");

  const LEAFLET = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/";
  const GRAPPES = "https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/";
  const PLAY = "https://play.google.com/store/apps/details?id=com.westtidestudio.rideseek&referrer=utm_source%3Dwesttidestudio%26utm_medium%3Dsite%26utm_campaign%3Dsurf";
  const RAYON = 30; // km : ce qu'on cadre autour d'une ville choisie
  const AU_MOINS = 3; // spots montrés même s'ils sont plus loin
  const MAX_LISTE = 40;
  const DEGROUPE = 13; // à ce zoom, chaque spot a son rond
  const ACCUEIL = "/rideseek/surf/";
  const METROPOLE = [[41.3, -5.2], [51.1, 9.6]];
  const NIVEAUX = { debutant: "Débutant", intermediaire: "Intermédiaire", confirme: "Confirmé", expert: "Expert" };
  // Les couleurs des pastilles de niveau, en plus franc pour la carte.
  const COULEURS = { debutant: "#3fae5a", intermediaire: "#19b5c9", confirme: "#f08a24", expert: "#e0503c" };
  const SANS_NIVEAU = "#8a94a8";

  let index = null;
  let suggestions = [];
  let actif = -1;
  let demande = 0;
  let niveau = "tous";
  let repere = null; // { nom, groupe, lat, lon } : la ville choisie, ou ma position
  let carte, grappe, calqueRepere, L;
  let spots = []; // { lat, lon, nom, niveau, lien, lieu, marqueur }
  let figee = false; // après un clic dans la liste, elle ne bouge plus tant qu'on ne touche pas la carte

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
  const nombre = (n) => n.toLocaleString("fr-FR");
  const itineraire = (s) => `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`;
  const garde = (s) => niveau === "tous" || s.niveau === niveau;
  const couleur = (s) => COULEURS[s.niveau] ?? SANS_NIVEAU;
  const pastille = (s) =>
    s.niveau ? `<span class="su-niveau su-niveau-${s.niveau}">${NIVEAUX[s.niveau]}</span>` : "";
  /** « spot », « spots », « spot débutant », « spots débutants »… */
  const mot = (n) => {
    const s = n > 1 ? "s" : "";
    return niveau === "tous" ? `spot${s}` : `spot${s} ${NIVEAUX[niveau].toLowerCase()}${s}`;
  };

  function chargerIndex() {
    index ??= fetch("/rideseek/surf/spots.json")
      .then((r) => r.json())
      .then((d) => ({ ...d, cles: d.lieux.map((l) => normal(l[0])) }));
    return index;
  }

  function charger(url, estCss) {
    return new Promise((ok, ko) => {
      const el = document.createElement(estCss ? "link" : "script");
      if (estCss) {
        el.rel = "stylesheet";
        el.href = url;
      } else {
        el.src = url;
        el.async = false;
      }
      el.onload = ok;
      el.onerror = ko;
      document.head.append(el);
    });
  }

  const chargerCarte = () =>
    Promise.all([
      charger(`${LEAFLET}leaflet.min.css`, true),
      charger(`${GRAPPES}MarkerCluster.min.css`, true),
      charger(`${LEAFLET}leaflet.min.js`).then(() => charger(`${GRAPPES}leaflet.markercluster.min.js`)),
    ]).then(() => window.L);

  // ---------------------------------------------------------------- la carte

  async function demarrer() {
    let donnees;
    try {
      [donnees, L] = await Promise.all([chargerIndex(), chargerCarte()]);
    } catch {
      titre.textContent = "La carte n'a pas pu se charger. Les listes plus bas restent là.";
      return;
    }
    const { lieux } = donnees;
    spots = donnees.spots.map(([lat, lon, nom, niv, lien, i]) => ({ lat, lon, nom, niveau: niv, lien, lieu: lieux[i] }));

    carte = L.map(bloc.querySelector(".sk-carte"), { scrollWheelZoom: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(carte);

    grappe = L.markerClusterGroup({
      chunkedLoading: true,
      showCoverageOnHover: false,
      maxClusterRadius: 40,
      disableClusteringAtZoom: DEGROUPE,
      iconCreateFunction: (g) => {
        const n = g.getChildCount();
        const taille = n < 10 ? 34 : n < 100 ? 40 : 48;
        return L.divIcon({ html: `<span>${n}</span>`, className: "sk-grappe", iconSize: [taille, taille] });
      },
    });
    for (const s of spots) {
      s.marqueur = L.circleMarker([s.lat, s.lon], {
        radius: 8,
        color: "#0b1d4a",
        weight: 2,
        fillColor: couleur(s),
        fillOpacity: 1,
      }).bindPopup(() => bulle(s));
    }
    filtrer();
    carte.addLayer(grappe);
    calqueRepere = L.layerGroup().addTo(carte);

    cadrerDepart();
    carte.on("moveend", () => figee || lister());
    // On reprend la carte en main : la liste la suit de nouveau.
    const libere = () => (figee = false);
    carte.on("dragstart", libere);
    grappe.on("clusterclick", libere);
    const fond = carte.getContainer();
    fond.addEventListener("wheel", libere, { passive: true });
    fond.addEventListener("dblclick", libere);
    fond.addEventListener("touchstart", (e) => e.touches.length > 1 && libere(), { passive: true });
    fond.addEventListener("click", (e) => e.target.closest(".leaflet-control-zoom") && libere());
    lister();
  }

  function bulle(s) {
    const d = repere ? ` · ${kmTexte(distanceKm(repere, s))}` : "";
    return `
      <div class="sk-bulle">
        ${pastille(s)}
        <strong>${echap(s.nom)}</strong>
        <span>${echap(s.lieu[0])}${d}</span>
        <span class="sk-bulle-liens">
          <a href="${s.lien}">Conditions du spot</a>
          <a rel="nofollow" href="${itineraire(s)}">Itinéraire</a>
        </span>
      </div>`;
  }

  function cadrerDepart() {
    const ici = location.pathname;
    if (ici !== ACCUEIL) {
      const miens = spots.filter((s) => s.lien.startsWith(ici));
      if (miens.length) {
        carte.fitBounds(L.latLngBounds(miens.map((s) => [s.lat, s.lon])), { padding: [24, 24], maxZoom: 12 });
        return;
      }
    }
    carte.fitBounds(METROPOLE);
    if (zones) zones.hidden = false;
  }

  zones?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-zone]");
    if (!b || !carte) return;
    const pays = b.dataset.zone;
    figee = false;
    if (pays === "france") return carte.fitBounds(METROPOLE);
    const miens = spots.filter((s) => s.lien.includes(`/${pays}/`));
    if (miens.length) carte.fitBounds(L.latLngBounds(miens.map((s) => [s.lat, s.lon])), { padding: [24, 24], maxZoom: 11 });
  });

  function filtrer() {
    grappe.clearLayers();
    grappe.addLayers(spots.filter(garde).map((s) => s.marqueur));
  }

  filtres.forEach((b) =>
    b.addEventListener("click", () => {
      niveau = b.dataset.niveau;
      filtres.forEach((f) => f.setAttribute("aria-pressed", String(f === b)));
      if (!carte) return;
      filtrer();
      lister();
    }),
  );

  const appli = `
        <li class="sk-autour-app">
          <span>La houle, le vent et la marée de chaque spot, heure par heure : c'est dans RideSeek.</span>
          <a href="${PLAY}">Télécharger</a>
        </li>`;

  /** La liste à côté de la carte : les spots visibles, du plus proche au plus loin. */
  function lister() {
    figee = false;
    const cadre = carte.getBounds();
    const c = carte.getCenter();
    const depuis = repere ?? { lat: c.lat, lon: c.lng };
    const visibles = [];
    spots.forEach((s, i) => {
      if (garde(s) && cadre.contains([s.lat, s.lon])) visibles.push({ s, i, d: distanceKm(depuis, s) });
    });
    visibles.sort((a, b) => a.d - b.d);

    const n = visibles.length;
    if (!n) {
      titre.textContent = `Aucun ${mot(1)} sur cette partie de la carte. Dézoome, ou cherche une ville.`;
    } else if (repere) {
      const de = repere.nom === "Ma position" ? "toi" : repere.nom;
      titre.textContent = `${nombre(n)} ${mot(n)} sur la carte, du plus proche au plus loin de ${de}`;
    } else if (n > MAX_LISTE) {
      titre.textContent = `${nombre(n)} ${mot(n)} sur la carte. Zoome, ou cherche ta ville.`;
    } else {
      titre.textContent = `${n} ${mot(n)} sur la carte`;
    }

    autour.innerHTML = visibles
      .slice(0, MAX_LISTE)
      .map(
        ({ s, i, d }, rang) => `
        <li>
          <button type="button" class="sk-autour-park" data-i="${i}">
            <span class="sk-point" style="background:${couleur(s)}" aria-hidden="true"></span>
            <span class="sk-autour-nom">
              <strong>${echap(s.nom)}</strong>
              <span>${echap(s.lieu[0])}${s.niveau ? ` · ${NIVEAUX[s.niveau]}` : ""}</span>
            </span>
            ${repere ? `<span class="sk-autour-km">${kmTexte(d)}</span>` : ""}
          </button>
          <a class="sk-autour-aller" href="${s.lien}" aria-label="Conditions du spot ${echap(s.nom)}">Le spot</a>
        </li>${rang === 4 ? appli : ""}`,
      )
      .join("");
  }

  // Un spot de la liste : la carte va dessus et ouvre sa bulle.
  autour.addEventListener("click", (e) => {
    const b = e.target.closest(".sk-autour-park");
    if (!b) return;
    const s = spots[+b.dataset.i];
    figee = true;
    autour.querySelectorAll(".is-choisi").forEach((x) => x.classList.remove("is-choisi"));
    b.parentElement.classList.add("is-choisi");
    // Pas grappe.zoomToShowLayer ni marqueur.openPopup : markercluster cherche
    // une icône, nos ronds n'en ont pas. La bulle s'ouvre donc sur la carte même.
    const ouvrir = () => L.popup({ offset: [0, -4] }).setLatLng([s.lat, s.lon]).setContent(bulle(s)).openOn(carte);
    const zoom = Math.max(carte.getZoom(), DEGROUPE);
    if (carte.getZoom() === zoom && carte.getBounds().pad(-0.1).contains([s.lat, s.lon])) ouvrir();
    else {
      carte.once("moveend", ouvrir);
      carte.setView([s.lat, s.lon], zoom);
    }
    if (matchMedia("(max-width: 899px)").matches) {
      bloc.querySelector(".sk-carte").scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });

  /** Une ville choisie (ou ma position) : la carte cadre 30 km autour, avec au moins 3 spots. */
  function allerA(lieu, declencheur) {
    repere = lieu;
    figee = false;
    calqueRepere.clearLayers();
    L.circleMarker([lieu.lat, lieu.lon], {
      radius: 7,
      color: "#fff",
      weight: 3,
      fillColor: "#1e6fd9",
      fillOpacity: 1,
    })
      .bindTooltip(lieu.nom)
      .addTo(calqueRepere);

    const proches = spots
      .filter(garde)
      .map((s) => ({ s, d: distanceKm(lieu, s) }))
      .sort((a, b) => a.d - b.d);
    const dedans = proches.filter((x) => x.d <= RAYON);
    const cadre = L.latLng(lieu.lat, lieu.lon).toBounds(RAYON * 2000);
    for (const { s } of proches.slice(0, AU_MOINS)) cadre.extend([s.lat, s.lon]);
    carte.fitBounds(cadre, { padding: [16, 16] });

    window.posthog?.capture?.("surf_recherche", {
      ville: declencheur === "position" ? null : lieu.nom,
      zone: lieu.groupe || null,
      rayon_km: RAYON,
      spots_trouves: dedans.length,
      plus_proche_km: proches.length ? Math.round(proches[0].d * 10) / 10 : null,
      declencheur,
    });
  }

  boutonMoi?.addEventListener("click", () => {
    if (!navigator.geolocation || !carte) return;
    const fin = () => {
      boutonMoi.disabled = false;
      boutonMoi.removeAttribute("aria-busy");
    };
    boutonMoi.disabled = true;
    boutonMoi.setAttribute("aria-busy", "true");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        fin();
        champ.value = "";
        allerA({ nom: "Ma position", groupe: "", lat: pos.coords.latitude, lon: pos.coords.longitude }, "position");
      },
      () => {
        fin();
        titre.textContent = "Position refusée ou introuvable. Tape plutôt ta ville.";
        champ.focus();
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  });

  // ---------------------------------------------------------------- suggestions

  async function chercher() {
    const brut = champ.value.trim();
    const q = normal(brut);
    const numero = ++demande;
    if (q.length < 2) return afficher([]);
    const chiffres = /^\d+$/.test(q);
    if (chiffres && q.length < 5) return afficher([]);

    const { lieux, cles } = await chargerIndex();
    const trouves = [];
    if (!chiffres) {
      const locaux = [];
      cles.forEach((cle, i) => {
        const rang = cle === q ? 0 : cle.startsWith(q) ? 1 : cle.includes(` ${q}`) ? 2 : -1;
        if (rang >= 0) locaux.push({ rang, i });
      });
      locaux.sort((a, b) => a.rang - b.rang || lieux[a.i][0].localeCompare(lieux[b.i][0], "fr"));
      for (const { i } of locaux.slice(0, 6)) {
        const [nom, groupe, lat, lon] = lieux[i];
        trouves.push({ nom, groupe, lat, lon });
      }
      if (numero === demande) afficher(trouves);
    }

    // Les communes françaises sans spot, et les codes postaux.
    try {
      const filtre = chiffres ? `codePostal=${q}` : `nom=${encodeURIComponent(brut)}`;
      const url = `https://geo.api.gouv.fr/communes?${filtre}&fields=nom,centre,departement&boost=population&limit=6`;
      const communes = await (await fetch(url)).json();
      if (numero !== demande) return;
      const deja = new Set(trouves.map((t) => normal(t.nom) + "|" + t.groupe));
      for (const c of communes) {
        if (!c.centre || !c.departement) continue;
        const groupe = `${c.departement.nom} (${c.departement.code})`;
        if (deja.has(normal(c.nom) + "|" + groupe)) continue;
        trouves.push({ nom: c.nom, groupe, lat: c.centre.coordinates[1], lon: c.centre.coordinates[0] });
      }
      afficher(trouves.slice(0, 8));
    } catch {
      // Sans le service de l'État, il reste les communes qui ont un spot.
    }
  }

  function afficher(items) {
    suggestions = items;
    actif = -1;
    liste.innerHTML = items
      .map(
        (s, i) =>
          `<li role="option" id="su-s-${i}" data-i="${i}"><strong>${echap(s.nom)}</strong> <span>${echap(s.groupe)}</span></li>`,
      )
      .join("");
    liste.hidden = !items.length;
    champ.setAttribute("aria-expanded", String(!!items.length));
    champ.removeAttribute("aria-activedescendant");
  }

  function surligner(i) {
    actif = i;
    liste.querySelectorAll("li").forEach((li, j) => li.classList.toggle("is-actif", j === i));
    if (i >= 0) champ.setAttribute("aria-activedescendant", `su-s-${i}`);
  }

  function choisir(s) {
    if (!s || !carte) return;
    champ.value = s.nom;
    afficher([]);
    champ.blur();
    allerA(s, "ville");
  }

  let attente;
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

  demarrer();
})();
