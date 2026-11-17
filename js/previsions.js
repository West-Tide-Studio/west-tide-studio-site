/*
 * RideSeek — les 3 prochains jours d'un spot de surf ou d'une ville de parks,
 * dessinés comme dans l'app (17 nov. 2026). Le bloc est écrit par
 * where2ride/scripts/lib/site.mjs (blocPrevisions) ; ce script le remplit
 * depuis Open-Meteo.
 *
 * Surf : le panneau de la carte (src/components/spot-sheet.tsx). Les onglets
 * des 3 jours, puis la frise heure par heure : le vent en haut (flèche, force
 * sur une pastille verte quand il est offshore), un trait, les vagues en bas
 * (hauteur, période, flèche, puissance). La colonne au milieu est en
 * surbrillance, son détail est dessous ; l'onglet suit le défilement, et
 * toucher un onglet amène la frise sur son jour — l'heure en cours aujourd'hui,
 * 6h ensuite (colonneDOuverture). Les heures passées sont estompées.
 *
 * Parks : la bulle de l'app (weather-carousel.tsx). Une page par jour qu'on
 * fait glisser : l'instant pour aujourd'hui, puis matin et après-midi, avec
 * leurs fourchettes de température et de vent, et le ciel.
 *
 * Au-delà du 3e jour, la frise ou le carrousel continue en grisé, avec l'appel
 * à installer l'app : ce qui suit y reste.
 *
 * Les règles sont celles de l'app (src/services/forecast-math.ts) : matin
 * 6h–12h, après-midi 12h–20h, matin masqué à partir de 13h, pluie au-delà du
 * code 48, vent offshore à 45° près de la terre, puissance 0,49·H²·T.
 */
(function () {
  const bloc = document.querySelector("[data-previsions]");
  if (!bloc) return;

  const d = bloc.dataset;
  const surf = d.previsions === "surf";
  const orientation = d.orientation ? +d.orientation : null;
  const defile = bloc.querySelector("[data-prev-defile]");
  const contenu = bloc.querySelector("[data-prev-contenu]");
  const suite = bloc.querySelector("[data-prev-suite]");
  const ongletsBox = bloc.querySelector("[data-prev-onglets]");
  const plus = ongletsBox.querySelector("[data-prev-vers-suite]");
  const detail = bloc.querySelector("[data-prev-detail]");
  const play = suite?.getAttribute("href") || "#";

  /** La largeur d'une colonne, comme `COLUMN` dans l'app. */
  const COLONNE = 70;
  const MATIN = [6, 12];
  const APRES_MIDI = [12, 20];
  const MATIN_MASQUE_A = 13;
  const JOURS = 3;

  const CARDINAUX = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];
  const cardinal = (deg) => CARDINAUX[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
  const ecart = (a, b) => { const x = Math.abs(a - b) % 360; return x > 180 ? 360 - x : x; };
  const virgule = (x, n = 1) => x.toFixed(n).replace(".", ",");
  const heureTexte = (h) => `${String(h).padStart(2, "0")}h`;
  const cadenas = '<svg class="prev-cadenas" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/></svg>';

  /** La flèche `navigation` de l'app : elle pointe vers où va le vent ou la houle. */
  const fleche = (deg, titre) =>
    `<svg class="prev-fleche" viewBox="0 0 24 24" style="transform:rotate(${Math.round((deg + 180) % 360)}deg)" role="img" aria-label="${titre}"><path d="M12 2 4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>`;

  const ICONES = {
    soleil: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
    nuageux: '<circle cx="8.5" cy="8.5" r="3.5"/><path d="M8.5 2v1.5M2 8.5h1.5M3.9 3.9l1 1M13.1 3.9l-1 1"/><path d="M9 19.5h8.5a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6 1.4A2.8 2.8 0 0 0 9 19.5z"/>',
    tresNuageux: '<path d="M7 19h10.5a4 4 0 0 0 .4-8A6 6 0 0 0 6.4 12.6 3.2 3.2 0 0 0 7 19z"/>',
    pluie: '<path d="M7 15h10.5a4 4 0 0 0 .4-8A6 6 0 0 0 6.4 8.6 3.2 3.2 0 0 0 7 15z"/><path d="M8.5 18l-1 2.5M12.5 18l-1 2.5M16.5 18l-1 2.5"/>',
    neige: '<path d="M7 14h10.5a4 4 0 0 0 .4-8A6 6 0 0 0 6.4 7.6 3.2 3.2 0 0 0 7 14z"/><path d="M8.5 18h.01M12 20h.01M15.5 18h.01M10 21.5h.01M14 21.5h.01"/>',
    orage: '<path d="M7 14h10.5a4 4 0 0 0 .4-8A6 6 0 0 0 6.4 7.6 3.2 3.2 0 0 0 7 14z"/><path d="m12.5 15-2.5 4h3.5l-2 3.5"/>',
  };
  function ciel(code) {
    if (code === 0) return { cle: "soleil", mot: "Soleil", pluie: false };
    if (code <= 2) return { cle: "nuageux", mot: "Éclaircies", pluie: false };
    if (code <= 48) return { cle: "tresNuageux", mot: code >= 45 ? "Brouillard" : "Couvert", pluie: false };
    if (code >= 95) return { cle: "orage", mot: "Orage", pluie: true };
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { cle: "neige", mot: "Neige", pluie: true };
    return { cle: "pluie", mot: code <= 57 ? "Bruine" : "Pluie", pluie: true };
  }
  const icone = (c) =>
    `<span class="prev-ciel-mot"><svg class="prev-ciel prev-ciel-${c.cle}" viewBox="0 0 24 24" aria-hidden="true">${ICONES[c.cle]}</svg>${c.mot}</span>`;
  function dominant(codes) {
    const n = new Map();
    for (const c of codes) n.set(c, (n.get(c) || 0) + 1);
    let best = null;
    for (const [c, k] of n) if (best == null || k > n.get(best) || (k === n.get(best) && c > best)) best = c;
    return best;
  }
  const offshore = (ventDeg) => orientation != null && ventDeg != null && ecart(ventDeg, (orientation + 180) % 360) <= 45;

  /** L'heure et la date au spot, pas chez le visiteur. */
  let aujourdhui, heure;
  function regler(fuseau) {
    const p = new Intl.DateTimeFormat("fr-CA", {
      timeZone: fuseau, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date()).reduce((o, x) => ((o[x.type] = x.value), o), {});
    aujourdhui = `${p.year}-${p.month}-${p.day}`;
    heure = +p.hour;
  }
  /** « Mar. 17 », comme `dayLabel` dans l'app. */
  function nomOnglet(date) {
    const j = new Date(`${date}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "short", timeZone: "UTC" });
    return `${j.charAt(0).toUpperCase()}${j.slice(1)} ${Number(date.slice(8, 10))}`;
  }

  // -------------------------------------------------------------------------
  // Les onglets, et ce qui les relie au défilement.
  // -------------------------------------------------------------------------

  let onglets = [];
  function dessinerOnglets(dates, auClic) {
    ongletsBox.querySelectorAll(".is-squelette").forEach((e) => e.remove());
    onglets = dates.map((date, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "prev-onglet";
      b.setAttribute("role", "tab");
      b.textContent = nomOnglet(date);
      b.addEventListener("click", () => auClic(i));
      ongletsBox.insertBefore(b, plus);
      return b;
    });
    plus.setAttribute("role", "tab");
  }
  function ongletActif(i) {
    onglets.forEach((b, k) => b.setAttribute("aria-selected", String(k === i)));
    plus.setAttribute("aria-selected", String(i === onglets.length));
  }
  // « + de jours » amène d'abord la suite grisée ; c'est elle qui mène à l'app.
  plus.addEventListener("click", (e) => {
    if (!bloc.classList.contains("is-ready")) return;
    if (plus.getAttribute("aria-selected") === "true") return;
    e.preventDefault();
    defile.scrollTo({ left: suite.offsetLeft, behavior: "smooth" });
  });

  /** À la souris, la frise se tire comme au doigt ; un tirage n'est pas un clic. */
  function tirerALaSouris() {
    let depart = null;
    let bouge = false;
    defile.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      depart = { x: e.clientX, gauche: defile.scrollLeft };
      bouge = false;
    });
    window.addEventListener("pointermove", (e) => {
      if (!depart) return;
      const dx = e.clientX - depart.x;
      if (!bouge && Math.abs(dx) > 5) {
        bouge = true;
        defile.classList.add("is-tire");
      }
      if (bouge) defile.scrollLeft = depart.gauche - dx;
    });
    window.addEventListener("pointerup", () => {
      if (!depart) return;
      depart = null;
      if (bouge) {
        // Le magnétisme revient, et pose la frise sur une colonne entière.
        const gauche = defile.scrollLeft;
        defile.classList.remove("is-tire");
        defile.scrollLeft = gauche;
      }
    });
    defile.addEventListener("click", (e) => {
      if (bouge) {
        e.preventDefault();
        e.stopPropagation();
        bouge = false;
      }
    }, true);
    defile.addEventListener("dragstart", (e) => e.preventDefault());
  }

  // -------------------------------------------------------------------------
  // Les données.
  // -------------------------------------------------------------------------

  const params = `latitude=${d.lat}&longitude=${d.lon}&timezone=auto&forecast_days=${JOURS}`;
  const demandes = [
    fetch(
      `https://api.open-meteo.com/v1/forecast?${params}&wind_speed_unit=kmh&hourly=weather_code,temperature_2m,precipitation,wind_speed_10m,wind_direction_10m` +
        (surf ? "" : "&current=temperature_2m,wind_speed_10m,wind_direction_10m,weather_code"),
    ).then((r) => r.json()),
  ];
  if (surf) {
    demandes.push(
      fetch(
        `https://marine-api.open-meteo.com/v1/marine?${params}&hourly=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction,sea_surface_temperature`,
      ).then((r) => r.json()),
    );
  }

  Promise.all(demandes)
    .then(([meteo, mer]) => {
      const h = meteo.hourly;
      if (!h?.time?.length) throw new Error("vide");
      try { regler(meteo.timezone || d.tz || "Europe/Paris"); } catch { regler("Europe/Paris"); }
      const dates = [...new Set(h.time.map((t) => t.slice(0, 10)))].slice(0, JOURS);
      if (surf) frise(h, mer?.hourly, dates);
      else carrousel(h, meteo.current, dates);
      tirerALaSouris();
      bloc.classList.add("is-ready");
      // Le magnétisme revient avec la classe : la frise reste où elle a été posée.
      if (!surf) defile.scrollLeft = 0;
    })
    .catch(() => {
      bloc.classList.add("is-error");
      ongletsBox.querySelectorAll(".is-squelette").forEach((e) => e.remove());
    });

  // -------------------------------------------------------------------------
  // Surf : la frise.
  // -------------------------------------------------------------------------

  function frise(h, m, dates) {
    if (!m?.time?.length) throw new Error("pas de mer");
    const iMer = new Map(m.time.map((t, i) => [t, i]));
    const val = (serie, j) => (j == null || serie?.[j] == null ? null : serie[j]);
    const heures = h.time
      .map((t, i) => {
        const j = iMer.get(t);
        const vague = val(m.wave_height, j);
        const periode = val(m.wave_period, j);
        return {
          date: t.slice(0, 10),
          heure: +t.slice(11, 13),
          vent: h.wind_speed_10m[i],
          ventDeg: h.wind_direction_10m[i],
          vague,
          periode,
          vagueDeg: val(m.wave_direction, j),
          houle: val(m.swell_wave_height, j),
          houlePeriode: val(m.swell_wave_period, j),
          houleDeg: val(m.swell_wave_direction, j),
          puissance: vague != null && periode != null ? 0.49 * vague * vague * periode : null,
          eau: val(m.sea_surface_temperature, j),
        };
      })
      .filter((x) => dates.includes(x.date));
    if (!heures.some((x) => x.vague != null)) throw new Error("pas de houle");

    const debuts = dates.map((date) => heures.findIndex((x) => x.date === date));
    /** La dernière colonne qui ne dépasse pas une heure, comme `indexHeure`. */
    const colonneDe = (jour, hh) => {
      let k = debuts[jour];
      for (let i = debuts[jour]; i < heures.length && heures[i].date === dates[jour]; i++) if (heures[i].heure <= hh) k = i;
      return k;
    };
    const ouverture = (jour) => colonneDe(jour, dates[jour] === aujourdhui ? heure : MATIN[0]);
    const premiereAVenir = dates[0] === aujourdhui ? colonneDe(0, heure) : -1;

    contenu.innerHTML = heures
      .map((x, i) => {
        const nouveauJour = i > 0 && x.heure === 0;
        return `
          <button type="button" class="prev-col${i < premiereAVenir ? " is-passee" : ""}${nouveauJour ? " is-minuit" : ""}" data-i="${i}"${nouveauJour ? ` data-jour="${nomOnglet(x.date)}"` : ""} tabindex="-1">
            <span class="prev-col-heure">${heureTexte(x.heure)}</span>
            ${x.ventDeg != null ? fleche(x.ventDeg, `Vent de ${cardinal(x.ventDeg)}`) : '<span class="prev-fleche-vide"></span>'}
            <span class="prev-pastille${offshore(x.ventDeg) ? " is-offshore" : ""}">${x.vent != null ? `${Math.round(x.vent)} km/h` : "—"}</span>
            <span class="prev-trait"></span>
            <strong>${x.vague != null ? `${virgule(x.vague)} m` : "—"}</strong>
            <span class="prev-col-gris">${x.periode != null ? `${Math.round(x.periode)} s` : "—"}</span>
            ${x.vagueDeg != null ? fleche(x.vagueDeg, `Houle de ${cardinal(x.vagueDeg)}`) : '<span class="prev-fleche-vide"></span>'}
            <span class="prev-col-gris">${x.puissance != null ? (x.puissance < 1 ? "< 1 kW" : `${Math.round(x.puissance)} kW`) : "—"}</span>
          </button>`;
      })
      .join("");
    const colonnes = [...contenu.children];

    const mesure = (label, valeur, icone = "") =>
      `<div class="prev-mesure"><span>${label}</span><strong>${icone}${valeur}</strong></div>`;
    function montrerDetail(x) {
      const avecPeriode = (hauteur, periode) => `${virgule(hauteur)} m${periode != null ? ` · ${Math.round(periode)} s` : ""}`;
      detail.innerHTML = `
        <p class="prev-detail-titre">${nomOnglet(x.date)}, ${heureTexte(x.heure)}</p>
        <div class="prev-mesures">
          ${x.vague != null ? mesure("Vagues", avecPeriode(x.vague, x.periode), x.vagueDeg != null ? fleche(x.vagueDeg, `Vagues de ${cardinal(x.vagueDeg)}`) : "") : ""}
          ${x.houle != null ? mesure("Houle", avecPeriode(x.houle, x.houlePeriode), x.houleDeg != null ? fleche(x.houleDeg, `Houle de ${cardinal(x.houleDeg)}`) : "") : ""}
          ${x.puissance != null ? mesure("Puissance", x.puissance < 1 ? "< 1 kW/m" : `${Math.round(x.puissance)} kW/m`) : ""}
          ${x.eau != null ? mesure("Eau", `${Math.round(x.eau)}°`) : ""}
          ${mesure("Vent", `${Math.round(x.vent)} km/h ${cardinal(x.ventDeg)}${offshore(x.ventDeg) ? " · offshore" : ""}`, fleche(x.ventDeg, `Vent de ${cardinal(x.ventDeg)}`))}
          <a class="prev-mesure prev-mesure-app" href="${play}" data-prev-app="maree"><span>Marée</span><strong><span class="prev-maree-flou" aria-hidden="true"></span>${cadenas}<span class="sk-cache">dans l'app RideSeek</span></strong></a>
        </div>`;
    }

    // La colonne au milieu de la frise : la surbrillance, le détail, l'onglet.
    let active = -1;
    function suivre() {
      const milieu = defile.scrollLeft + defile.clientWidth / 2;
      const premiere = colonnes[0].offsetLeft;
      const i = Math.floor((milieu - premiere) / COLONNE);
      if (i >= colonnes.length) {
        if (active !== colonnes.length) {
          colonnes[active]?.classList.remove("is-active");
          active = colonnes.length;
          ongletActif(dates.length);
        }
        return;
      }
      const k = Math.max(0, i);
      if (k === active) return;
      colonnes[active]?.classList.remove("is-active");
      colonnes[k].classList.add("is-active");
      active = k;
      montrerDetail(heures[k]);
      let jour = 0;
      debuts.forEach((debut, j) => { if (debut <= k) jour = j; });
      ongletActif(jour);
    }
    let image = 0;
    defile.addEventListener("scroll", () => {
      if (!image) image = requestAnimationFrame(() => { image = 0; suivre(); });
    }, { passive: true });

    const aller = (k, doux = true) => defile.scrollTo({ left: colonnes[k].offsetLeft - colonnes[0].offsetLeft, behavior: doux ? "smooth" : "auto" });
    contenu.addEventListener("click", (e) => {
      const col = e.target.closest(".prev-col");
      if (col) aller(+col.dataset.i);
    });
    dessinerOnglets(dates, (j) => aller(ouverture(j)));
    aller(ouverture(0), false);
    suivre();
  }

  // -------------------------------------------------------------------------
  // Parks : le carrousel.
  // -------------------------------------------------------------------------

  function carrousel(h, maintenant, dates) {
    /** Une demi-journée, en fourchettes : « 8–12° », « 10–18 km/h ». */
    function demi(date, [de, a]) {
      const idx = [];
      h.time.forEach((t, i) => {
        const hh = +t.slice(11, 13);
        if (t.startsWith(date) && hh >= de && hh < a && h.weather_code[i] != null) idx.push(i);
      });
      if (!idx.length) return null;
      const s = Math.sin, c = Math.cos, rad = Math.PI / 180;
      const sx = idx.reduce((t, i) => t + s(h.wind_direction_10m[i] * rad), 0);
      const cx = idx.reduce((t, i) => t + c(h.wind_direction_10m[i] * rad), 0);
      const temps = idx.map((i) => h.temperature_2m[i]);
      const vents = idx.map((i) => h.wind_speed_10m[i]);
      return {
        ciel: ciel(dominant(idx.map((i) => h.weather_code[i]))),
        tMin: Math.round(Math.min(...temps)),
        tMax: Math.round(Math.max(...temps)),
        vMin: Math.round(Math.min(...vents)),
        vMax: Math.round(Math.max(...vents)),
        ventDeg: ((Math.atan2(sx, cx) / rad) + 360) % 360,
        pluieMm: idx.reduce((t, i) => t + (h.precipitation[i] || 0), 0),
      };
    }
    const fourchette = (a, b, unite) => (a === b ? `${a}${unite}` : `${a}–${b}${unite}`);
    const ligne = (titre, x) =>
      x
        ? `<div class="prev-ligne${x.ciel.pluie ? " is-pluie" : ""}">
              <span class="prev-ligne-nom">${titre}</span>
              <strong>${fourchette(x.tMin, x.tMax, "°")}</strong>
              <span class="prev-ligne-vent">${fleche(x.ventDeg, `Vent de ${cardinal(x.ventDeg)}`)}${fourchette(x.vMin, x.vMax, " km/h")}</span>
              ${icone(x.ciel)}${x.ciel.pluie && x.pluieMm >= 0.1 ? `<span class="prev-pluie">${virgule(x.pluieMm)} mm</span>` : ""}
            </div>`
        : "";

    const jours = dates.map((date) => ({
      date,
      estAujourdhui: date === aujourdhui,
      matin: date === aujourdhui && heure >= MATIN_MASQUE_A ? null : demi(date, MATIN),
      apresMidi: demi(date, APRES_MIDI),
    }));
    contenu.innerHTML = jours
      .map(
        (j) => `
            <div class="prev-page">
              ${
                j.estAujourdhui && maintenant
                  ? `<div class="prev-ligne prev-ligne-maintenant">
                <span class="prev-ligne-nom">Maintenant</span>
                <strong>${Math.round(maintenant.temperature_2m)}°</strong>
                <span class="prev-ligne-vent">${fleche(maintenant.wind_direction_10m, `Vent de ${cardinal(maintenant.wind_direction_10m)}`)}${Math.round(maintenant.wind_speed_10m)} km/h</span>
                ${icone(ciel(maintenant.weather_code))}
              </div>`
                  : ""
              }
              ${ligne("Matin", j.matin)}
              ${ligne("Après-midi", j.apresMidi)}
            </div>`,
      )
      .join("");
    const pages = [...contenu.children];

    // Le verdict de l'app : « praticable », ou la première pluie.
    const verdict = bloc.querySelector("[data-prev-verdict]");
    let pluie = null;
    for (const j of jours) {
      for (const [moitie, x] of [["matin", j.matin], ["après-midi", j.apresMidi]]) {
        if (!pluie && x?.ciel.pluie) pluie = { j, moitie };
      }
    }
    if (pluie) {
      const nom = pluie.j.estAujourdhui
        ? (pluie.moitie === "matin" ? "ce matin" : "cet après-midi")
        : `${nomOnglet(pluie.j.date).toLowerCase()} ${pluie.moitie}`;
      verdict.textContent = `Pluie annoncée : ${nom}`;
      verdict.dataset.etat = "pluie";
    } else {
      verdict.textContent = "Praticable ces 3 prochains jours";
      verdict.dataset.etat = "sec";
    }
    verdict.hidden = false;

    const largeur = () => defile.clientWidth;
    function suivre() {
      ongletActif(Math.min(pages.length, Math.round(defile.scrollLeft / largeur())));
    }
    let image = 0;
    defile.addEventListener("scroll", () => {
      if (!image) image = requestAnimationFrame(() => { image = 0; suivre(); });
    }, { passive: true });
    dessinerOnglets(dates, (i) => defile.scrollTo({ left: i * largeur(), behavior: "smooth" }));
    suivre();
  }

  // Combien de visiteurs touchent ce qui est réservé à l'app, et quoi.
  bloc.addEventListener("click", (e) => {
    const lien = e.target.closest("a[data-prev-app]");
    if (!lien || e.defaultPrevented) return;
    window.posthog?.capture?.("previsions_app", { mode: d.previsions, cible: lien.dataset.prevApp });
  });
})();
