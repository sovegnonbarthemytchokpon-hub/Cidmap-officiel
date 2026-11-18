# Cidmap

Application web statique avec un serveur d’API et des fonctions Supabase
sécurisées.

## Architecture

- `index.html`, `src/`, `components/`, `locales/` et `sfx/` constituent la
  partie navigateur.
- `server.js` contient les routes backend du projet. Les données privées et
  les vérifications d’identité y restent côté serveur.
- `supabase/functions/` contient les fonctions serveur qui exécutent les
  calculs, méthodes et contrôles d’accès protégés.
- `supabase/migrations/` contient les migrations SQL versionnées, notamment
  la structure multilingue des contenus administrables.
- `manifest.json`, `service-worker.js`, `pwa.htm` et
  `politique-confidentialite.html` sont les pages et fichiers PWA nécessaires.

Les adaptateurs JavaScript du navigateur ne calculent pas les résultats
protégés. Ils envoient une requête à une fonction Supabase et rendent la
réponse validée. Une panne réseau ne déclenche pas de formule locale de
secours.

Le client peut contenir une clé Supabase `publishable`/`anon`, car elle est
publique par conception et doit être limitée par les politiques RLS. Une clé
`service_role`, une clé Paystack secrète, un mot de passe ou un jeton privé ne
doit jamais être placé dans `index.html`, `src/` ou un fichier statique.

## Installation propre

Le runtime du projet n’utilise volontairement ni bundler ni dépendance npm :
les bibliothèques navigateur externes sont chargées par CDN et les fichiers
`.js`/`.ts` sont servis par la plateforme. Il n’y a donc pas de
`node_modules/` à conserver dans le projet.

Pour un futur ajout de dépendances outillées qui fournirait un
`package-lock.json`, utiliser de préférence :

```bash
npm ci
```

À défaut, utiliser `npm install`. Dans les deux cas, ne jamais archiver
`node_modules/`, les caches ou les fichiers `.env*`; ils sont déjà exclus par
`.gitignore`. Le projet actuel peut être exécuté sans `npm install`.

## Configuration serveur

Les secrets doivent être configurés dans l’environnement d’exécution ou dans
le tableau de bord Supabase, jamais dans le ZIP :

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY` ou `CIDMAP_SUPABASE_ANON_KEY` pour l’appel serveur
  authentifié au support
- les secrets Paystack et les autres variables propres aux fonctions
  Supabase

Les fonctions Supabase se déploient depuis `supabase/functions/`. La clé
`SUPABASE_SERVICE_ROLE_KEY` reste uniquement dans l’environnement des
fonctions et n’est jamais envoyée au navigateur. Pour les contenus
administrables, utilisez les colonnes JSONB `title_i18n`,
`description_i18n` et `action_label_i18n` avec des clés `fr`, `en`, `es`,
etc. Les anciennes colonnes texte restent le fallback français.

## Internationalisation

Le point d’entrée unique du navigateur est
`src/shared/translation.js`. Les vues utilisent `window.cidTranslation.t()`
pour les libellés et `window.cidTranslation.formatDate()` /
`formatNumber()` pour les valeurs formatées. La locale choisie est conservée
pour la session et, lorsqu’un compte est connecté, synchronisée avec le
profil. Les vues dynamiques se réaffichent après un changement de langue afin
de ne pas conserver un fragment généré dans la langue précédente.

Les contenus issus de Supabase ou de l’API peuvent utiliser l’un des formats
suivants :

```json
{
  "title_i18n": {
    "fr": "Titre français",
    "en": "English title",
    "es": "Título en español"
  },
  "title": "Titre français (fallback)"
}
```

Pour un nouveau champ administrable, conserver le même suffixe `_i18n` et
passer par `window.cidTranslation.field(record, "title")`. Si une traduction
manque, le runtime retombe dans l’ordre sur la langue française, puis sur la
valeur texte historique. La migration
`supabase/migrations/20260919_localized_promo_content.sql` ajoute les colonnes
multilingues des bannières ; les fonctions Supabase gardent un fallback
compatible avec une base qui n’a pas encore reçu cette migration.

## Déploiement Netlify + backend

Netlify héberge les fichiers publics et les fonctions présentes dans
`netlify/functions/`. Le fichier `netlify/functions/api.js` relaie les routes
`/api/*` vers le Worker Cloudflare qui exécute `server.js`. Le navigateur garde
ainsi des URLs relatives et aucun secret n’est ajouté au frontend.

Le backend doit être déployé séparément comme Worker Cloudflare avec
`wrangler.toml.example` comme modèle. Après sa publication, définir dans les
variables d’environnement Netlify :

```text
CIDMAP_BACKEND_URL=https://adresse-du-worker.workers.dev
```

Ne jamais remplacer `DATABASE_ID` dans le modèle par une valeur inventée :
il doit être l’identifiant de la base D1 réellement créée pour ce Worker.

## Contrôle avant export

Vérifier la taille et les fichiers à risque avant de créer le ZIP :

```bash
du -sh .
find . -type f \\( -name '*.log' -o -name '*.sqlite*' -o -name '*.db' \\) -print
find . -type f \\( -name '.env*' -o -name '*.pem' -o -name '*.key' \\) -print
```

Le ZIP doit être créé depuis le répertoire parent afin de ne pas s’inclure
lui-même :

```bash
cd ..
zip -r /tmp/cidmap-final.zip workspace \
  -x 'workspace/node_modules/*' \
     'workspace/.next/*' \
     'workspace/dist/*' \
     'workspace/build/*' \
     'workspace/.cache/*' \
     'workspace/uploads/*' \
     'workspace/supabase/.temp/*' \
     'workspace/*.zip' \
     'workspace/*.tar*' \
     'workspace/.env*'
```

Pour GitHub, commiter uniquement les sources et la configuration non secrète.
Les archives historiques, variantes de déploiement, bases locales, journaux
et uploads ne font pas partie de cette version nettoyée.
