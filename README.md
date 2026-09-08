# West Tide Studio

Site vitrine de West Tide Studio, maison d'édition indépendante d'applications
mobiles basée à Nantes. HTML / CSS / JS statique, sans étape de build —
servi directement à la racine du repo (déploiement via l'intégration Git de
Hostinger vers `public_html`).

## Structure

```
index.html               page unique (accueil, apps, studio, contact)
mentions-legales.html    mentions légales (contenu placeholder)
confidentialite.html     politique de confidentialité (contenu placeholder)
cgu.html                 conditions générales d'utilisation (contenu placeholder)
css/styles.css           styles
js/main.js                menu mobile + année du footer
assets/logo-westtide.svg  logo complet (header)
assets/monogram-wts.svg   monogramme WTS (favicon, footer)
assets/images/            autres visuels (captures d'app, etc.)
```

## Développement local

```
python3 -m http.server 8000
```

puis ouvrir http://localhost:8000

## À compléter avant mise en ligne

- Contenu juridique réel des 3 pages légales (actuellement `[à compléter]`)
- URLs Instagram et LinkedIn dans le footer (`data-social="instagram"` / `"linkedin"`)
- Visuel(s) pour SpotScout une fois l'app plus avancée
