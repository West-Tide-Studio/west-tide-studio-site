/*
 * RideSeek — les 3 prochains jours d'un spot de surf ou d'une ville de parks
 * (9 nov. 2026). Le bloc est écrit par where2ride/scripts/lib/site.mjs
 * (blocPrevisions) ; ce script le remplit depuis Open-Meteo.
 *
 * Les règles sont celles du panneau de l'app (src/services/forecast-math.ts) :
 *   - matin 6h–12h, après-midi 12h–20h ; le matin du jour disparaît à 13h ;
 *   - le ciel d'une demi-journée est son code météo le plus fréquent ;
 *   - au-delà du code 48 (bruine, pluie, neige, orage), c'est « pluie » :
 *     le béton est impraticable ;
 *   - le vent est offshore s'il vient de la terre à 45° près, onshore s'il
 *     vient du large à 45° près, de travers entre les deux.
 *
 * Ce que l'app donne en plus (marée, meilleur créneau, jours suivants) reste
 * dans l'app : le bloc le montre flouté, avec un lien vers Google Play.
 */
(function () {
  const bloc = document.querySelector("[data-previsions]");
  if (!bloc) return;

  const d = bloc.dataset;
  const surf = d.previsions === "surf";
  const orientation = d.orientation ? +d.orientation : null;
  const play = bloc.querySelector(".prev-verrou")?.getAttribute("href") || "#";

  const MATIN = [6, 12];
  const APRES_MIDI = [12, 20];
  const MATIN_MASQUE_A = 13;

  const CARDINAUX = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];
  const cardinal = (deg) => CARDINAUX[Math.round(deg / 22.5) % 16];
  const ecart = (a, b) => { const x = Math.abs(a - b) % 360; return x > 180 ? 360 - x : x; };
  const virgule = (x, n = 1) => x.toFixed(n).replace(".", ",");
  const moyenne = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  /** La moyenne de directions : 350° et 10° font 0°, pas 180°. */
  const cap = (degs) => {
    const s = moyenne(degs.map((x) => Math.sin((x * Math.PI) / 180)));
    const c = moyenne(degs.map((x) => Math.cos((x * Math.PI) / 180)));
    return ((Math.atan2(s, c) * 180) / Math.PI + 360) % 360;
  };

  const ICONES = {
    soleil: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
    nuageux: '<circle cx="8.5" cy="8.5" r="3.5"/><path d="M8.5 2v1.5M2 8.5h1.5M3.9 3.9l1 1M13.1 3.9l-1 1"/><path d="M9 19.5h8.5a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6 1.4A2.8 2.8 0 0 0 9 19.5z"/>',
    tresNuageux: '<path d="M7 19h10.5a4 4 0 0 0 .4-8A6 6 0 0 0 6.4 12.6 3.2 3.2 0 0 0 7 19z"/>',
    pluie: '<path d="M7 15h10.5a4 4 0 0 0 .4-8A6 6 0 0 0 6.4 8.6 3.2 3.2 0 0 0 7 15z"/><path d="M8.5 18l-1 2.5M12.5 18l-1 2.5M16.5 18l-1 2.5"/>',
    neige: '<path d="M7 14h10.5a4 4 0 0 0 .4-8A6 6 0 0 0 6.4 7.6 3.2 3.2 0 0 0 7 14z"/><path d="M8.5 18h.01M12 20h.01M15.5 18h.01M10 21.5h.01M14 21.5h.01"/>',
    orage: '<path d="M7 14h10.5a4 4 0 0 0 .4-8A6 6 0 0 0 6.4 7.6 3.2 3.2 0 0 0 7 14z"/><path d="m12.5 15-2.5 4h3.5l-2 3.5"/>',
  };
  /** Le ciel, comme `sky` dans l'app ; neige et orage gardent leur icône, mais comptent comme pluie. */
  function ciel(code) {
    if (code === 0) return { cle: "soleil", mot: "Soleil", pluie: false };
    if (code <= 2) return { cle: "nuageux", mot: "Éclaircies", pluie: false };
    if (code <= 48) return { cle: "tresNuageux", mot: code >= 45 ? "Brouillard" : "Couvert", pluie: false };
    if (code >= 95) return { cle: "orage", mot: "Orage", pluie: true };
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { cle: "neige", mot: "Neige", pluie: true };
    return { cle: "pluie", mot: code <= 57 ? "Bruine" : "Pluie", pluie: true };
  }
  const icone = (c) =>
    `<svg class="prev-ciel prev-ciel-${c.cle}" viewBox="0 0 24 24" aria-hidden="true">${ICONES[c.cle]}</svg>`;

  /** Le code le plus fréquent ; à égalité, le plus mauvais temps. */
  function dominant(codes) {
    const n = new Map();
    for (const c of codes) n.set(c, (n.get(c) || 0) + 1);
    let best = null;
    for (const [c, k] of n) if (best == null || k > n.get(best) || (k === n.get(best) && c > best)) best = c;
    return best;
  }

  function relation(ventDeg) {
    if (orientation == null) return null;
    const depuisLaTerre = ecart(ventDeg, (orientation + 180) % 360);
    return depuisLaTerre <= 45 ? "offshore" : depuisLaTerre >= 135 ? "onshore" : "cross";
  }
  const MOTS_RELATION = { offshore: "offshore", cross: "de travers", onshore: "onshore" };

  /** L'heure et la date au spot, pas chez le visiteur : le fuseau vient d'Open-Meteo (outre-mer compris). */
  let aujourdhui, heure;
  function regler(fuseau) {
    const p = new Intl.DateTimeFormat("fr-CA", {
      timeZone: fuseau, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date()).reduce((o, x) => ((o[x.type] = x.value), o), {});
    aujourdhui = `${p.year}-${p.month}-${p.day}`;
    heure = +p.hour;
  }

  function nomDuJour(date) {
    const ecartJours = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${aujourdhui}T12:00:00Z`)) / 864e5);
    if (ecartJours === 0) return "Aujourd'hui";
    if (ecartJours === 1) return "Demain";
    const j = new Date(`${date}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", timeZone: "UTC" });
    return j.charAt(0).toUpperCase() + j.slice(1);
  }

  const params = `latitude=${d.lat}&longitude=${d.lon}&timezone=auto&forecast_days=3`;
  const demandes = [
    fetch(`https://api.open-meteo.com/v1/forecast?${params}&hourly=weather_code,temperature_2m,precipitation,wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh`).then((r) => r.json()),
  ];
  if (surf) {
    demandes.push(
      fetch(`https://marine-api.open-meteo.com/v1/marine?${params}&hourly=swell_wave_height,swell_wave_period,swell_wave_direction`).then((r) => r.json()),
    );
  }

  Promise.all(demandes)
    .then(([meteo, mer]) => {
      const h = meteo.hourly;
      if (!h?.time?.length) throw new Error("vide");
      try { regler(meteo.timezone || d.tz || "Europe/Paris"); } catch { regler("Europe/Paris"); }
      const m = mer?.hourly;
      // La houle est rangée par heure : la même heure que la météo, sinon rien.
      const iMer = new Map((m?.time || []).map((t, i) => [t, i]));

      /** Une demi-journée : ses heures entre [de, a[. */
      function demi(date, [de, a]) {
        const idx = [];
        h.time.forEach((t, i) => {
          const hh = +t.slice(11, 13);
          if (t.startsWith(date) && hh >= de && hh < a && h.weather_code[i] != null) idx.push(i);
        });
        if (!idx.length) return null;
        const res = {
          ciel: ciel(dominant(idx.map((i) => h.weather_code[i]))),
          temp: Math.round(Math.max(...idx.map((i) => h.temperature_2m[i]))),
          pluieMm: idx.reduce((s, i) => s + (h.precipitation[i] || 0), 0),
          vent: Math.round(moyenne(idx.map((i) => h.wind_speed_10m[i]))),
          ventDeg: cap(idx.map((i) => h.wind_direction_10m[i])),
        };
        if (surf && m) {
          const im = idx.map((i) => iMer.get(h.time[i])).filter((j) => j != null && m.swell_wave_height[j] != null);
          if (im.length) {
            res.houle = moyenne(im.map((j) => m.swell_wave_height[j]));
            res.periode = Math.round(moyenne(im.map((j) => m.swell_wave_period[j])));
            res.houleDeg = cap(im.map((j) => m.swell_wave_direction[j]));
          }
        }
        return res;
      }

      const dates = [...new Set(h.time.map((t) => t.slice(0, 10)))].slice(0, 3);
      const jours = dates.map((date) => {
        const estAujourdhui = date === aujourdhui;
        return {
          date,
          nom: nomDuJour(date),
          matin: estAujourdhui && heure >= MATIN_MASQUE_A ? null : demi(date, MATIN),
          apresMidi: estAujourdhui && heure >= APRES_MIDI[1] ? null : demi(date, APRES_MIDI),
          estAujourdhui,
        };
      });
      if (surf && !jours.some((j) => (j.matin || j.apresMidi)?.houle != null)) throw new Error("pas de houle");

      const fleche = (deg, titre) =>
        `<i class="prev-fleche" style="--r:${Math.round((deg + 180) % 360)}deg" title="${titre}" aria-hidden="true"></i>`;

      function ligne(nom, x) {
        if (!x) return "";
        const tete = `<p class="prev-demi-nom">${nom}<span>${icone(x.ciel)}${x.temp}°</span></p>`;
        if (surf) {
          const rel = relation(x.ventDeg);
          return `
            <div class="prev-demi">
              ${tete}
              ${x.houle != null ? `<p class="prev-mesure"><span class="banderole banderole-houle"><b>${virgule(x.houle)}</b>m<i>@</i><b>${x.periode}</b>s</span>${fleche(x.houleDeg, `Houle de ${cardinal(x.houleDeg)}`)}<small>${cardinal(x.houleDeg)}</small></p>` : ""}
              <p class="prev-mesure"><span class="banderole banderole-vent"><b>${x.vent}</b>km/h</span>${fleche(x.ventDeg, `Vent de ${cardinal(x.ventDeg)}`)}<small>${cardinal(x.ventDeg)}</small>${rel ? `<em class="prev-relation" data-relation="${rel}">${MOTS_RELATION[rel]}</em>` : ""}</p>
            </div>`;
        }
        return `
            <div class="prev-demi${x.ciel.pluie ? " is-pluie" : ""}">
              ${tete}
              <p class="prev-mesure prev-mesure-skate">
                <span class="prev-mot">${x.ciel.mot}</span>
                ${x.ciel.pluie && x.pluieMm >= 0.1 ? `<span class="prev-pluie">${virgule(x.pluieMm)} mm</span>` : ""}
                <span class="prev-vent">${fleche(x.ventDeg, `Vent de ${cardinal(x.ventDeg)}`)}${x.vent} km/h</span>
              </p>
            </div>`;
      }

      const cartes = jours
        .map(
          (j) => `
            <article class="prev-jour">
              <h3>${j.nom}</h3>
              ${ligne("Matin", j.matin)}
              ${ligne("Après-midi", j.apresMidi)}
              ${!j.matin && !j.apresMidi ? '<p class="prev-fini">La journée est finie.</p>' : ""}
              ${surf ? `<a class="prev-maree" href="${play}" data-prev-app="maree"><span>Marée</span><span class="prev-maree-flou" aria-hidden="true"></span><svg class="prev-cadenas" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/></svg><span class="sk-cache">dans l'app RideSeek</span></a>` : ""}
            </article>`,
        )
        .join("");

      const conteneur = bloc.querySelector("[data-prev-jours]");
      conteneur.querySelectorAll(".is-squelette").forEach((e) => e.remove());
      conteneur.insertAdjacentHTML("afterbegin", cartes);

      // Les parks : la ligne de l'app, « praticable » ou la première pluie.
      if (!surf) {
        const verdict = bloc.querySelector("[data-prev-verdict]");
        let pluie = null;
        for (const j of jours) {
          for (const [moitie, x] of [["matin", j.matin], ["après-midi", j.apresMidi]]) {
            if (!pluie && x?.ciel.pluie) pluie = { j, moitie };
          }
        }
        if (pluie) {
          const nom = pluie.j.nom === "Aujourd'hui" ? (pluie.moitie === "matin" ? "ce matin" : "cet après-midi") : `${pluie.j.nom.toLowerCase()} ${pluie.moitie}`;
          verdict.textContent = `Pluie annoncée : ${nom}`;
          verdict.dataset.etat = "pluie";
        } else {
          verdict.textContent = "Praticable ces 3 prochains jours";
          verdict.dataset.etat = "sec";
        }
        verdict.hidden = false;
      }
      bloc.classList.add("is-ready");
    })
    .catch(() => {
      bloc.classList.add("is-error");
      bloc.querySelectorAll(".is-squelette").forEach((e) => e.remove());
    });

  // Combien de visiteurs touchent ce qui est réservé à l'app, et quoi.
  bloc.addEventListener("click", (e) => {
    const lien = e.target.closest("[data-prev-app]");
    if (lien) window.posthog?.capture?.("previsions_app", { mode: d.previsions, cible: lien.dataset.prevApp });
  });
})();
