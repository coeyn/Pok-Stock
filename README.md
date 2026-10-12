# Pok-Stock

Application de scan et d'inventaire de cartes Pokémon publiée sur GitHub Pages. Chaque utilisateur garde ses fiches et ses photos **dans son propre navigateur**, grâce à IndexedDB. Aucun compte ni serveur de stockage n'est nécessaire.

## Utiliser le site

Ouvrez [Pok-Stock](https://coeyn.github.io/Pok-Stock/), importez une ou plusieurs photos, vérifiez les cartes proposées par [TCGdex](https://tcgdex.dev/rest/cards), puis enregistrez la variante, l'état, la quantité et votre prix. Un bouton ouvre directement la fiche Cardmarket de la carte avec le filtre de langue française. Pour les anciennes fiches déjà enregistrées, le lien est corrigé lors du premier clic.

Le scanner ajoute rapidement les cartes sans demander de prix. Dans l'inventaire, cochez plusieurs cartes, saisissez un prix commun et cliquez sur **Appliquer** pour tarifer un lot de bulk en une seule fois.

L'outil lit le nom et le numéro dans des zones ciblées de la carte, puis compare son image à un index visuel des cartes du catalogue TCGdex. Si la lecture du texte échoue, la recherche par image propose quand même des cartes. Vérifiez la proposition avant de l'enregistrer. Les images importées restent dans votre navigateur ; seules les requêtes de catalogue sont envoyées à TCGdex. Une connexion Internet est nécessaire pour le premier chargement des modèles OCR, de l'index visuel et des fiches du catalogue. Les fiches déjà enregistrées restent consultables localement.

**Les données restent propres à ce navigateur et à cet appareil.** Un autre utilisateur n'y a pas accès. Si vous effacez les données du site ou changez de navigateur, l'inventaire ne suit pas automatiquement. Utilisez **Sauvegarde** dans l'inventaire pour exporter un JSON contenant les fiches et les scans, puis **Restaurer** pour le réimporter. L'export CSV contient les fiches sans les photos.

## Développement

Node.js 22+ est nécessaire.

```sh
npm ci
npm run dev
```

`npm test` exécute les vérifications de lecture du nom et du numéro. L'index visuel publié se trouve dans `public/card-features.json` ; `scripts/build_visual_index.py` permet de le régénérer à partir des images du catalogue.

`npm run build` génère le site statique dans `dist/`. Une action GitHub publie ce dossier sur GitHub Pages à chaque push sur `main`. Dans les paramètres du dépôt, choisissez **Pages → Build and deployment → Source: GitHub Actions** si ce n'est pas déjà activé.
