/*
 * RideSeek — un spot en direct : La Torche, maintenant.
 *
 * Les mêmes sources et la même règle que l'app : Open-Meteo pour la houle et
 * le vent, et le vent comparé à l'orientation du spot (270°, face à l'ouest)
 * — offshore s'il vient de la terre à 45° près, onshore s'il vient du large à
 * 45° près, de travers entre les deux (src/lib/orientation.ts).
 *
 * Les pages Surf (/rideseek/surf/) s'en servent pour leur spot : il est lu sur
 * la carte (data-lat, data-lon, data-orientation, data-tz). Sans orientation
 * connue, pas de verdict offshore / onshore.
 */
(function () {
  const carte = document.querySelector(".spot-live");
  if (!carte) return;

  const d = carte.dataset;
  const SPOT = d.lat
    ? { latitude: +d.lat, longitude: +d.lon, orientation: d.orientation ? +d.orientation : null, tz: d.tz || "Europe/Paris" }
    : { latitude: 47.8432, longitude: -4.3476, orientation: 270, tz: "Europe/Paris" };
  const CARDINAUX = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];
  const cardinal = (deg) => CARDINAUX[Math.round(deg / 22.5) % 16];
  const ecart = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  const champ = (nom) => carte.querySelector(`[data-live="${nom}"]`);
  const fleche = (nom, depuisDeg) => {
    // La flèche montre où va l'eau ou l'air : à l'opposé d'où ça vient.
    const el = carte.querySelector(`[data-fleche="${nom}"]`);
    if (el) el.style.setProperty("--r", `${(depuisDeg + 180) % 360}deg`);
  };

  const params = `latitude=${SPOT.latitude}&longitude=${SPOT.longitude}&timezone=${encodeURIComponent(SPOT.tz)}`;
  Promise.all([
    fetch(`https://api.open-meteo.com/v1/forecast?${params}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh`).then((r) => r.json()),
    fetch(`https://marine-api.open-meteo.com/v1/marine?${params}&current=swell_wave_height,swell_wave_period,swell_wave_direction`).then((r) => r.json()),
  ])
    .then(([meteo, mer]) => {
      const vent = meteo.current, houle = mer.current;
      if (vent?.wind_speed_10m == null || houle?.swell_wave_height == null) throw new Error("incomplet");

      champ("houle").textContent = houle.swell_wave_height.toFixed(1).replace(".", ",");
      champ("periode").textContent = Math.round(houle.swell_wave_period);
      champ("houle-dir").textContent = `Houle de secteur ${cardinal(houle.swell_wave_direction)}`;
      fleche("houle", houle.swell_wave_direction);

      champ("vent").textContent = Math.round(vent.wind_speed_10m);
      champ("vent-dir").textContent = `Vent de secteur ${cardinal(vent.wind_direction_10m)}`;
      fleche("vent", vent.wind_direction_10m);

      const verdict = champ("verdict");
      if (SPOT.orientation == null) {
        verdict.hidden = true;
      } else {
        const depuisLaTerre = ecart(vent.wind_direction_10m, (SPOT.orientation + 180) % 360);
        const relation = depuisLaTerre <= 45 ? "offshore" : depuisLaTerre >= 135 ? "onshore" : "cross";
        verdict.textContent = { offshore: "Offshore", cross: "Vent de travers", onshore: "Onshore" }[relation];
        verdict.dataset.relation = relation;
      }

      champ("heure").textContent = new Date().toLocaleTimeString("fr-FR", {
        hour: "2-digit", minute: "2-digit", timeZone: SPOT.tz,
      }).replace(":", "h");
      carte.classList.add("is-ready");
    })
    .catch(() => {
      carte.classList.add("is-error");
    });
})();
