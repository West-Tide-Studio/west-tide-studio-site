/*
 * RideSeek — les cartes « autour » des pages Surf et Skateparks : les
 * conditions de maintenant sur chaque voisin, pour donner envie d'aller voir
 * celui qui marche.
 *
 * - Surf (data-mode="surf") : houle et période, vent offshore / de travers /
 *   onshore, comparé à l'orientation du spot à 45° près (même règle que
 *   spot-live.js).
 * - Skate (data-mode="skate") : température, et le béton sec ou mouillé : il
 *   pleut maintenant, ou il est tombé de quoi mouiller dans les 3 dernières
 *   heures. Un park couvert reste sec.
 *
 * Un seul appel par API pour toutes les cartes : Open-Meteo accepte plusieurs
 * points séparés par des virgules.
 */
(function () {
  const liste = document.querySelector(".sk-voisins[data-mode]");
  if (!liste) return;
  const cartes = [...liste.querySelectorAll(".sk-voisin[data-lat]")];
  if (!cartes.length) return;
  const surf = liste.dataset.mode === "surf";

  const CARDINAUX = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];
  const cardinal = (deg) => CARDINAUX[Math.round(deg / 22.5) % 16];
  const ecart = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  const enListe = (r) => (Array.isArray(r) ? r : [r]);

  const params =
    `latitude=${cartes.map((c) => c.dataset.lat).join(",")}` +
    `&longitude=${cartes.map((c) => c.dataset.lon).join(",")}&timezone=auto`;
  const METEO = "https://api.open-meteo.com/v1/forecast?" + params;
  const appels = surf
    ? [
        fetch(`${METEO}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh`),
        fetch(`https://marine-api.open-meteo.com/v1/marine?${params}&current=swell_wave_height,swell_wave_period`),
      ]
    : [fetch(`${METEO}&current=temperature_2m,weather_code,precipitation&hourly=precipitation&past_hours=3&forecast_hours=1`)];

  const etat = (carte, cle, texte) => {
    const el = carte.querySelector(".sk-voisin-etat");
    el.textContent = texte;
    el.dataset.etat = cle;
  };

  function remplirSurf(carte, vent, houle) {
    if (vent?.wind_speed_10m == null || houle?.swell_wave_height == null) return false;
    const [h, p] = carte.querySelectorAll(".su-voisin-houle b");
    h.textContent = houle.swell_wave_height.toFixed(1).replace(".", ",");
    p.textContent = Math.round(houle.swell_wave_period);
    const kmh = `${Math.round(vent.wind_speed_10m)} km/h`;
    const o = carte.dataset.orientation;
    if (o == null) {
      carte.querySelector(".sk-voisin-etat").textContent = `Vent ${cardinal(vent.wind_direction_10m)} ${kmh}`;
    } else {
      const depuisLaTerre = ecart(vent.wind_direction_10m, (+o + 180) % 360);
      const relation = depuisLaTerre <= 45 ? "offshore" : depuisLaTerre >= 135 ? "onshore" : "cross";
      etat(carte, relation, `${{ offshore: "Offshore", cross: "Vent de travers", onshore: "Onshore" }[relation]} ${kmh}`);
    }
    return true;
  }

  function remplirSkate(carte, point) {
    const m = point?.current;
    if (m?.temperature_2m == null) return false;
    carte.querySelector(".sk-voisin-temp b").textContent = Math.round(m.temperature_2m);
    const code = m.weather_code ?? 0;
    const neige = (code >= 71 && code <= 77) || code === 85 || code === 86;
    const pluieMaintenant = code >= 51 || (m.precipitation ?? 0) > 0;
    const tombe = (point.hourly?.precipitation ?? []).reduce((t, x) => t + (x || 0), 0);
    const couvert = carte.hasAttribute("data-couvert");
    if (couvert) etat(carte, "sec", pluieMaintenant ? "Il pleut, park couvert" : "Sec, park couvert");
    else if (neige) etat(carte, "pluie", "Neige");
    else if (pluieMaintenant) etat(carte, "pluie", "Pluie en ce moment");
    else if (tombe >= 0.3) etat(carte, "mouille", "Sans doute mouillé");
    else etat(carte, "sec", "Sec, ça roule");
    return true;
  }

  Promise.all(appels.map((a) => a.then((r) => r.json())))
    .then(([a, b]) => {
      const A = enListe(a), B = b ? enListe(b) : [];
      cartes.forEach((carte, i) => {
        const ok = surf ? remplirSurf(carte, A[i]?.current, B[i]?.current) : remplirSkate(carte, A[i]);
        carte.classList.add(ok ? "is-ready" : "is-error");
      });
    })
    .catch(() => cartes.forEach((c) => c.classList.add("is-error")));
})();
