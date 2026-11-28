/*
 * RideSeek — « Les spots autour » sur la page d'un spot de surf : la houle et
 * le vent de maintenant sur chaque carte voisine, pour donner envie d'aller
 * voir celui qui marche.
 *
 * Mêmes sources et même règle que spot-live.js (Open-Meteo, vent comparé à
 * l'orientation du spot à 45° près). Un seul appel par API pour toutes les
 * cartes : Open-Meteo accepte plusieurs points séparés par des virgules.
 */
(function () {
  const cartes = [...document.querySelectorAll(".su-voisin[data-lat]")];
  if (!cartes.length) return;

  const CARDINAUX = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];
  const cardinal = (deg) => CARDINAUX[Math.round(deg / 22.5) % 16];
  const ecart = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  const NOMS = { offshore: "Offshore", cross: "Vent de travers", onshore: "Onshore" };

  const lat = cartes.map((c) => c.dataset.lat).join(",");
  const lon = cartes.map((c) => c.dataset.lon).join(",");
  const params = `latitude=${lat}&longitude=${lon}&timezone=auto`;
  const enListe = (r) => (Array.isArray(r) ? r : [r]);

  Promise.all([
    fetch(`https://api.open-meteo.com/v1/forecast?${params}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh`).then((r) => r.json()),
    fetch(`https://marine-api.open-meteo.com/v1/marine?${params}&current=swell_wave_height,swell_wave_period`).then((r) => r.json()),
  ])
    .then(([meteo, mer]) => {
      const vents = enListe(meteo), houles = enListe(mer);
      cartes.forEach((carte, i) => {
        const vent = vents[i]?.current, houle = houles[i]?.current;
        if (vent?.wind_speed_10m == null || houle?.swell_wave_height == null) return carte.classList.add("is-error");

        const [h, p] = carte.querySelectorAll(".su-voisin-houle b");
        h.textContent = houle.swell_wave_height.toFixed(1).replace(".", ",");
        p.textContent = Math.round(houle.swell_wave_period);

        const v = carte.querySelector(".su-voisin-vent");
        const kmh = `${Math.round(vent.wind_speed_10m)} km/h`;
        const o = carte.dataset.orientation;
        if (o == null) {
          v.textContent = `Vent ${cardinal(vent.wind_direction_10m)} ${kmh}`;
        } else {
          const depuisLaTerre = ecart(vent.wind_direction_10m, (+o + 180) % 360);
          const relation = depuisLaTerre <= 45 ? "offshore" : depuisLaTerre >= 135 ? "onshore" : "cross";
          v.textContent = `${NOMS[relation]} ${kmh}`;
          v.dataset.relation = relation;
        }
        carte.classList.add("is-ready");
      });
    })
    .catch(() => cartes.forEach((c) => c.classList.add("is-error")));
})();
