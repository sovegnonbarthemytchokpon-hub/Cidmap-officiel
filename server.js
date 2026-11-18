/*
 * Legacy D1 compatibility routes.
 *
 * The current browser entry reads/writes public Croix nationale programmes
 * directly through Supabase (see src/croix/redCrossService.js). This D1
 * implementation remains only so an older published client does not break;
 * it is no longer called by the current source.
 */

const LINE_GROUPS = [
  [1, 2, 4], // 357-style alignment
  [3, 2, 8], // 159-style alignment
  [4, 6, 7], // 087-style alignment
];
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

// Navigation knowledge is deliberately small and descriptive. It tells the
// assistant which real surfaces exist, while catalogue rows and Supabase
// snapshots remain the only source for prices, access and results.
const CIDMAP_SITE_SURFACES = Object.freeze([
  { key: 'accueil', name: 'Accueil', purpose: 'publications et aperçu du site' },
  { key: 'categories', name: 'Catégories', purpose: 'navigation vers les méthodes et offres' },
  { key: 'croix', name: 'Croix nationale', purpose: 'méthode Croix nationale' },
  { key: 'matrice', name: 'Matrice', purpose: 'calcul de Matrice et production des 10 numéros' },
  { key: 'dechiffrement-mt', name: 'Déchiffrement MT', purpose: 'Déchiffrement Plus après les 10 numéros de la Matrice' },
  { key: 'rejected', name: 'Boules rejetées', purpose: 'consultation de la méthode Boules rejetées' },
  { key: 'anticipe', name: 'Anticipé', purpose: 'publications futures validées par un accès anticipé' },
  { key: 'resultat-aide', name: 'Résultat-Aide', purpose: 'résultats publiés, statistiques et transmission contrôlée' },
  { key: 'history', name: 'Historiques', purpose: 'archives accessibles selon les droits du compte' },
  { key: 'virtual-assistant', name: 'Cidmap virtuel', purpose: 'explication des données et aide à la navigation' },
  { key: 'account', name: 'Compte', purpose: 'profil, accès, solde et support' }
]);

/*
 * Stable teaching catalogue for the virtual assistant.
 *
 * The database remains authoritative for prices, access rights and live
 * values. This catalogue only explains the role of each deployed function,
 * so a newcomer can understand the architecture without exposing code,
 * secrets or private calculations.
 */
const CIDMAP_FUNCTION_KNOWLEDGE = Object.freeze([
  {
    key: 'admin-method-control',
    aliases: ['admin method control', 'method control', 'controle des methodes', 'contrôle des méthodes', 'big 1', 'big-01'],
    names: { fr: 'Contrôle des méthodes', en: 'Method control', es: 'Control de métodos', pt: 'Controlo de métodos', ar: 'التحكم في الطرق' },
    purpose: {
      fr: 'centralise les versions, les paramètres et les règles de génération des méthodes protégées.',
      en: 'centralizes versions, parameters and generation rules for protected methods.',
      es: 'centraliza las versiones, los parámetros y las reglas de generación de los métodos protegidos.',
      pt: 'centraliza versões, parâmetros e regras de geração dos métodos protegidos.',
      ar: 'يجمع إصدارات ومعايير وقواعد توليد الطرق المحمية.'
    },
    use: {
      fr: 'Il sert à maintenir une configuration cohérente pour que les autres fonctions utilisent la même règle de calcul.',
      en: 'It keeps configuration consistent so the other functions use the same calculation rules.',
      es: 'Mantiene una configuración coherente para que las demás funciones usen la misma regla de cálculo.',
      pt: 'Mantém uma configuração coerente para que as outras funções usem a mesma regra de cálculo.',
      ar: 'يحافظ على إعداد موحد حتى تستخدم الوظائف الأخرى قاعدة الحساب نفسها.'
    }
  },
  {
    key: 'subscription-access',
    aliases: ['subscription access', 'access control', 'gestion abonnement', 'accès abonnement', 'big 2', 'big-02'],
    names: { fr: 'Accès et abonnements', en: 'Subscription access', es: 'Acceso y suscripciones', pt: 'Acesso e subscrições', ar: 'الوصول والاشتراكات' },
    purpose: {
      fr: 'vérifie l’abonnement actif, les déblocages individuels, la durée et le programme réellement autorisé.',
      en: 'verifies the active subscription, individual unlocks, duration and programme actually authorized.',
      es: 'verifica la suscripción activa, los desbloqueos individuales, la duración y el programa realmente autorizado.',
      pt: 'verifica a subscrição ativa, os desbloqueios individuais, a duração e o programa realmente autorizado.',
      ar: 'يتحقق من الاشتراك النشط وعمليات الفتح الفردية والمدة والبرنامج المسموح به فعلياً.'
    },
    use: {
      fr: 'Un accès global peut inclure plusieurs tableaux ; un déblocage individuel reste limité au tableau indiqué.',
      en: 'A global entitlement may include several tables; an individual unlock remains limited to the named table.',
      es: 'Un acceso global puede incluir varias tablas; un desbloqueo individual se limita a la tabla indicada.',
      pt: 'Um acesso global pode incluir vários quadros; um desbloqueio individual fica limitado ao quadro indicado.',
      ar: 'قد يشمل الوصول العام عدة جداول، بينما يبقى الفتح الفردي محصوراً في الجدول المحدد.'
    }
  },
  {
    key: 'support-chat',
    aliases: ['support chat', 'chat support', 'assistant support', 'big 3', 'big-03'],
    names: { fr: 'Support et contexte du virtuel', en: 'Support and assistant context', es: 'Soporte y contexto del asistente', pt: 'Suporte e contexto do assistente', ar: 'الدعم وسياق المساعد' },
    purpose: {
      fr: 'rassemble les droits vérifiés, les tableaux autorisés, les publications et les statistiques nécessaires au virtuel.',
      en: 'collects verified rights, authorized tables, publications and statistics needed by the assistant.',
      es: 'reúne los derechos verificados, las tablas autorizadas, las publicaciones y las estadísticas necesarias para el asistente.',
      pt: 'reúne direitos verificados, quadros autorizados, publicações e estatísticas necessárias ao assistente.',
      ar: 'يجمع الحقوق المتحقق منها والجداول المسموح بها والمنشورات والإحصاءات اللازمة للمساعد.'
    },
    use: {
      fr: 'Il sépare toujours les données publiques des données privées et le tableau demandé des autres tableaux.',
      en: 'It always separates public data from private data and the requested table from other tables.',
      es: 'Siempre separa los datos públicos de los privados y la tabla solicitada de las demás tablas.',
      pt: 'Separa sempre os dados públicos dos privados e o quadro pedido dos outros quadros.',
      ar: 'يفصل دائماً البيانات العامة عن الخاصة والجدول المطلوب عن الجداول الأخرى.'
    }
  },
  {
    key: 'result-helf',
    aliases: ['result helf', 'resultat aide', 'résultat aide', 'result help', 'big 4', 'big-04'],
    names: { fr: 'Résultat-Aide', en: 'Result help', es: 'Ayuda de resultados', pt: 'Ajuda de resultados', ar: 'مساعدة النتائج' },
    purpose: {
      fr: 'reçoit, valide, publie et compare les résultats transmis.',
      en: 'receives, validates, publishes and compares submitted results.',
      es: 'recibe, valida, publica y compara los resultados enviados.',
      pt: 'recebe, valida, publica e compara os resultados enviados.',
      ar: 'يستقبل النتائج المرسلة ويتحقق منها وينشرها ويقارنها.'
    },
    use: {
      fr: 'Un résultat non validé reste en attente ; un résultat publié devient la base des statistiques publiques. Le pays de l’utilisateur ne bloque pas le pays du résultat demandé.',
      en: 'An unvalidated result stays pending; a published result becomes the basis for public statistics. The user country does not restrict the requested result country.',
      es: 'Un resultado no validado queda pendiente; un resultado publicado alimenta las estadísticas públicas. El país del usuario no limita el país solicitado.',
      pt: 'Um resultado não validado fica pendente; um resultado publicado alimenta as estatísticas públicas. O país do utilizador não limita o país pedido.',
      ar: 'تبقى النتيجة غير المتحقق منها معلقة، وتصبح النتيجة المنشورة أساس الإحصاءات العامة. بلد المستخدم لا يقيّد بلد النتيجة المطلوبة.'
    }
  },
  {
    key: 'program-runner',
    aliases: ['program runner', 'runner', 'exécuteur de programme', 'ejecutor de programas', 'big 5', 'big-05'],
    names: { fr: 'Exécuteur de programmes', en: 'Program runner', es: 'Ejecutor de programas', pt: 'Executor de programas', ar: 'منفذ البرامج' },
    purpose: {
      fr: 'lance un programme configuré sur une date, un pays et un horaire déterminés.',
      en: 'runs a configured programme for a defined date, country and draw time.',
      es: 'ejecuta un programa configurado para una fecha, un país y una hora determinados.',
      pt: 'executa um programa configurado para uma data, país e hora de sorteio definidos.',
      ar: 'يشغل برنامجاً مهيأً لتاريخ وبلد ووقت سحب محدد.'
    },
    use: {
      fr: 'Il orchestre l’exécution ; il ne décide pas à lui seul des droits d’accès ni de la publication.',
      en: 'It orchestrates execution; it does not decide access rights or publication by itself.',
      es: 'Orquesta la ejecución; no decide por sí solo los derechos de acceso ni la publicación.',
      pt: 'Orquestra a execução; não decide sozinho os direitos de acesso nem a publicação.',
      ar: 'ينسق التشغيل، لكنه لا يقرر وحده حقوق الوصول أو النشر.'
    }
  },
  {
    key: 'regen-daily',
    aliases: ['regen daily', 'daily regeneration', 'regénération quotidienne', 'regeneración diaria', 'big 6', 'big-06'],
    names: { fr: 'Régénération quotidienne', en: 'Daily regeneration', es: 'Regeneración diaria', pt: 'Regeneração diária', ar: 'التجديد اليومي' },
    purpose: {
      fr: 'prépare les programmes quotidiens selon le calendrier et les règles de génération.',
      en: 'prepares daily programmes according to the calendar and generation rules.',
      es: 'prepara los programas diarios según el calendario y las reglas de generación.',
      pt: 'prepara os programas diários segundo o calendário e as regras de geração.',
      ar: 'يجهز البرامج اليومية وفق التقويم وقواعد التوليد.'
    },
    use: {
      fr: 'Elle met à jour la journée prévue sans confondre la date de programme avec la date d’un tirage publié.',
      en: 'It updates the scheduled day without confusing the programme date with the date of a published draw.',
      es: 'Actualiza el día programado sin confundir la fecha del programa con la fecha de un sorteo publicado.',
      pt: 'Atualiza o dia programado sem confundir a data do programa com a data de um sorteio publicado.',
      ar: 'تحدث اليوم المبرمج دون الخلط بين تاريخ البرنامج وتاريخ السحب المنشور.'
    }
  },
  {
    key: 'regen-standby',
    aliases: ['regen standby', 'standby regeneration', 'régénération stand by', 'regeneración standby', 'big 7', 'big-07'],
    names: { fr: 'Régénération Stand-by', en: 'Stand-by regeneration', es: 'Regeneración Stand-by', pt: 'Regeneração Stand-by', ar: 'تجديد وضع الانتظار' },
    purpose: {
      fr: 'prépare ou renouvelle les sorties du programme Stand-by quand son cycle est actif.',
      en: 'prepares or renews Stand-by outputs when its cycle is active.',
      es: 'prepara o renueva las salidas de Stand-by cuando su ciclo está activo.',
      pt: 'prepara ou renova as saídas do Stand-by quando o seu ciclo está ativo.',
      ar: 'يجهز أو يجدد مخرجات وضع الانتظار عندما تكون دورته نشطة.'
    },
    use: {
      fr: 'Stand-by reste un programme séparé : ses données ne doivent pas être remplacées par celles d’Intuition ou d’Oracle.',
      en: 'Stand-by remains a separate programme: its data must not be replaced with Intuition or Oracle data.',
      es: 'Stand-by sigue siendo un programa separado: sus datos no deben sustituirse por los de Intuition u Oracle.',
      pt: 'Stand-by continua a ser um programa separado: os seus dados não devem ser substituídos pelos de Intuição ou Oracle.',
      ar: 'يبقى وضع الانتظار برنامجاً مستقلاً، ولا يجوز استبدال بياناته ببيانات الحدس أو أوراكل.'
    }
  },
  {
    key: 'smart-function',
    aliases: ['smart function', 'fonction intelligente', 'función inteligente', 'função inteligente', 'big 8', 'big-08'],
    names: { fr: 'Fonction intelligente', en: 'Smart function', es: 'Función inteligente', pt: 'Função inteligente', ar: 'الوظيفة الذكية' },
    purpose: {
      fr: 'applique une logique contrôlée et réutilisable aux calculs des programmes.',
      en: 'applies controlled, reusable logic to programme calculations.',
      es: 'aplica una lógica controlada y reutilizable a los cálculos de los programas.',
      pt: 'aplica uma lógica controlada e reutilizável aos cálculos dos programas.',
      ar: 'تطبق منطقاً مضبوطاً وقابلاً لإعادة الاستخدام على حسابات البرامج.'
    },
    use: {
      fr: 'Elle aide à uniformiser les entrées et les sorties ; elle ne contourne jamais l’accès d’un compte.',
      en: 'It helps standardize inputs and outputs; it never bypasses account access.',
      es: 'Ayuda a estandarizar entradas y salidas; nunca evita el control de acceso de una cuenta.',
      pt: 'Ajuda a uniformizar entradas e saídas; nunca contorna o acesso de uma conta.',
      ar: 'تساعد على توحيد المدخلات والمخرجات ولا تتجاوز أبداً صلاحيات الحساب.'
    }
  },
  {
    key: 'smart-processor',
    aliases: ['smart processor', 'procesador inteligente', 'processeur intelligent', 'processador inteligente', 'big 9', 'big-09'],
    names: { fr: 'Processeur intelligent', en: 'Smart processor', es: 'Procesador inteligente', pt: 'Processador inteligente', ar: 'المعالج الذكي' },
    purpose: {
      fr: 'enchaîne les étapes de traitement, de contrôle et de normalisation d’un calcul.',
      en: 'chains the processing, validation and normalization stages of a calculation.',
      es: 'encadena las etapas de procesamiento, validación y normalización de un cálculo.',
      pt: 'encadeia as etapas de processamento, validação e normalização de um cálculo.',
      ar: 'يربط مراحل معالجة الحساب والتحقق منه وتوحيده.'
    },
    use: {
      fr: 'Il prépare une sortie exploitable par l’interface et les statistiques, sans transformer une tendance en garantie.',
      en: 'It prepares output for the interface and statistics without turning a trend into a guarantee.',
      es: 'Prepara una salida utilizable por la interfaz y las estadísticas sin convertir una tendencia en garantía.',
      pt: 'Prepara uma saída utilizável pela interface e pelas estatísticas sem transformar uma tendência em garantia.',
      ar: 'يجهز مخرجات للواجهة والإحصاءات دون تحويل الاتجاه إلى ضمان.'
    }
  },
  {
    key: 'rejected-balls',
    aliases: ['rejected balls', 'boules rejetées', 'bolas rechazadas', 'bolas rejeitadas', 'big 10', 'big-10'],
    names: { fr: 'Boules rejetées', en: 'Rejected balls', es: 'Bolas rechazadas', pt: 'Bolas rejeitadas', ar: 'الكرات المستبعدة' },
    purpose: {
      fr: 'présente la méthode dédiée aux numéros ou boules écartés selon ses règles.',
      en: 'presents the method dedicated to numbers or balls excluded under its rules.',
      es: 'presenta el método dedicado a los números o bolas excluidos según sus reglas.',
      pt: 'apresenta o método dedicado aos números ou bolas excluídos segundo as suas regras.',
      ar: 'يعرض الطريقة الخاصة بالأرقام أو الكرات المستبعدة وفق قواعدها.'
    },
    use: {
      fr: 'C’est une section distincte de la Matrice et des Tableaux ; le virtuel peut expliquer la méthode sans inventer une valeur absente.',
      en: 'It is separate from Matrice and Tableaux; the assistant can explain the method without inventing a missing value.',
      es: 'Es una sección distinta de Matriz y Tablas; el asistente puede explicar el método sin inventar un valor ausente.',
      pt: 'É uma secção distinta da Matriz e dos Quadros; o assistente pode explicar o método sem inventar um valor ausente.',
      ar: 'إنه قسم مستقل عن المصفوفة والجداول، ويمكن للمساعد شرح الطريقة دون اختراع قيمة غير موجودة.'
    }
  },
  {
    key: 'calcule-universelle',
    aliases: ['calcule universelle', 'universelle', 'universal', 'cálculo universal', 'calculo universal', 'big 11', 'big-11'],
    names: { fr: 'Universelle', en: 'Universelle', es: 'Universal', pt: 'Universal', ar: 'العالمية' },
    purpose: {
      fr: 'propose une méthode générale de lecture et de calcul utilisable comme point de départ.',
      en: 'provides a general calculation and reading method that can serve as a starting point.',
      es: 'ofrece un método general de lectura y cálculo que puede servir como punto de partida.',
      pt: 'oferece um método geral de leitura e cálculo que pode servir como ponto de partida.',
      ar: 'تقدم طريقة عامة للقراءة والحساب يمكن استخدامها كنقطة بداية.'
    },
    use: {
      fr: 'Elle ne prouve pas qu’un autre tableau est inclus et ne crée pas un résultat qui n’est pas publié.',
      en: 'It does not prove that another table is included and cannot create an unpublished result.',
      es: 'No demuestra que otra tabla esté incluida y no puede crear un resultado no publicado.',
      pt: 'Não prova que outro quadro esteja incluído e não cria um resultado não publicado.',
      ar: 'لا تثبت أن جدولاً آخر مشمول ولا تنشئ نتيجة غير منشورة.'
    }
  },
  {
    key: 'calcul-intuition',
    aliases: ['calcul intuition', 'intuition', 'cálculo intuición', 'calculo intuição', 'big 12', 'big-12'],
    names: { fr: 'Intuition', en: 'Intuition', es: 'Intuición', pt: 'Intuição', ar: 'الحدس' },
    purpose: {
      fr: 'calcule le programme Intuition et expose sa publication lorsque le tableau est autorisé.',
      en: 'calculates the Intuition programme and exposes its publication when the table is authorized.',
      es: 'calcula el programa Intuición y muestra su publicación cuando la tabla está autorizada.',
      pt: 'calcula o programa Intuição e mostra a sua publicação quando o quadro está autorizado.',
      ar: 'تحسب برنامج الحدس وتعرض منشوره عندما يكون الجدول مسموحاً.'
    },
    use: {
      fr: 'Ses valeurs doivent rester séparées d’Universelle, Oracle, LNB, Balsa, Stand-by et Robot.',
      en: 'Its values must remain separate from Universelle, Oracle, LNB, Balsa, Stand-by and Robot.',
      es: 'Sus valores deben mantenerse separados de Universal, Oracle, LNB, Balsa, Stand-by y Robot.',
      pt: 'Os seus valores devem permanecer separados de Universal, Oracle, LNB, Balsa, Stand-by e Robot.',
      ar: 'يجب أن تبقى قيمها منفصلة عن العالمية وأوراكل وLNB وبالسا ووضع الانتظار وروبوت.'
    }
  },
  {
    key: 'calcul-oracle',
    aliases: ['calcul oracle', 'oracle', 'cálculo oracle', 'calculo oracle', 'big 13', 'big-13'],
    names: { fr: 'Oracle', en: 'Oracle', es: 'Oracle', pt: 'Oracle', ar: 'أوراكل' },
    purpose: {
      fr: 'calcule et publie le programme Oracle selon sa propre logique et son propre tableau.',
      en: 'calculates and publishes the Oracle programme using its own logic and table.',
      es: 'calcula y publica el programa Oracle con su propia lógica y tabla.',
      pt: 'calcula e publica o programa Oracle com a sua própria lógica e quadro.',
      ar: 'تحسب وتنشر برنامج أوراكل بمنطقه وجدوله الخاصين.'
    },
    use: {
      fr: 'Un accès Oracle donne les données Oracle autorisées, pas automatiquement les autres tableaux.',
      en: 'Oracle access gives authorized Oracle data, not the other tables automatically.',
      es: 'El acceso a Oracle da datos autorizados de Oracle, no las demás tablas automáticamente.',
      pt: 'O acesso ao Oracle dá dados Oracle autorizados, não os outros quadros automaticamente.',
      ar: 'يمنح الوصول إلى أوراكل بيانات أوراكل المسموح بها، وليس الجداول الأخرى تلقائياً.'
    }
  },
  {
    key: 'calcul-lnb',
    aliases: ['calcul lnb', 'lnb', 'cálculo lnb', 'calculo lnb', 'big 14', 'big-14'],
    names: { fr: 'LNB', en: 'LNB', es: 'LNB', pt: 'LNB', ar: 'LNB' },
    purpose: {
      fr: 'calcule le tableau LNB et conserve ses sorties dans son propre périmètre.',
      en: 'calculates the LNB table and keeps its outputs in its own scope.',
      es: 'calcula la tabla LNB y mantiene sus salidas en su propio ámbito.',
      pt: 'calcula o quadro LNB e mantém as suas saídas no seu próprio âmbito.',
      ar: 'تحسب جدول LNB وتحافظ على مخرجاته ضمن نطاقه الخاص.'
    },
    use: {
      fr: 'Le virtuel compare LNB uniquement avec les observations autorisées et identifiées comme LNB.',
      en: 'The assistant compares LNB only with observations authorized and identified as LNB.',
      es: 'El asistente compara LNB solo con observaciones autorizadas e identificadas como LNB.',
      pt: 'O assistente compara LNB apenas com observações autorizadas e identificadas como LNB.',
      ar: 'يقارن المساعد LNB فقط بالملاحظات المسموح بها والمحددة كـ LNB.'
    }
  },
  {
    key: 'calcul-balsa',
    aliases: ['calcul balsa', 'balsa plus', 'balsa', 'cálculo balsa', 'calculo balsa', 'big 15', 'big-15'],
    names: { fr: 'Balsa Plus', en: 'Balsa Plus', es: 'Balsa Plus', pt: 'Balsa Plus', ar: 'بالسا بلاس' },
    purpose: {
      fr: 'calcule le programme Balsa Plus avec ses sorties et indicateurs spécifiques.',
      en: 'calculates the Balsa Plus programme with its specific outputs and indicators.',
      es: 'calcula el programa Balsa Plus con sus salidas e indicadores específicos.',
      pt: 'calcula o programa Balsa Plus com as suas saídas e indicadores específicos.',
      ar: 'تحسب برنامج بالسا بلاس بمخرجاته ومؤشراته الخاصة.'
    },
    use: {
      fr: 'Les comparaisons Balsa restent séparées des autres programmes et dépendent des observations publiées.',
      en: 'Balsa comparisons stay separate from other programmes and depend on published observations.',
      es: 'Las comparaciones de Balsa permanecen separadas y dependen de observaciones publicadas.',
      pt: 'As comparações Balsa permanecem separadas e dependem de observações publicadas.',
      ar: 'تبقى مقارنات بالسا منفصلة عن البرامج الأخرى وتعتمد على الملاحظات المنشورة.'
    }
  },
  {
    key: 'calcul-standby',
    aliases: ['calcul standby', 'calcul stand by', 'stand-by', 'standby', 'cálculo standby', 'calculo standby', 'big 16', 'big-16'],
    names: { fr: 'Stand-by', en: 'Stand-by', es: 'Stand-by', pt: 'Stand-by', ar: 'وضع الانتظار' },
    purpose: {
      fr: 'calcule le programme Stand-by et ses publications séparées.',
      en: 'calculates the Stand-by programme and its separate publications.',
      es: 'calcula el programa Stand-by y sus publicaciones separadas.',
      pt: 'calcula o programa Stand-by e as suas publicações separadas.',
      ar: 'تحسب برنامج وضع الانتظار ومنشوراته المنفصلة.'
    },
    use: {
      fr: 'Il ne doit pas être mélangé avec l’Anticipé : l’Anticipé est un mode d’accès aux publications futures, pas un tableau.',
      en: 'It must not be confused with Anticipé: Anticipé is an access mode for future publications, not a table.',
      es: 'No debe confundirse con Anticipado: es un modo de acceso a publicaciones futuras, no una tabla.',
      pt: 'Não deve ser confundido com Antecipado: é um modo de acesso a publicações futuras, não um quadro.',
      ar: 'لا ينبغي الخلط بينه وبين الاستباقي؛ فالاستباقي طريقة وصول إلى منشورات مستقبلية وليس جدولاً.'
    }
  },
  {
    key: 'calcul-robot',
    aliases: ['calcul robot', 'robot', 'cálculo robot', 'calculo robot', 'big 17', 'big-17'],
    names: { fr: 'Robot', en: 'Robot', es: 'Robot', pt: 'Robot', ar: 'روبوت' },
    purpose: {
      fr: 'calcule le programme Robot et conserve ses résultats dans un flux identifié.',
      en: 'calculates the Robot programme and keeps its results in an identified stream.',
      es: 'calcula el programa Robot y conserva sus resultados en un flujo identificado.',
      pt: 'calcula o programa Robot e mantém os seus resultados num fluxo identificado.',
      ar: 'تحسب برنامج روبوت وتحافظ على نتائجه في تدفق محدد.'
    },
    use: {
      fr: 'Le virtuel ne remplace pas une sortie Robot par celle d’un autre programme.',
      en: 'The assistant never replaces a Robot output with another programme’s output.',
      es: 'El asistente nunca sustituye una salida de Robot por la de otro programa.',
      pt: 'O assistente nunca substitui uma saída do Robot pela de outro programa.',
      ar: 'لا يستبدل المساعد مخرج روبوت بمخرج برنامج آخر.'
    }
  },
  {
    key: 'dechiffrement-mt',
    aliases: ['dechiffrement mt', 'décriffement mt', 'dechiffrement plus', 'decrypt', 'big 18', 'big-18'],
    names: { fr: 'Déchiffrement Plus / MT', en: 'Déchiffrement Plus / MT', es: 'Descifrado Plus / MT', pt: 'Descodificação Plus / MT', ar: 'فك التشفير بلاس / MT' },
    purpose: {
      fr: 'reprend les 10 numéros de la Matrice pour organiser couples, correspondances et groupes autorisés.',
      en: 'uses the 10 Matrice numbers to organize authorized pairs, correspondences and groups.',
      es: 'usa los 10 números de la Matriz para organizar parejas, correspondencias y grupos autorizados.',
      pt: 'usa os 10 números da Matriz para organizar pares, correspondências e grupos autorizados.',
      ar: 'تستخدم أرقام المصفوفة العشرة لتنظيم الأزواج والمطابقات والمجموعات المسموح بها.'
    },
    use: {
      fr: 'Le parcours normal est Matrice → 10 numéros → Continuer → Déchiffrer maintenant.',
      en: 'The normal path is Matrice → 10 numbers → Continue → Decrypt now.',
      es: 'El recorrido normal es Matriz → 10 números → Continuar → Descifrar ahora.',
      pt: 'O percurso normal é Matriz → 10 números → Continuar → Descodificar agora.',
      ar: 'المسار الطبيعي هو المصفوفة ← عشرة أرقام ← متابعة ← فك التشفير الآن.'
    }
  },
  {
    key: 'history-access',
    aliases: ['history access', 'historique', 'historiques', 'archives', 'acceso al historial', 'big 19', 'big-19'],
    names: { fr: 'Accès aux historiques', en: 'History access', es: 'Acceso al historial', pt: 'Acesso ao histórico', ar: 'الوصول إلى السجل' },
    purpose: {
      fr: 'contrôle la recherche des archives publiques et des historiques protégés.',
      en: 'controls searches over public archives and protected historical data.',
      es: 'controla las búsquedas de archivos públicos y datos históricos protegidos.',
      pt: 'controla as pesquisas em arquivos públicos e dados históricos protegidos.',
      ar: 'يتحكم في البحث داخل الأرشيف العام والبيانات التاريخية المحمية.'
    },
    use: {
      fr: 'Une archive publique reste consultable ; une archive privée dépend du droit historique correspondant.',
      en: 'A public archive remains searchable; private history depends on the corresponding history entitlement.',
      es: 'Un archivo público sigue siendo consultable; el historial privado depende del derecho correspondiente.',
      pt: 'Um arquivo público continua pesquisável; o histórico privado depende do direito correspondente.',
      ar: 'يبقى الأرشيف العام قابلاً للبحث، بينما يعتمد السجل الخاص على صلاحية السجل المناسبة.'
    }
  },
  {
    key: 'referral-reward',
    aliases: ['referral reward', 'parrainage', 'referral', 'recompensa', 'recompensa por referencia', 'big 20', 'big-20'],
    names: { fr: 'Récompense de parrainage', en: 'Referral reward', es: 'Recompensa por recomendación', pt: 'Recompensa por referência', ar: 'مكافأة الإحالة' },
    purpose: {
      fr: 'enregistre les événements de parrainage et applique les récompenses prévues par la configuration.',
      en: 'records referral events and applies rewards defined by the configuration.',
      es: 'registra eventos de recomendación y aplica las recompensas definidas por la configuración.',
      pt: 'regista eventos de referência e aplica as recompensas definidas pela configuração.',
      ar: 'يسجل أحداث الإحالة ويطبق المكافآت المحددة في الإعدادات.'
    },
    use: {
      fr: 'La récompense dépend des règles publiées ; elle ne donne pas automatiquement accès à un tableau privé.',
      en: 'The reward depends on published rules; it does not automatically grant access to a private table.',
      es: 'La recompensa depende de las reglas publicadas; no concede automáticamente acceso a una tabla privada.',
      pt: 'A recompensa depende das regras publicadas; não dá automaticamente acesso a um quadro privado.',
      ar: 'تعتمد المكافأة على القواعد المنشورة ولا تمنح تلقائياً الوصول إلى جدول خاص.'
    }
  }
]);

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS cross_generations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    programme_date TEXT NOT NULL UNIQUE,
    generated_year INTEGER NOT NULL,
    generated_month INTEGER NOT NULL,
    scope_key TEXT NOT NULL,
    term TEXT NOT NULL,
    removed_digits TEXT NOT NULL,
    date_sum INTEGER NOT NULL,
    date_digit_sum INTEGER NOT NULL,
    date_finishing_digit INTEGER NOT NULL,
    visible_terminaison TEXT NOT NULL,
    assignment TEXT NOT NULL,
    alignments TEXT NOT NULL,
    signature TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(scope_key, signature)
  );
`;

const REFERRAL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS referral_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    referral_code TEXT NOT NULL UNIQUE,
    visit_points INTEGER NOT NULL DEFAULT 0,
    share_points INTEGER NOT NULL DEFAULT 0,
    stars INTEGER NOT NULL DEFAULT 0,
    referred_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS referral_visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    visitor_key TEXT NOT NULL,
    referrer_code TEXT NOT NULL,
    child_code TEXT,
    created_at TEXT NOT NULL,
    registered_at TEXT,
    UNIQUE(referrer_code, visitor_key)
  );
  CREATE TABLE IF NOT EXISTS referral_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    event_key TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    referrer_code TEXT,
    created_at TEXT NOT NULL
  );
`;

const MESSAGES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS site_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    user_cid TEXT NOT NULL,
    username TEXT,
    email TEXT,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'received',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_site_messages_user
    ON site_messages(user_id, created_at);
`;

/*
 * Platform configuration tables (source of truth for display data).
 *
 * These tables hold the ONLY administration-owned configuration that the
 * front-end is allowed to display. The browser never holds a local copy or a
 * hardcoded fallback: every list (abonnements, tarifs étoiles/jetons,
 * bannières, grilles de numéros valides) is rendered straight from these
 * rows. Rows have no `user_id` column because they are server-authored
 * configuration, not visitor content — a moderation ban must never delete
 * them.
 */
export const schema = `
  CREATE TABLE IF NOT EXISTS config_plans (
    slug TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    unlock_currency TEXT NOT NULL DEFAULT 'stars',
    required_stars INTEGER NOT NULL DEFAULT 0,
    required_tokens INTEGER NOT NULL DEFAULT 0,
    duration_days INTEGER NOT NULL DEFAULT 30,
    referral_reward_stars INTEGER NOT NULL DEFAULT 1,
    price_label TEXT NOT NULL DEFAULT '',
    features TEXT NOT NULL DEFAULT '[]',
    payment_mode TEXT NOT NULL DEFAULT 'manual',
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS config_star_prices (
    country_code TEXT PRIMARY KEY,
    country_name TEXT NOT NULL DEFAULT '',
    currency_code TEXT NOT NULL DEFAULT '',
    currency_symbol TEXT NOT NULL DEFAULT '',
    price_per_star REAL NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS config_token_prices (
    country_code TEXT PRIMARY KEY,
    country_name TEXT NOT NULL DEFAULT '',
    currency_code TEXT NOT NULL DEFAULT '',
    currency_symbol TEXT NOT NULL DEFAULT '',
    price_per_token REAL NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS config_payment (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    payment_mode TEXT NOT NULL DEFAULT 'manual',
    online_provider TEXT NOT NULL DEFAULT '',
    online_payment_link TEXT NOT NULL DEFAULT '',
    physical_instructions TEXT NOT NULL DEFAULT '',
    contact_label TEXT NOT NULL DEFAULT '',
    manual_enabled INTEGER NOT NULL DEFAULT 1,
    currency_mode TEXT NOT NULL DEFAULT 'both',
    contact_channel TEXT NOT NULL DEFAULT 'chat',
    whatsapp_number TEXT NOT NULL DEFAULT '',
    chat_label TEXT NOT NULL DEFAULT 'Contacter l’équipe',
    updated_at TEXT NOT NULL
  );
  INSERT OR IGNORE INTO config_payment (id, updated_at)
    VALUES (1, '1970-01-01T00:00:00.000Z');
  CREATE TABLE IF NOT EXISTS config_comment_rules (
    rule_key TEXT PRIMARY KEY,
    comments_enabled INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
  INSERT OR IGNORE INTO config_comment_rules (rule_key, comments_enabled, updated_at)
    VALUES ('global', 0, '1970-01-01T00:00:00.000Z');
  CREATE TABLE IF NOT EXISTS config_locks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_type TEXT NOT NULL DEFAULT 'cross',
    target_key TEXT NOT NULL DEFAULT '',
    country_code TEXT NOT NULL DEFAULT '',
    unlock_currency TEXT NOT NULL DEFAULT 'stars',
    required_stars INTEGER NOT NULL DEFAULT 0,
    required_tokens INTEGER NOT NULL DEFAULT 0,
    plan_slug TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS config_banners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL DEFAULT 'ad',
    placement TEXT NOT NULL DEFAULT 'homepage',
    day INTEGER,
    exact_date TEXT,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    title_i18n TEXT NOT NULL DEFAULT '{}',
    description_i18n TEXT NOT NULL DEFAULT '{}',
    image_url TEXT NOT NULL DEFAULT '',
    target_url TEXT NOT NULL DEFAULT '',
    action_label TEXT NOT NULL DEFAULT '',
    action_label_i18n TEXT NOT NULL DEFAULT '{}',
    sort_order INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS config_grids (
    module TEXT PRIMARY KEY,
    grid_min INTEGER NOT NULL DEFAULT 1,
    grid_max INTEGER NOT NULL DEFAULT 90,
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );
  INSERT OR IGNORE INTO config_grids (module, grid_min, grid_max, enabled, updated_at)
    VALUES ('tableaux', 1, 90, 1, '1970-01-01T00:00:00.000Z');
  CREATE TABLE IF NOT EXISTS tableaux_grid_assignments (
    grid_key TEXT PRIMARY KEY,
    display_name TEXT NOT NULL DEFAULT '',
    plan_slug TEXT NOT NULL DEFAULT '',
    formula_tier TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    CHECK (formula_tier IS NULL OR formula_tier IN ('essentiel', 'avance', 'integral'))
  );
  CREATE TABLE IF NOT EXISTS config_daily_illustrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    day INTEGER,
    exact_date TEXT,
    image_url TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL DEFAULT '',
    locale_code TEXT NOT NULL DEFAULT 'fr',
    summary TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chat_sessions_user
    ON chat_sessions(user_id, updated_at);
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'virtual-assistant',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chat_messages_session
    ON chat_messages(session_id, id);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_user
    ON chat_messages(user_id, created_at);
  CREATE TABLE IF NOT EXISTS chat_knowledge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    intent TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    keywords TEXT NOT NULL DEFAULT '',
    priority INTEGER NOT NULL DEFAULT 100,
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chat_knowledge_enabled
    ON chat_knowledge(enabled, priority DESC, updated_at DESC);
  INSERT INTO chat_knowledge
    (intent, question, answer, keywords, priority, enabled, updated_at)
  SELECT
    'resultat-aide-satellites-permutations',
    'Comment Résultat-Aide évalue-t-il les satellites, combinaisons, permutations et répétitions ?',
    'Référence métier persistante : après chaque tirage réel publié, Résultat-Aide compare séparément chaque tableau autorisé avec les snapshots du même pays à J+0, J+1, J+2, J+3 et J+7. Il conserve la date de proposition, la date du tirage, le décalage, le jour de proposition et le jour du tirage. Un satellite est évalué séparément. Chaque combinaison de deux numéros est évaluée séparément et réussit seulement si ses deux numéros sont retrouvés. Le satellite et toutes ses combinaisons forment aussi une permutation : pour 90 avec 27+63 et 23+67, l’ensemble est 90,27,63,23,67 et la permutation réussit à partir de deux numéros distincts retrouvés. La permutation, le satellite et les combinaisons gardent des statistiques séparées. Seuls les tirages published sont utilisés ; pending, rejected et disputed sont exclus. Les observations sont filtrées par tableau autorisé et doivent rester historiques, jamais une garantie.',
    'resultat-aide satellites combinaison permutation satellite 90 27 63 23 67 rejoue répétition J+1 J+2 J+3 J+7 published observation historique',
    9000,
    1,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE NOT EXISTS (
    SELECT 1 FROM chat_knowledge
    WHERE intent = 'resultat-aide-satellites-permutations'
  );
`;

const TABLEAUX_GRID_CATALOG = Object.freeze([
  ['universal', 'Universelle'],
  ['intuition', 'Intuition'],
  ['oracle', 'Oracle'],
  ['lnb', 'LNB'],
  ['balsa', 'Balsa Plus'],
  ['standby', 'Stand-by'],
  ['created', 'Programmes personnalisés']
]);

function normalizeFormulaTier(value) {
  const key = String(value || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return ['essentiel', 'avance', 'integral'].includes(key) ? key : '';
}

async function ensureCurrencyMode(env) {
  const columns = [
    ["currency_mode", "TEXT NOT NULL DEFAULT 'both'"],
    ["contact_channel", "TEXT NOT NULL DEFAULT 'chat'"],
    ["whatsapp_number", "TEXT NOT NULL DEFAULT ''"],
    ["chat_label", "TEXT NOT NULL DEFAULT 'Contacter l’équipe'"]
  ];
  for (const [name, definition] of columns) {
    try {
      await env.DB.exec(`ALTER TABLE config_payment ADD COLUMN ${name} ${definition}`);
    } catch (_) {
      // Colonne déjà présente (bases existantes) : aucune action requise.
    }
  }
}

async function ensureBannerLocalization(env) {
  const columns = [
    ['title_i18n', "TEXT NOT NULL DEFAULT '{}'"],
    ['description_i18n', "TEXT NOT NULL DEFAULT '{}'"],
    ['action_label_i18n', "TEXT NOT NULL DEFAULT '{}'"]
  ];
  for (const [name, definition] of columns) {
    try {
      await env.DB.exec(`ALTER TABLE config_banners ADD COLUMN ${name} ${definition}`);
    } catch (_) {
      // Column already exists on current installations.
    }
  }
}

async function ensureTableauxAssignments(env) {
  await env.DB.exec(schema);
  await ensureCurrencyMode(env);
  await ensureBannerLocalization(env);
  // Add the direct offer association to installations created before the
  // subscription sections were made database-driven.
  try {
    await env.DB.exec(`
      ALTER TABLE tableaux_grid_assignments
      ADD COLUMN plan_slug TEXT NOT NULL DEFAULT ''
    `);
  } catch (_) {
    // The column already exists on current installations.
  }
  // The original seed opened comments globally. Migrate only that untouched
  // seed marker; an administrator's later explicit choice must be preserved.
  await env.DB.prepare(`
    UPDATE config_comment_rules
    SET comments_enabled = 0
    WHERE rule_key = 'global'
      AND comments_enabled <> 0
      AND updated_at = '1970-01-01T00:00:00.000Z'
  `).run();
  const count = await env.DB.prepare(
    'SELECT COUNT(*) AS count FROM tableaux_grid_assignments'
  ).first('count');
  if (Number(count) > 0) return;
  const now = new Date().toISOString();
  await env.DB.batch(TABLEAUX_GRID_CATALOG.map(([key, label]) => env.DB.prepare(`
    INSERT OR IGNORE INTO tableaux_grid_assignments
      (grid_key, display_name, formula_tier, enabled, updated_at)
    VALUES (?, ?, NULL, 1, ?)
  `).bind(key, label, now)));
}

/*
 * Chat can be the first D1-backed feature opened on an older installation.
 * Keep its schema self-healing instead of relying on an administrator route
 * having been visited first. The platform applies `schema` on new databases,
 * while this also covers databases created by previous revisions.
 */
async function ensureVirtualChatSchema(env) {
  await env.DB.exec(schema);
  await ensureCurrencyMode(env);
  try {
    await env.DB.exec(`
      ALTER TABLE tableaux_grid_assignments
      ADD COLUMN plan_slug TEXT NOT NULL DEFAULT ''
    `);
  } catch (_) {
    // The column already exists on current installations.
  }
  /*
   * A previous staging check inserted a literal test answer into the live
   * knowledge table. Remove only that known fixture so it cannot outrank the
   * real assistant knowledge for visitors.
   */
  await env.DB.prepare(`
    DELETE FROM chat_knowledge
    WHERE lower(trim(question)) = lower(?)
      AND lower(trim(answer)) = lower(?)
  `).bind(
    'Quelle est la règle test unique ?',
    'Réponse officielle de test.'
  ).run();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function cleanReferralCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9_-]{3,40}$/.test(code) ? code : "";
}

function cleanVisitorKey(value) {
  const key = String(value || "").trim();
  return /^[A-Za-z0-9._:-]{8,180}$/.test(key) ? key : "";
}

function referralState(row) {
  return {
    referralCode: row?.referral_code || null,
    sharePoints: Math.max(0, Number(row?.share_points) || 0),
    stars: Math.max(0, Number(row?.stars) || 0),
    referredBy: row?.referred_by || null,
  };
}

function referralActor(request, accountCode) {
  // The Websim identity header is authoritative when available. Local
  // profiles are supported as a compatibility fallback for this legacy app.
  return request.headers.get("x-websim-user-id") || `local:${accountCode}`;
}

function cleanMessageCid(value) {
  const cid = String(value || "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{3,79}$/.test(cid) ? cid : "";
}

function cleanMessageText(value, maxLength) {
  return String(value || "").replace(/\r\n/g, "\n").trim().slice(0, maxLength);
}

function messageActor(request, input = {}) {
  const websimUserId = String(request.headers.get("x-websim-user-id") || "").trim();
  const cid = cleanMessageCid(input.cid);
  // The local profile is the compatibility authentication used by this
  // legacy app. Websim's trusted identity takes precedence when available.
  if (websimUserId) {
    return {
      userId: websimUserId,
      cid: cid || `websim-${websimUserId.slice(0, 64)}`,
      username: String(request.headers.get("x-websim-username") || "").trim().slice(0, 80),
    };
  }
  if (!cid) return null;
  return {
    userId: `local:${cid}`,
    cid,
    username: cleanMessageText(input.name, 80),
  };
}

function messageFromRow(row) {
  return {
    id: row.id,
    subject: row.subject,
    body: row.body,
    status: row.status,
    createdAt: row.created_at,
  };
}

async function messagesApi(request, env) {
  await env.DB.exec(MESSAGES_SCHEMA);

  if (request.method === "GET") {
    const url = new URL(request.url);
    const websimUserId = String(request.headers.get("x-websim-user-id") || "").trim();
    const cid = cleanMessageCid(url.searchParams.get("cid"));
    const userId = websimUserId || (cid ? `local:${cid}` : "");
    if (!userId) return json({ error: "Connexion requise pour consulter vos messages" }, 401);

    const { results } = await env.DB.prepare(`
      SELECT id, subject, body, status, created_at
      FROM site_messages
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 30
    `).bind(userId).all();
    return json({ ok: true, messages: (results || []).map(messageFromRow) });
  }

  if (request.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  let input;
  try {
    input = await request.json();
  } catch (_) {
    return json({ error: "JSON invalide" }, 400);
  }

  const actor = messageActor(request, input);
  if (!actor) return json({ error: "Connectez-vous pour envoyer un message" }, 401);

  const subject = cleanMessageText(input.subject, 100);
  const body = cleanMessageText(input.body, 4000);
  const email = cleanMessageText(input.email, 160);
  if (!body) return json({ error: "Écrivez votre message avant de l'envoyer" }, 400);
  if (body.length < 3) return json({ error: "Le message est trop court" }, 400);

  const now = new Date().toISOString();
  const saved = await env.DB.prepare(`
    INSERT INTO site_messages
      (user_id, user_cid, username, email, subject, body, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'received', ?)
  `).bind(
    actor.userId,
    actor.cid,
    actor.username || cleanMessageText(input.name, 80),
    email,
    subject || "Message sans sujet",
    body,
    now,
  ).run();

  return json({
    ok: true,
    message: {
      id: saved?.meta?.last_row_id || null,
      subject: subject || "Message sans sujet",
      body,
      status: "received",
      createdAt: now,
    },
  }, 201);
}

function requestBearerToken(request) {
  const value = String(request.headers.get('authorization') || '').trim();
  return /^Bearer\s+\S+$/i.test(value) ? value : '';
}

async function readAuthoritativeSupabaseContext(request, env) {
  const authorization = requestBearerToken(request);
  if (!authorization) return null;
  const supabaseUrl = String(
    env?.SUPABASE_URL || env?.CIDMAP_SUPABASE_URL || ''
  ).trim();
  const supabaseAnonKey = String(
    env?.SUPABASE_ANON_KEY || env?.CIDMAP_SUPABASE_ANON_KEY || ''
  ).trim();
  if (!supabaseUrl || !supabaseAnonKey) return { unavailable: true };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/support-chat`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        apikey: supabaseAnonKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ action: 'state', localeCode: 'fr' }),
      signal: controller.signal
    });
    let payload = {};
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok || payload?.error || !payload?.access) {
      return { unavailable: true };
    }
    return {
      access: payload.access,
      assistantContext: payload.assistantContext || {},
      user: payload.access.user || null
    };
  } catch (_) {
    return { unavailable: true };
  } finally {
    clearTimeout(timeoutId);
  }
}

function mergeAuthoritativeChatContext(clientContext, authoritative) {
  if (!authoritative?.access || authoritative.unavailable) {
    return {
      ...(clientContext || {}),
      accessVerification: authoritative?.unavailable ? 'unavailable' : 'trusted-platform'
    };
  }
  const access = authoritative.access;
  const assistantContext = authoritative.assistantContext || {};
  const subscription = access.subscription || null;
  const authorizedPrograms = Array.isArray(access.scope?.authorizedPrograms)
    ? access.scope.authorizedPrograms
    : [];
  return {
    ...(clientContext || {}),
    dataSource: 'supabase',
    accessVerification: 'supabase',
    userId: access.user?.id || '',
    userRole: access.isAdmin
      ? 'admin'
      : access.isModerator
        ? 'moderator'
        : access.canHelp
          ? 'subscriber'
          : 'non-subscriber',
    subscriptionTier: subscription?.planName || '',
    subscriptionStatus: subscription ? 'active' : 'none',
    today: assistantContext.currentDate || clientContext?.today || '',
    userCountry: assistantContext.userCountry || access.user?.country || '',
    allowedPrograms: authorizedPrograms,
    assistantAccess: access,
    subscription: subscription
      ? {
        name: subscription.planName || '',
        expiresAt: subscription.expiresAt || null
      }
      : null,
    publishedResults: Array.isArray(assistantContext.publishedResults)
      ? assistantContext.publishedResults
      : [],
    publicStatistics: {
      suggestions: Array.isArray(assistantContext.allProgramStatistics)
        ? assistantContext.allProgramStatistics
        : [],
      daySuggestions: Array.isArray(assistantContext.dayProgramStatistics)
        ? assistantContext.dayProgramStatistics
        : []
    },
    currentPrograms: Array.isArray(assistantContext.currentPrograms)
      ? assistantContext.currentPrograms
      : [],
    assistantContext
  };
}

function chatClientAssistantContext(context) {
  const compact = compactChatContext(context);
  return {
    userCountry: compact.userCountry || '',
    authorizedPrograms: compact.allowedPrograms || [],
    accessScope: compact.assistantAccess?.scope?.source || '',
    publishedResults: compact.publishedResults || [],
    allProgramStatistics: compact.allProgramStatistics
      || compact.publicStatistics?.suggestions
      || [],
    dayProgramStatistics: compact.dayProgramStatistics
      || compact.publicStatistics?.daySuggestions
      || [],
    currentPrograms: compact.currentPrograms || [],
    records: compact.records || [],
    dayPatterns: compact.dayPatterns || [],
    timePatterns: compact.timePatterns || [],
    delayPatterns: compact.delayPatterns || [],
    permutationObservations: compact.permutationObservations || [],
    delayProgramStatistics: compact.delayProgramStatistics || [],
    currentWeek: compact.currentWeek || '',
    weeklyActivity: compact.weeklyActivity || [],
    crossProgramPatterns: compact.crossProgramPatterns || [],
    recommendationProjection: compact.recommendationProjection || null,
    drawNumberMemory: compact.drawNumberMemory || null,
    personalPeriodStatistics: compact.personalPeriodStatistics || null,
    dechiffrementPlus: compact.dechiffrementPlus || { available: false }
  };
}

function chatActor(request, input = {}, authoritative = null) {
  const isAnonymous = request.headers.get('x-websim-user-is-anonymous') === 'true';
  const websimUserId = String(request.headers.get('x-websim-user-id') || '').trim();
  if (websimUserId && !isAnonymous) {
    return messageActor(request, input);
  }
  if (authoritative?.access?.user?.id) {
    return {
      userId: authoritative.access.user.id,
      cid: authoritative.access.user.id,
      username: cleanMessageText(
        authoritative.access.user.name || request.headers.get('x-websim-username'),
        80
      )
    };
  }
  // A client-provided cid is not an identity proof. Supabase access-token
  // validation above or the trusted Websim identity header is mandatory.
  return null;
}

function chatSessionId(value) {
  const id = String(value || '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/.test(id) ? id : '';
}

function chatLocale(value) {
  const locale = String(value || 'fr').trim().toLowerCase();
  return /^[a-z]{2}(?:-[a-z]{2})?$/.test(locale) ? locale.slice(0, 12) : 'fr';
}

function chatTokens(value) {
  return [...new Set(
    String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length >= 3)
  )];
}

function chatKnowledgeLocale(locale) {
  const code = String(locale || 'fr').toLowerCase().split('-')[0];
  return ['fr', 'en', 'es', 'pt', 'ar'].includes(code) ? code : 'fr';
}

function chatNormalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function chatKnowledgeText(entry, field, locale) {
  const language = chatKnowledgeLocale(locale);
  return String(entry?.[field]?.[language] || entry?.[field]?.fr || '');
}

function chatKnowledgeEntryForQuestion(question) {
  const normalized = chatNormalizeText(question);
  const searchable = String(question || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return CIDMAP_FUNCTION_KNOWLEDGE
    .map((entry) => ({
      entry,
      score: [...entry.aliases, ...Object.values(entry.names || {})].reduce((best, alias) => {
        const candidate = chatNormalizeText(alias);
        const unicodeCandidate = String(alias || '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[’']/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (candidate && normalized === candidate) return Math.max(best, 1);
        if (candidate && normalized.includes(candidate)) return Math.max(best, Math.min(0.98, candidate.length / Math.max(1, normalized.length) + 0.35));
        if (unicodeCandidate && searchable.includes(unicodeCandidate)) return Math.max(best, 0.9);
        return best;
      }, 0)
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.entry || null;
}

function chatFunctionKnowledgeAnswer(question, locale) {
  const text = chatNormalizeText(question);
  const named = chatKnowledgeEntryForQuestion(question);
  const asksAboutFunctions = /\b(fonction|fonctions|funcion|funciones|funcoes|funcionamento|fonctionnement|method|methods|metodo|metodos|méthode|methodes|programme|programmes|programa|programas|tableau|tableaux|tabla|tablas|quadro|quadros|service|services|servicio|servicios|big|architecture|how|work|what|explain|expliquer|explicar|comment|como|sert|role|purpose|utiliser|utilise|use|para que)\b/i.test(text);
  if (!named && !asksAboutFunctions) return '';

  const language = chatKnowledgeLocale(locale);
  const asksExactData = /\b(cle|key|nap|numero|numbers?|resultat|results?|tirage|draw|prix|price|access|acces|abonnement|subscription|acheter|buy)\b/i.test(text);
  const asksAccessOrPurchase = /\b(prix|price|abonnement|subscription|acheter|buy|acces|access|compte|account)\b/i.test(text);
  if (named && asksExactData && (asksAccessOrPurchase
    || !/\b(comment|how|fonction|work|sert|purpose|expliqu|guide|utilis|use)\b/i.test(text))) {
    return '';
  }

  if (!named) {
    const headings = {
      fr: 'Voici les fonctions principales actuellement déployées dans Cidmap :',
      en: 'These are the main functions currently deployed in Cidmap:',
      es: 'Estas son las principales funciones desplegadas actualmente en Cidmap:',
      pt: 'Estas são as principais funções atualmente implantadas no Cidmap:',
      ar: 'هذه هي الوظائف الرئيسية المنشورة حالياً في Cidmap:'
    };
    const groups = {
      fr: [
        '• Accès et orchestration : Contrôle des méthodes, Accès et abonnements, Support et contexte du virtuel.',
        '• Publications et données : Résultat-Aide, Exécuteur de programmes, Régénération quotidienne, Régénération Stand-by.',
        '• Traitement : Fonction intelligente, Processeur intelligent, Boules rejetées.',
        '• Tableaux : Universelle, Intuition, Oracle, LNB, Balsa Plus, Stand-by et Robot.',
        '• Analyse complémentaire : Déchiffrement Plus / MT, Accès aux historiques et Récompense de parrainage.',
        'Je peux expliquer chaque fonction séparément, son rôle, son parcours et la limite entre données publiques et accès privé.'
      ],
      en: [
        '• Access and orchestration: Method control, Subscription access and Support/assistant context.',
        '• Publications and data: Result help, Program runner, Daily regeneration and Stand-by regeneration.',
        '• Processing: Smart function, Smart processor and Rejected balls.',
        '• Tables: Universelle, Intuition, Oracle, LNB, Balsa Plus, Stand-by and Robot.',
        '• Additional analysis: Déchiffrement Plus / MT, History access and Referral reward.',
        'I can explain each function separately, its workflow and the boundary between public data and private access.'
      ],
      es: [
        '• Acceso y coordinación: Control de métodos, Acceso y suscripciones y Soporte/contexto del asistente.',
        '• Publicaciones y datos: Ayuda de resultados, Ejecutor de programas, Regeneración diaria y Regeneración Stand-by.',
        '• Procesamiento: Función inteligente, Procesador inteligente y Bolas rechazadas.',
        '• Tablas: Universal, Intuición, Oracle, LNB, Balsa Plus, Stand-by y Robot.',
        '• Análisis adicional: Descifrado Plus / MT, Acceso al historial y Recompensa por recomendación.',
        'Puedo explicar cada función por separado, su recorrido y la diferencia entre datos públicos y acceso privado.'
      ],
      pt: [
        '• Acesso e orquestração: Controlo de métodos, Acesso e subscrições e Suporte/contexto do assistente.',
        '• Publicações e dados: Ajuda de resultados, Executor de programas, Regeneração diária e Regeneração Stand-by.',
        '• Processamento: Função inteligente, Processador inteligente e Bolas rejeitadas.',
        '• Quadros: Universal, Intuição, Oracle, LNB, Balsa Plus, Stand-by e Robot.',
        '• Análise complementar: Descodificação Plus / MT, Acesso ao histórico e Recompensa por referência.',
        'Posso explicar cada função separadamente, o seu percurso e a diferença entre dados públicos e acesso privado.'
      ],
      ar: [
        '• الوصول والتنسيق: التحكم في الطرق، الوصول والاشتراكات، وسياق الدعم والمساعد.',
        '• النشر والبيانات: مساعدة النتائج، منفذ البرامج، التجديد اليومي وتجديد وضع الانتظار.',
        '• المعالجة: الوظيفة الذكية، المعالج الذكي والكرات المستبعدة.',
        '• الجداول: العالمية، الحدس، أوراكل، LNB، بالسا بلاس، وضع الانتظار وروبوت.',
        '• التحليل الإضافي: فك التشفير بلاس / MT، الوصول إلى السجل ومكافأة الإحالة.',
        'يمكنني شرح كل وظيفة على حدة ومسارها والفرق بين البيانات العامة والوصول الخاص.'
      ]
    };
    return [headings[language], ...groups[language]].join('\n');
  }

  const name = String(named.names?.[language] || named.names?.fr || named.key);
  const labels = {
    fr: `**${name}**`,
    en: `**${name}**`,
    es: `**${name}**`,
    pt: `**${name}**`,
    ar: `**${name}**`
  };
  const workflow = {
    fr: 'Parcours : la fonction prépare ou lit ses données, applique ses règles, puis remet une sortie identifiée à l’interface ou aux statistiques.',
    en: 'Workflow: the function prepares or reads its data, applies its rules, then returns an identified output to the interface or statistics.',
    es: 'Recorrido: la función prepara o lee sus datos, aplica sus reglas y entrega una salida identificada a la interfaz o a las estadísticas.',
    pt: 'Percurso: a função prepara ou lê os seus dados, aplica as suas regras e entrega uma saída identificada à interface ou às estatísticas.',
    ar: 'المسار: تجهز الوظيفة بياناتها أو تقرؤها، تطبق قواعدها، ثم تعيد مخرجاً محدداً إلى الواجهة أو الإحصاءات.'
  };
  const boundary = {
    fr: 'Règle de sécurité : une explication est publique, mais une valeur exacte, une clé, une statistique détaillée ou un tableau privé ne sont affichés que si le droit du compte le permet. Les résultats publiés restent consultables séparément, quel que soit le pays de l’utilisateur.',
    en: 'Safety rule: an explanation is public, but an exact value, key, detailed statistic or private table is shown only when the account entitlement allows it. Published results remain separately searchable regardless of the user country.',
    es: 'Regla de seguridad: la explicación es pública, pero un valor exacto, una clave, una estadística detallada o una tabla privada solo se muestran si el derecho de la cuenta lo permite. Los resultados publicados se pueden buscar por separado sin importar el país del usuario.',
    pt: 'Regra de segurança: a explicação é pública, mas um valor exato, uma chave, uma estatística detalhada ou um quadro privado só aparece quando o direito da conta o permite. Os resultados publicados continuam pesquisáveis independentemente do país do utilizador.',
    ar: 'قاعدة الأمان: الشرح عام، لكن القيمة الدقيقة أو المفتاح أو الإحصاء التفصيلي أو الجدول الخاص لا يظهر إلا إذا سمح حق الحساب بذلك. تبقى النتائج المنشورة قابلة للبحث بشكل منفصل مهما كان بلد المستخدم.'
  };
  return [
    labels[language],
    chatKnowledgeText(named, 'purpose', language),
    chatKnowledgeText(named, 'use', language),
    workflow[language],
    boundary[language]
  ].filter(Boolean).join('\n');
}

function chatCountryAccessAnswer(question, locale) {
  const raw = String(question || '');
  const normalized = chatNormalizeText(question);
  const mentionsCountry = /\b(pays|country|pais|pa[ií]s|origine|origin|origen|origem)\b/i.test(normalized)
    || /بلد|الدولة|بلدك/.test(raw);
  const asksToSee = /\b(demander|demande|voir|consulter|resultat|résultat|tirage|ask|request|see|search|pedir|ver|consultar)\b/i.test(normalized)
    || /طلب|نتيجة|نتائج|مشاهدة|استعلام/.test(raw);
  if (!mentionsCountry || !asksToSee) {
    return '';
  }
  const language = chatKnowledgeLocale(locale);
  const answers = {
    fr: 'Oui. Le pays du compte ne limite pas une demande publique : une personne peut consulter un résultat publié d’un autre pays, si ce résultat existe dans la base. Pour une donnée privée, seul le droit du tableau concerné compte ; il ne faut jamais mélanger deux tableaux.',
    en: 'Yes. The account country does not restrict a public request: a person can consult a published result from another country when that result exists in the database. For private data, only the entitlement for the requested table matters; tables must never be mixed.',
    es: 'Sí. El país de la cuenta no limita una solicitud pública: se puede consultar un resultado publicado de otro país si existe en la base. Para los datos privados solo cuenta el derecho de la tabla solicitada; las tablas nunca deben mezclarse.',
    pt: 'Sim. O país da conta não limita um pedido público: é possível consultar um resultado publicado de outro país quando ele existe na base. Para dados privados, só conta o direito do quadro pedido; os quadros nunca devem ser misturados.',
    ar: 'نعم. لا يحد بلد الحساب من الطلب العام؛ يمكن للشخص الاطلاع على نتيجة منشورة من بلد آخر إذا كانت موجودة في قاعدة البيانات. أما البيانات الخاصة فيحددها حق الجدول المطلوب فقط، ولا يجوز خلط الجداول.'
  };
  return answers[language];
}

/*
 * Route every question before retrieval or generation. A bare "programmes"
 * question is a guide request, not a result lookup. Result lookup is only
 * selected when the user gives enough retrieval signals (country, date,
 * time, draw number or an explicit latest/history request).
 */
function chatQuestionIntent(question) {
  const text = String(question || '').trim();
  const normalized = text.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const hasProgramGuideSignal = /\b(programmes?|tableaux?|methodes?|grille|lecture|horaires?|fonctionnement|navigation|guide|aide|offres?|services?)\b/i
    .test(normalized);
  const hasResultWord = /\b(resultats?|tirages?|numero(?:s)?|publie(?:s|e|es)?|draws?|results?)\b/i
    .test(normalized);
  const hasCountry = /\b(benin|bj|cote d ivoire|cote divoire|ci|ghana|gh|angola|ao|niger|ne|guinee|guinea|gn|senegal|sn|togo|tg)\b/i
    .test(normalized);
  const hasDateOrTime = /\b(?:19|20)\d{2}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{2}[/-]\d{2}[/-]\d{4}\b|\b(?:aujourd hui|today|hier|demain|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b|\b\d{1,2}\s*(?:h|heure|heures|:)\s*\d{0,2}\b/i
    .test(normalized);
  const hasExplicitLookup = /\b(dernier|derniere|latest|precis|precise|exact|historique|archive|combien|quel numero|numero de tirage|a quelle heure|pour le)\b/i
    .test(normalized);
  const resultLookup = hasResultWord && (
    hasCountry || hasDateOrTime || hasExplicitLookup
  );

  if (hasProgramGuideSignal && !resultLookup) {
    return {
      type: 'program-guide',
      label: 'guide des programmes, méthodes, horaires et navigation'
    };
  }
  if (resultLookup) {
    return {
      type: 'result-search',
      label: 'recherche de résultat ou d’archive publiée'
    };
  }
  if (/\b(prix|tarifs?|cout|abonnements?|forfaits?|etoiles?|jetons?|acces|autorise|compte|support)\b/i.test(normalized)) {
    return {
      type: 'account-guide',
      label: 'guide des abonnements, accès et compte'
    };
  }
  return {
    type: 'general-guide',
    label: 'aide générale et navigation'
  };
}

function chatKnowledgeScore(question, row) {
  const query = chatTokens(question);
  if (!query.length) return 0;
  const corpus = chatTokens([
    row?.intent,
    row?.question,
    row?.keywords
  ].join(' '));
  const overlap = query.filter((token) => corpus.includes(token));
  const phrase = String(row?.question || '').trim().toLowerCase();
  const normalizedQuestion = String(question || '').trim().toLowerCase();
  const phraseBoost = phrase && normalizedQuestion.includes(phrase) ? 0.6 : 0;
  return Math.min(1, (overlap.length / Math.max(3, query.length)) + phraseBoost);
}

function chatKnowledgeFromRow(row) {
  return {
    id: Number(row.id),
    intent: row.intent,
    question: row.question,
    answer: row.answer,
    keywords: row.keywords || '',
    priority: Number(row.priority) || 100,
    enabled: Number(row.enabled) !== 0,
    updated_at: row.updated_at
  };
}

function chatMessageFromRow(row) {
  return {
    id: Number(row.id),
    role: row.role,
    content: row.content,
    source: row.source || 'virtual-assistant',
    createdAt: row.created_at
  };
}

function compactChatContext(context) {
  if (!context || typeof context !== 'object') return {};
  const sourceAssistantContext = context.assistantContext
    && typeof context.assistantContext === 'object'
    ? context.assistantContext
    : {};
  const rawDechiffrement = context.dechiffrementPlus
    || sourceAssistantContext.dechiffrementPlus;
  const rawEarlyAccess = context.earlyAccess
    || sourceAssistantContext.earlyAccess;
  const dechiffrementPlus = rawDechiffrement && typeof rawDechiffrement === 'object'
    ? {
      available: rawDechiffrement.available === true,
      method: String(rawDechiffrement.method || 'Déchiffrement Plus / MT'),
      storageReady: rawDechiffrement.storageReady !== false,
      historyCount: Number(rawDechiffrement.historyCount || 0),
      matrixCount: Number(rawDechiffrement.matrixCount || 0),
      summaries: Array.isArray(rawDechiffrement.summaries)
        ? rawDechiffrement.summaries.slice(0, 40)
        : []
    }
    : { available: false };
  const earlyAccess = rawEarlyAccess && typeof rawEarlyAccess === 'object'
    ? {
      rules: Array.isArray(rawEarlyAccess.rules)
        ? rawEarlyAccess.rules.slice(0, 30)
        : [],
      unlocks: Array.isArray(rawEarlyAccess.unlocks)
        ? rawEarlyAccess.unlocks.slice(0, 60)
        : [],
      grants: Array.isArray(rawEarlyAccess.grants)
        ? rawEarlyAccess.grants.slice(0, 60)
        : []
    }
    : null;
  const compact = {
    dataSource: context.dataSource || '',
    today: context.today || '',
    localeCode: context.localeCode || '',
    userId: context.userId || '',
    userRole: context.userRole || 'visitor',
    subscriptionTier: context.subscriptionTier || '',
    subscriptionStatus: context.subscriptionStatus || 'none',
    currentSurface: context.currentSurface || 'virtual-assistant',
    assistantIntent: context.assistantIntent || '',
    userCountry: context.userCountry || context.assistantContext?.userCountry || '',
    allowedPrograms: Array.isArray(context.allowedPrograms)
      ? context.allowedPrograms.slice(0, 20)
      : [],
    plans: Array.isArray(context.plans)
      ? context.plans.slice(0, 30).map((plan) => ({
        name: plan?.name || plan?.display_name || plan?.slug || '',
        price: plan?.price || plan?.price_label || '',
        durationDays: Number(plan?.durationDays ?? plan?.duration_days) || 0,
        programs: Array.isArray(plan?.programs)
          ? plan.programs.slice(0, 20)
          : Array.isArray(plan?.features)
            ? plan.features.slice(0, 20)
            : []
      }))
      : [],
    assistantAccess: context.assistantAccess
      ? {
        canHelp: context.assistantAccess.canHelp === true,
        isAdmin: context.assistantAccess.isAdmin === true,
        isModerator: context.assistantAccess.isModerator === true,
        scope: {
          source: context.assistantAccess.scope?.source || '',
          authorizedPrograms: Array.isArray(context.assistantAccess.scope?.authorizedPrograms)
            ? context.assistantAccess.scope.authorizedPrograms.slice(0, 30)
            : []
        }
      }
      : null,
    subscription: context.subscription
      ? {
        name: context.subscription.name || '',
        expiresAt: context.subscription.expiresAt || null
    }
      : null,
    siteSurfaces: CIDMAP_SITE_SURFACES,
    functionCatalogue: CIDMAP_FUNCTION_KNOWLEDGE.map((entry) => ({
      key: entry.key,
      name: entry.names?.[chatKnowledgeLocale(context.localeCode)] || entry.names?.fr || entry.key,
      purpose: chatKnowledgeText(entry, 'purpose', context.localeCode)
    })),
    earlyAccess,
    publishedResults: Array.isArray(context.publishedResults)
      ? context.publishedResults.slice(0, 500)
      : [],
    allProgramStatistics: Array.isArray(
      context.allProgramStatistics || sourceAssistantContext.allProgramStatistics
    )
      ? (context.allProgramStatistics || sourceAssistantContext.allProgramStatistics).slice(0, 120)
      : [],
    dayProgramStatistics: Array.isArray(
      context.dayProgramStatistics || sourceAssistantContext.dayProgramStatistics
    )
      ? (context.dayProgramStatistics || sourceAssistantContext.dayProgramStatistics).slice(0, 120)
      : [],
    publicStatistics: context.publicStatistics
      ? {
        suggestions: Array.isArray(context.publicStatistics.suggestions)
          ? context.publicStatistics.suggestions.slice(0, 30)
          : [],
        daySuggestions: Array.isArray(context.publicStatistics.daySuggestions)
          ? context.publicStatistics.daySuggestions.slice(0, 30)
        : []
      }
      : null,
    currentWeek: context.currentWeek || sourceAssistantContext.currentWeek || '',
    currentPrograms: Array.isArray(
      context.currentPrograms || sourceAssistantContext.currentPrograms
    )
      ? (context.currentPrograms || sourceAssistantContext.currentPrograms).slice(0, 12)
      : [],
    records: Array.isArray(context.records || sourceAssistantContext.records)
      ? (context.records || sourceAssistantContext.records).slice(0, 120)
      : [],
    dayPatterns: Array.isArray(context.dayPatterns || sourceAssistantContext.dayPatterns)
      ? (context.dayPatterns || sourceAssistantContext.dayPatterns).slice(0, 120)
      : [],
    timePatterns: Array.isArray(context.timePatterns || sourceAssistantContext.timePatterns)
      ? (context.timePatterns || sourceAssistantContext.timePatterns).slice(0, 120)
      : [],
    delayPatterns: Array.isArray(context.delayPatterns || sourceAssistantContext.delayPatterns)
      ? (context.delayPatterns || sourceAssistantContext.delayPatterns).slice(0, 160)
      : [],
    permutationObservations: Array.isArray(
      context.permutationObservations || sourceAssistantContext.permutationObservations
    )
      ? (context.permutationObservations || sourceAssistantContext.permutationObservations).slice(0, 120)
      : [],
    delayProgramStatistics: Array.isArray(
      context.delayProgramStatistics || sourceAssistantContext.delayProgramStatistics
    )
      ? (context.delayProgramStatistics || sourceAssistantContext.delayProgramStatistics).slice(0, 160)
      : [],
    weeklyActivity: Array.isArray(context.weeklyActivity || sourceAssistantContext.weeklyActivity)
      ? (context.weeklyActivity || sourceAssistantContext.weeklyActivity).slice(0, 120)
      : [],
    crossProgramPatterns: Array.isArray(
      context.crossProgramPatterns || sourceAssistantContext.crossProgramPatterns
    )
      ? (context.crossProgramPatterns || sourceAssistantContext.crossProgramPatterns).slice(0, 80)
      : [],
    recommendationProjection: context.recommendationProjection
      || context.assistantContext?.recommendationProjection
      || null,
    drawNumberMemory: context.drawNumberMemory
      || context.assistantContext?.drawNumberMemory
      || null,
    personalPeriodStatistics: context.personalPeriodStatistics
      || context.assistantContext?.personalPeriodStatistics
      || null,
    dechiffrementPlus
  };
  const serialized = JSON.stringify(compact);
  if (serialized.length <= 28000) return compact;
  return {
    ...compact,
    publishedResults: compact.publishedResults.slice(0, 120),
    allProgramStatistics: compact.allProgramStatistics.slice(0, 40),
    dayProgramStatistics: compact.dayProgramStatistics.slice(0, 40),
    publicStatistics: compact.publicStatistics
      ? {
        suggestions: compact.publicStatistics.suggestions.slice(0, 10),
        daySuggestions: compact.publicStatistics.daySuggestions.slice(0, 10)
      }
      : null,
    recommendationProjection: compact.recommendationProjection
      ? {
        ...compact.recommendationProjection,
        countries: Array.isArray(compact.recommendationProjection.countries)
          ? compact.recommendationProjection.countries.slice(0, 24)
          : [],
        offersByProgram: Object.fromEntries(
          Object.entries(compact.recommendationProjection.offersByProgram || {})
            .slice(0, 8)
        )
      }
      : null,
    personalPeriodStatistics: compact.personalPeriodStatistics
      ? {
        ...compact.personalPeriodStatistics,
        programmes: Array.isArray(compact.personalPeriodStatistics.programmes)
          ? compact.personalPeriodStatistics.programmes.slice(0, 12)
          : []
      }
      : null,
    drawNumberMemory: compact.drawNumberMemory
      ? {
        ...compact.drawNumberMemory,
        series: Array.isArray(compact.drawNumberMemory.series)
          ? compact.drawNumberMemory.series.slice(0, 80)
        : []
      }
      : null,
    currentPrograms: compact.currentPrograms.slice(0, 8),
    dechiffrementPlus: compact.dechiffrementPlus
      ? {
        ...compact.dechiffrementPlus,
        summaries: compact.dechiffrementPlus.summaries.slice(0, 16)
      }
      : { available: false },
    earlyAccess: compact.earlyAccess
      ? {
        ...compact.earlyAccess,
        unlocks: compact.earlyAccess.unlocks.slice(0, 40),
        grants: compact.earlyAccess.grants.slice(0, 40)
      }
      : null
  };
}

/*
 * The authenticated browser snapshot is the Supabase source of truth for
 * subscriptions, programmes and public catalogue data. Do not replace it
 * with the legacy D1 catalogue when the current client explicitly provides
 * this source marker.
 */
function supabaseChatDataContext(clientContext) {
  const plans = Array.isArray(clientContext?.plans)
    ? clientContext.plans.slice(0, 30).map((plan) => ({
      slug: plan?.slug || '',
      name: plan?.name || plan?.display_name || plan?.slug || 'Forfait',
      priceLabel: plan?.price || plan?.price_label || '',
      stars: Number(plan?.stars ?? plan?.required_stars) || 0,
      tokens: Number(plan?.tokens ?? plan?.required_tokens) || 0,
      durationDays: Number(plan?.durationDays ?? plan?.duration_days) || 0,
      features: Array.isArray(plan?.programs)
        ? plan.programs.slice(0, 20)
        : Array.isArray(plan?.features)
          ? plan.features.slice(0, 20)
          : []
    }))
    : [];
  return {
    source: 'supabase',
    catalogue: {
      plans,
      tableaux: Array.isArray(clientContext?.allowedPrograms)
        ? clientContext.allowedPrograms.slice(0, 30).map((name) => ({
          key: String(name || '').trim(),
          name: String(name || '').trim()
        }))
        : [],
      payment: clientContext?.publicContact
        ? {
          mode: clientContext.publicContact.channel || '',
          currency: '',
          channel: clientContext.publicContact.channel || '',
          label: clientContext.publicContact.label || ''
        }
        : null
    },
    clientContext: compactChatContext(clientContext)
  };
}

async function getOrCreateChatSession(env, actor, input = {}) {
  const requestedId = chatSessionId(input.sessionId);
  if (requestedId) {
    const existing = await env.DB.prepare(`
      SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?
    `).bind(requestedId, actor.userId).first();
    if (existing) return existing;
  } else {
    const latest = await env.DB.prepare(`
      SELECT * FROM chat_sessions
      WHERE user_id = ?
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
    `).bind(actor.userId).first();
    if (latest) return latest;
  }
  const id = (crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 32)
    : `chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO chat_sessions
      (id, user_id, username, locale_code, summary, created_at, updated_at)
    VALUES (?, ?, ?, ?, '', ?, ?)
  `).bind(
    id,
    actor.userId,
    actor.username || '',
    chatLocale(input.localeCode),
    now,
    now
  ).run();
  return {
    id,
    user_id: actor.userId,
    username: actor.username || '',
    locale_code: chatLocale(input.localeCode),
    summary: '',
    created_at: now,
    updated_at: now
  };
}

async function appendChatMessage(env, session, actor, role, content, source) {
  const value = cleanMessageText(content, role === 'user' ? 4000 : 8000);
  if (!value) return null;
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO chat_messages
      (session_id, user_id, role, content, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(session.id, actor.userId, role, value, source || 'virtual-assistant', now).run();
  await env.DB.prepare(`
    UPDATE chat_sessions
    SET username = ?, locale_code = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).bind(
    actor.username || session.username || '',
    session.locale_code || 'fr',
    now,
    session.id,
    actor.userId
  ).run();
  return now;
}

async function trimChatSession(env, session, actor) {
  const recent = await env.DB.prepare(`
    SELECT id, role, content, source, created_at
    FROM chat_messages
    WHERE session_id = ? AND user_id = ?
    ORDER BY id DESC
    LIMIT 24
  `).bind(session.id, actor.userId).all();
  const rows = (recent.results || []).reverse();
  const history = rows.slice(-12).map((row) => chatMessageFromRow(row));
  const older = rows.slice(0, -12);
  let effectiveSummary = String(session.summary || '').slice(-1800);
  if (older.length) {
    const prior = String(session.summary || '').trim();
    const addition = older
      .slice(-8)
      .map((row) => `${row.role === 'user' ? 'Utilisateur' : 'Assistant'}: ${String(row.content || '').slice(0, 240)}`)
      .join('\n');
    const summary = [prior, addition].filter(Boolean).join('\n').slice(-1800);
    effectiveSummary = summary;
    await env.DB.prepare(`
      UPDATE chat_sessions SET summary = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).bind(summary, new Date().toISOString(), session.id, actor.userId).run();
  }
  return { history, summary: effectiveSummary };
}

async function readChatKnowledge(env) {
  const { results } = await env.DB.prepare(`
    SELECT * FROM chat_knowledge
    WHERE enabled <> 0
    ORDER BY priority DESC, updated_at DESC, id DESC
    LIMIT 120
  `).all();
  return (results || []).map(chatKnowledgeFromRow);
}

async function readChatDataContext(env, clientContext) {
  const [plans, assignments, payment] = await Promise.all([
    env.DB.prepare(`
      SELECT slug, display_name, unlock_currency, required_stars, required_tokens,
        duration_days, price_label, features
      FROM config_plans WHERE enabled <> 0 ORDER BY required_stars ASC, slug ASC LIMIT 30
    `).all(),
    env.DB.prepare(`
      SELECT grid_key, display_name, plan_slug, enabled
      FROM tableaux_grid_assignments WHERE enabled <> 0 ORDER BY grid_key ASC LIMIT 30
    `).all(),
    env.DB.prepare(`
      SELECT payment_mode, currency_mode, contact_channel, chat_label, contact_label
      FROM config_payment WHERE id = 1
    `).first()
  ]);
  return {
    catalogue: {
      plans: (plans.results || []).map((row) => ({
        slug: row.slug,
        name: row.display_name,
        currency: row.unlock_currency || '',
        stars: Number(row.required_stars) || 0,
        tokens: Number(row.required_tokens) || 0,
        durationDays: Number(row.duration_days) || 30,
        priceLabel: row.price_label || '',
        features: (() => {
          try { return JSON.parse(row.features || '[]'); } catch (_) { return []; }
        })()
      })),
      tableaux: (assignments.results || []).map((row) => ({
        key: row.grid_key,
        name: row.display_name,
        plan: row.plan_slug || null
      })),
      payment: payment
        ? {
          mode: payment.payment_mode,
          currency: payment.currency_mode,
          channel: payment.contact_channel,
          label: payment.chat_label || payment.contact_label || ''
        }
        : null
    },
    clientContext: compactChatContext(clientContext)
  };
}

function chatFallback(locale, contactLabel = '') {
  const isEnglish = String(locale).startsWith('en');
  const contact = contactLabel || (isEnglish ? 'the support form' : 'le formulaire de support');
  return isEnglish
    ? `I could not verify this information in the current records. Please use ${contact} so the support team can review your account.`
    : `Je ne trouve pas cette information dans les données actuelles. Utilisez ${contact} afin que le support puisse vérifier votre compte.`;
}

function chatProgramAccess(dataContext, programKey) {
  const context = dataContext?.clientContext || {};
  const wanted = String(programKey || '').trim().toLowerCase();
  const authorized = [
    ...(Array.isArray(context.allowedPrograms) ? context.allowedPrograms : []),
    ...(Array.isArray(context.assistantAccess?.scope?.authorizedPrograms)
      ? context.assistantAccess.scope.authorizedPrograms
      : [])
  ].map((value) => String(value || '').trim().toLowerCase().replace(/^tableaux-/, ''));
  return context.assistantAccess?.isAdmin === true
    || context.assistantAccess?.isModerator === true
    || authorized.includes('tableaux')
    || authorized.includes(wanted);
}

function chatValueLabel(value) {
  if (value === null || value === undefined || value === '') return '';
  if (Array.isArray(value)) return value.map(chatValueLabel).filter(Boolean).join(' · ');
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, item]) => {
        const label = chatValueLabel(item);
        return label ? `${key}: ${label}` : '';
      })
      .filter(Boolean)
      .join(' · ');
  }
  return String(value);
}

function chatDechiffrementStoredResult(question, locale, memory) {
  const isEnglish = String(locale).startsWith('en');
  const summaries = Array.isArray(memory?.summaries) ? memory.summaries : [];
  if (!summaries.length) {
    return isEnglish
      ? 'No authorized Déchiffrement Plus analysis is memorized for this account yet. Run the Matrice, continue to Déchiffrement Plus and validate the analysis first.'
      : 'Aucune analyse Déchiffrement Plus autorisée n’est encore mémorisée pour ce compte. Calculez la Matrice, continuez vers Déchiffrement Plus, puis validez d’abord l’analyse.';
  }
  const normalized = String(question || '').toLowerCase();
  const requestedCountry = normalized.match(/\b(angola|b[eé]nin|niger|ghana|guin[eé]e|s[eé]n[eé]gal|togo|c[oô]te d['’ ]ivoire)\b/i)?.[1] || '';
  const selected = summaries.find((item) => (
    requestedCountry
      && String(item?.country || '').toLowerCase().includes(requestedCountry.toLowerCase())
  )) || summaries[0];
  const result = selected?.result && typeof selected.result === 'object'
    ? selected.result
    : {};
  const inputNumbers = chatValueLabel(result.inputNumbers);
  const relation = chatValueLabel(result.selected);
  const calls = chatValueLabel(result.calls);
  const lines = [
    isEnglish
      ? `Latest authorized Déchiffrement Plus analysis${selected.country ? ` for ${selected.country}` : ''}:`
      : `Dernière analyse Déchiffrement Plus autorisée${selected.country ? ` pour ${selected.country}` : ''} :`,
    selected.date || selected.drawTime
      ? `${selected.date || 'date inconnue'}${selected.drawTime ? ` · ${selected.drawTime}` : ''}`
      : '',
    selected.status ? `${isEnglish ? 'Status' : 'Statut'} : ${selected.status}` : '',
    inputNumbers ? `${isEnglish ? 'Numbers provided' : 'Numéros fournis'} : ${inputNumbers}` : '',
    relation ? `${isEnglish ? 'Selected relation' : 'Relation retenue'} : ${relation}` : '',
    calls ? `${isEnglish ? 'Groups/calls' : 'Groupes/appels'} : ${calls}` : '',
    isEnglish
      ? 'These are the stored outputs of the authorized method, not a guaranteed future result.'
      : 'Ce sont les sorties mémorisées de la méthode autorisée, pas une garantie pour un résultat futur.'
  ].filter(Boolean);
  return lines.join('\n');
}

function chatDechiffrementAnswer(question, locale, dataContext) {
  const isEnglish = String(locale).startsWith('en');
  const text = String(question || '');
  if (!/(d[eé]chiffrement|dechiffrement|mt\b)/i.test(text)) return '';
  if (!/(comment|utilis|fonction|marche|sert|faire|obtenir|lancer|d[eé]bloqu|actif|r[eé]sultat|derni[eè]re|couple|groupe|appel|manuel|saisir|calcul|num[eé]ro)/i.test(text)) {
    return '';
  }

  const memory = dataContext?.clientContext?.dechiffrementPlus
    || dataContext?.clientContext?.assistantContext?.dechiffrementPlus
    || { available: false };
  const hasAccess = chatProgramAccess(dataContext, 'dechiffrement-plus');
  if (!hasAccess && memory.available !== true) {
    return isEnglish
      ? 'Your account does not currently have an active Déchiffrement Plus / MT access. The public assistant can explain the workflow, but it cannot expose a private calculation until the access is active.'
      : 'Votre compte ne dispose pas actuellement d’un accès actif à Déchiffrement Plus / MT. Je peux expliquer le parcours, mais je ne peux pas afficher un calcul privé tant que l’accès n’est pas actif.';
  }

  const asksStoredResult = /(derni[eè]re|r[eé]sultat|couple|groupe|appel|num[eé]ro|analyse.*(faite|m[eé]moris)|historique)/i.test(text)
    && !/(comment utiliser|comment fonctionne|[aà] quoi sert|comment lancer)/i.test(text);
  if (asksStoredResult) {
    return chatDechiffrementStoredResult(question, locale, memory);
  }

  const count = Number(memory.historyCount || 0);
  const storage = memory.storageReady === false
    ? (isEnglish
      ? 'Your access is recognized, but the MT history storage is not currently available.'
      : 'Votre accès est reconnu, mais le stockage de l’historique MT n’est pas disponible actuellement.')
    : count
      ? (isEnglish
        ? `${count} authorized MT analysis(es) are currently memorized.`
        : `${count} analyse(s) MT autorisée(s) sont actuellement mémorisée(s).`)
      : (isEnglish
        ? 'No personal MT analysis is memorized yet.'
        : 'Aucune analyse MT personnelle n’est encore mémorisée.');
  return [
    isEnglish
      ? 'Déchiffrement Plus / MT is used after the Matrice calculation: it reads the 10 numbers produced by the matrix and organizes the authorized couples, correspondences and groups.'
      : 'Déchiffrement Plus / MT s’utilise après le calcul de la Matrice : il reprend les 10 numéros produits et organise les couples, correspondances et groupes autorisés.',
    isEnglish
      ? 'Open Déchiffrement MT, calculate the Matrice, check the 10 numbers, then click Continue. In the dedicated Déchiffrement Plus view, click “Decrypt now”. If needed, enter the 10 numbers manually, keeping the automatic two-digit spacing (for example 01 45 48).'
      : 'Ouvrez Déchiffrement MT, calculez la Matrice, vérifiez les 10 numéros, puis cliquez sur « Continuer ». Dans la vue Déchiffrement Plus dédiée, cliquez sur « Déchiffrer maintenant ». Si nécessaire, saisissez manuellement les 10 numéros ; l’espace entre les nombres à deux chiffres est automatique (ex. 01 45 48).',
    storage
  ].join('\n');
}

function chatFutureAccessAnswer(question, locale, dataContext) {
  const isEnglish = String(locale).startsWith('en');
  const text = String(question || '');
  if (!/(demain|prochain|prochaine|avenir|futur|future|upcoming|tomorrow|next|anticip[eé]|exact.*num[eé]ro|r[eé]sultat.*venir)/i.test(text)) {
    return '';
  }
  if (!/(r[eé]sultat|tirage|num[eé]ro|tableau|programme|oracle|intuition|matrice|sort|sortira|donne|fournis|what.*next|which.*next)/i.test(text)) {
    return '';
  }
  const early = dataContext?.clientContext?.earlyAccess
    || dataContext?.clientContext?.assistantContext?.earlyAccess
    || null;
  const now = Date.now();
  const active = [
    ...(Array.isArray(early?.unlocks) ? early.unlocks : []),
    ...(Array.isArray(early?.grants) ? early.grants : [])
  ].some((item) => !item?.expires_at || Date.parse(item.expires_at) > now);
  if (!active) {
    return isEnglish
      ? 'A normal Tableau access does not authorize a future or pending result. No active Anticipé entitlement is verified for this account, so I will not invent an upcoming number or programme output.'
      : 'Un accès normal à un Tableau n’autorise pas un résultat futur ou en attente. Aucun accès Anticipé actif n’est vérifié pour ce compte ; je ne vais donc pas inventer un prochain numéro ou une prochaine sortie de programme.';
  }
  const today = dataContext?.clientContext?.today || new Date().toISOString().slice(0, 10);
  const futureRows = (Array.isArray(dataContext?.clientContext?.publishedResults)
    ? dataContext.clientContext.publishedResults
    : []).filter((row) => String(row?.date || '') > today);
  if (!futureRows.length) {
    return isEnglish
      ? 'An active Anticipé entitlement is recognized, but no validated future publication is present in the retrieved data yet.'
      : 'Un accès Anticipé actif est reconnu, mais aucune publication future validée n’est encore présente dans les données récupérées.';
  }
  return isEnglish
    ? 'An active Anticipé entitlement and a validated future publication are present. I can describe only that publication and its configured programme; I will still distinguish it from a historical trend.'
    : 'Un accès Anticipé actif et une publication future validée sont présents. Je peux décrire uniquement cette publication et son programme configuré, en la distinguant toujours d’une tendance historique.';
}

function chatRequestedProgram(question) {
  const normalized = String(question || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const aliases = [
    ['dechiffrement plus', 'dechiffrement-plus', 'Déchiffrement Plus / MT'],
    ['dechiffrement', 'dechiffrement-plus', 'Déchiffrement Plus / MT'],
    ['boules rejetees', 'boules-rejetees', 'Boules rejetées'],
    ['croix nationale', 'croix', 'Croix nationale'],
    ['universelle', 'universelle', 'Universelle'],
    ['intuition', 'intuition', 'Intuition'],
    ['oracle', 'oracle', 'Oracle'],
    ['lnb', 'lnb', 'LNB'],
    ['balsa', 'balsa', 'Balsa Plus'],
    ['stand by', 'standby', 'Stand-by'],
    ['stand-by', 'standby', 'Stand-by'],
    ['robot', 'robot', 'Robot'],
    ['matrice', 'matrice', 'Matrice']
  ].sort((left, right) => right[0].length - left[0].length);
  const match = aliases.find(([label]) => normalized.includes(label));
  return match ? { key: match[1], label: match[2] } : null;
}

function chatRequestedCountry(question, dataContext = null) {
  const normalized = String(question || '').toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/\s+/g, ' ');
  const countries = [
    ['benin', 'BJ', 'Bénin'],
    ['bj', 'BJ', 'Bénin'],
    ['cote d ivoire', 'CI', "Côte d'Ivoire"],
    ['cote divoire', 'CI', "Côte d'Ivoire"],
    ['ci', 'CI', "Côte d'Ivoire"],
    ['ghana', 'GH', 'Ghana'],
    ['gh', 'GH', 'Ghana'],
    ['angola', 'AO', 'Angola'],
    ['ao', 'AO', 'Angola'],
    ['niger', 'NE', 'Niger'],
    ['ne', 'NE', 'Niger'],
    ['guinee', 'GN', 'Guinée'],
    ['guinea', 'GN', 'Guinée'],
    ['gn', 'GN', 'Guinée'],
    ['senegal', 'SN', 'Sénégal'],
    ['sn', 'SN', 'Sénégal'],
    ['togo', 'TG', 'Togo'],
    ['tg', 'TG', 'Togo']
  ];
  const found = countries
    .sort((left, right) => right[0].length - left[0].length)
    .find(([label]) => new RegExp(`\\b${label.replace(/\s+/g, '\\s+')}\\b`, 'i').test(normalized));
  if (found) return { code: found[1], name: found[2] };

  /*
   * Do not hard-code the supported countries to the initial catalogue.
   * Published rows are the source of truth, so a country added later can be
   * requested by its ISO-3166 code or by its localized display name.
   */
  const rows = Array.isArray(dataContext?.clientContext?.publishedResults)
    ? dataContext.clientContext.publishedResults
    : [];
  const codes = [...new Set(rows
    .map((row) => String(row?.countryCode || row?.country_code || '').trim().toUpperCase())
    .filter((code) => /^[A-Z]{2}$/.test(code)))];
  const codeMatch = codes.find((code) => new RegExp(`\\b${code.toLowerCase()}\\b`, 'i').test(normalized));
  if (codeMatch) {
    try {
      const name = new Intl.DisplayNames(['fr'], { type: 'region' }).of(codeMatch) || codeMatch;
      return { code: codeMatch, name };
    } catch (_) {
      return { code: codeMatch, name: codeMatch };
    }
  }
  for (const code of codes) {
    const names = ['fr', 'en', 'es', 'pt', 'ar']
      .map((language) => {
        try {
          return new Intl.DisplayNames([language], { type: 'region' }).of(code) || '';
        } catch (_) {
          return '';
        }
      })
      .filter(Boolean);
    if (names.some((name) => chatNormalizeText(name) && normalized.includes(chatNormalizeText(name)))) {
      return { code, name: names[0] || code };
    }
  }
  return null;
}

function chatRequestedResultCount(question) {
  const normalized = String(question || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const numeric = normalized.match(/\b([1-9]|1[0-2])\s*(?:resultats?|tirages?|resultados?|sorteos?|sorteios?)\b/i);
  if (numeric) return Number(numeric[1]);
  const words = {
    un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5,
    uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
    um: 1, uma: 1, dois: 2, tres: 3, quatro: 4, cinco: 5
  };
  const word = Object.keys(words).find((key) => (
    new RegExp(`\\b${key}\\s+(?:resultats?|tirages?|resultados?|sorteos?|sorteios?)\\b`, 'i').test(normalized)
  ));
  return word ? words[word] : 0;
}

function chatAddDaysIso(value, amount) {
  const date = new Date(`${String(value || '').slice(0, 10)}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function chatMonthBounds(value, offset = 0) {
  const base = new Date(`${String(value || '').slice(0, 10)}T12:00:00.000Z`);
  if (Number.isNaN(base.getTime())) return null;
  const first = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + offset, 1, 12));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12));
  return {
    from: first.toISOString().slice(0, 10),
    to: last.toISOString().slice(0, 10)
  };
}

function chatPublishedScope(question, today) {
  const normalized = String(question || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const explicit = normalized.match(/\b\d{4}-\d{2}-\d{2}\b|\b\d{2}[/-]\d{2}[/-]\d{4}\b/);
  if (explicit) {
    const parts = explicit[0].split(/[/-]/);
    const date = parts.length === 3 && parts[0].length === 4
      ? parts.join('-')
      : `${parts[2]}-${parts[1]}-${parts[0]}`;
    return { from: date, to: date, weekday: null };
  }
  if (/\b(mois dernier|mois derniere|mois passe|mois precedent)\b/i.test(normalized)) {
    const bounds = chatMonthBounds(today, -1);
    if (!bounds) return null;
    const weekdays = { dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6 };
    const weekday = Object.keys(weekdays).find((name) => normalized.includes(name));
    return { ...bounds, weekday: weekday ? weekdays[weekday] : null };
  }
  if (/\b(semaine derniere|semaine passee|semaine precedente)\b/i.test(normalized)) {
    const baseDate = new Date(`${today}T12:00:00.000Z`);
    const mondayOffset = (baseDate.getUTCDay() + 6) % 7;
    const currentMonday = chatAddDaysIso(today, -mondayOffset);
    return {
      from: chatAddDaysIso(currentMonday, -7),
      to: chatAddDaysIso(currentMonday, -1),
      weekday: null
    };
  }
  const weekdays = { dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6 };
  const weekday = Object.keys(weekdays).find((name) => normalized.includes(name));
  if (weekday || /\b(aujourd hui|hier|yesterday)\b/i.test(normalized)) {
    let date = today;
    if (/\b(hier|yesterday)\b/i.test(normalized)) date = chatAddDaysIso(today, -1);
    if (weekday) {
      const baseDate = new Date(`${today}T12:00:00.000Z`);
      const delta = (weekdays[weekday] - baseDate.getUTCDay() + 7) % 7;
      const previous = /\b(dernier|derniere|precedent|passe)\b/i.test(normalized);
      date = chatAddDaysIso(today, previous ? (delta === 0 ? -7 : delta - 7) : delta);
    }
    return { from: date, to: date, weekday: null };
  }
  return null;
}

function chatRequestsAllResults(question) {
  return /\b(tous?|toutes|l'ensemble|ensemble|chaque|toute la journee|journee entiere|complet|complets)\b/i
    .test(String(question || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
}

function chatPublishedResultAnswer(question, locale, dataContext) {
  const intent = chatQuestionIntent(question);
  const dynamicCountry = chatRequestedCountry(question, dataContext);
  if (intent.type !== 'result-search'
    && !(dynamicCountry && /\b(result|resultat|resultats|resultado|resultados|tirage|tirages|sorteo|sorteos|sorteio|sorteios|draw|draws)\b/i.test(
      chatNormalizeText(question)
    ))) return '';
  const language = chatKnowledgeLocale(locale);
  const labels = {
    fr: { askCountry: 'Pour quel pays dois-je rechercher les résultats ?', none: (name) => `Aucun résultat publié n’est actuellement disponible pour ${name}.`, period: (name) => `Aucun résultat publié n’est disponible pour ${name} sur la période demandée.`, title: (name) => `**Résultats publiés — ${name} :**`, draw: 'Numéro de tirage', group1: 'Groupe 1', group2: 'Groupe 2', bonus: 'Bonus' },
    en: { askCountry: 'Which country should I search?', none: (name) => `No published result is currently available for ${name}.`, period: (name) => `No published result is currently available for ${name} in the requested period.`, title: (name) => `**Published results — ${name}:**`, draw: 'Draw number', group1: 'Group 1', group2: 'Group 2', bonus: 'Bonus' },
    es: { askCountry: '¿Para qué país debo buscar los resultados?', none: (name) => `No hay ningún resultado publicado disponible actualmente para ${name}.`, period: (name) => `No hay ningún resultado publicado disponible para ${name} en el período solicitado.`, title: (name) => `**Resultados publicados — ${name}:**`, draw: 'Número de sorteo', group1: 'Grupo 1', group2: 'Grupo 2', bonus: 'Bono' },
    pt: { askCountry: 'Para que país devo procurar os resultados?', none: (name) => `Não há resultado publicado disponível atualmente para ${name}.`, period: (name) => `Não há resultado publicado disponível para ${name} no período solicitado.`, title: (name) => `**Resultados publicados — ${name}:**`, draw: 'Número do sorteio', group1: 'Grupo 1', group2: 'Grupo 2', bonus: 'Bónus' },
    ar: { askCountry: 'لأي بلد أبحث عن النتائج؟', none: (name) => `لا توجد نتيجة منشورة متاحة حالياً لـ ${name}.`, period: (name) => `لا توجد نتيجة منشورة متاحة لـ ${name} في الفترة المطلوبة.`, title: (name) => `**النتائج المنشورة — ${name}:**`, draw: 'رقم السحب', group1: 'المجموعة 1', group2: 'المجموعة 2', bonus: 'إضافي' }
  }[language];
  const context = dataContext?.clientContext || {};
  const country = dynamicCountry;
  if (!country) {
    return labels.askCountry;
  }
  const normalized = String(question || '').toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const explicitDate = normalized.match(/\b\d{4}-\d{2}-\d{2}\b|\b\d{2}[/-]\d{2}[/-]\d{4}\b/)?.[0] || '';
  const targetDate = explicitDate
    ? (explicitDate.includes('-')
      ? explicitDate
      : explicitDate.split(/[/-]/).reverse().join('-'))
    : '';
  const timeMatch = normalized.match(/\b(?:a|à|vers|heure|horaire)\s*(\d{1,2})(?:\s*(?::|h|heures?)\s*(\d{2})?)?/i);
  const targetTime = timeMatch
    ? `${String(Number(timeMatch[1])).padStart(2, '0')}:${String(Number(timeMatch[2] || 0)).padStart(2, '0')}`
    : '';
  const rows = (Array.isArray(context.publishedResults) ? context.publishedResults : [])
    .filter((row) => String(row?.countryCode || row?.country_code || '').toUpperCase() === country.code)
    .filter((row) => !targetDate || String(row?.date || row?.draw_date || '') === targetDate)
    .filter((row) => !targetTime || String(row?.drawTime || row?.draw_time || '').slice(0, 5) === targetTime)
    .sort((left, right) => (
      `${right.date || right.draw_date || ''} ${right.drawTime || right.draw_time || ''}`
        .localeCompare(`${left.date || left.draw_date || ''} ${left.drawTime || left.draw_time || ''}`)
    ));
  if (!rows.length) {
    return labels.none(country.name);
  }
  const today = String(context.today || new Date().toISOString().slice(0, 10));
  const scope = chatPublishedScope(question, today);
  const wantsAll = chatRequestsAllResults(question);
  const count = chatRequestedResultCount(question);
  const latestDate = String(rows[0]?.date || rows[0]?.draw_date || '');
  const latestDayRows = rows.filter((row) => String(row?.date || row?.draw_date || '') === latestDate);
  let selected = scope
    ? rows.filter((row) => {
      const date = String(row?.date || row?.draw_date || '');
      if (date < scope.from || date > scope.to) return false;
      return scope.weekday === null || new Date(`${date}T12:00:00.000Z`).getUTCDay() === scope.weekday;
    })
    : wantsAll
      ? latestDayRows.slice()
      : latestDayRows.slice(0, count || 1);
  if (count && selected.length > count) selected = selected.slice(0, count);
  selected.sort((left, right) => (
    `${left.date || left.draw_date || ''} ${left.drawTime || left.draw_time || ''}`
      .localeCompare(`${right.date || right.draw_date || ''} ${right.drawTime || right.draw_time || ''}`)
  ));
  if (!selected.length) {
    return labels.period(country.name);
  }
  const renderRow = (row) => {
    const date = row.date || row.draw_date || '';
    const time = String(row.drawTime || row.draw_time || '').slice(0, 5);
    const first = row.firstNumbers || row.first_numbers || [];
    const machine = row.machineNumbers || row.machine_numbers || [];
    const bonus = row.bonusNumbers || row.bonus_numbers || [];
    const drawNumber = row.drawNumber ?? row.draw_number;
    const firstLabel = chatValueLabel(first);
    return [
      `**${[country.name, date, time].filter(Boolean).join(' · ')}**`,
      drawNumber !== null && drawNumber !== undefined && String(drawNumber).trim() !== ''
        ? `• ${labels.draw} : ${drawNumber}`
        : '',
      firstLabel ? `• ${labels.group1} : ${firstLabel}` : '',
      chatValueLabel(machine) ? `• ${labels.group2} : ${chatValueLabel(machine)}` : '',
      chatValueLabel(bonus) ? `• ${labels.bonus} : ${chatValueLabel(bonus)}` : ''
    ].filter(Boolean);
  };
  return [
    labels.title(country.name),
    ...selected.flatMap(renderRow)
  ].join('\n');
}

function chatSpecialistGuideAnswer(question, locale, dataContext) {
  const isEnglish = String(locale).startsWith('en');
  const text = String(question || '');
  if (!/(guide|accompagn|aide|sp[eé]cial|suivi|orient|abonn[eé]|mon tableau|my table|help|assist|guide)/i.test(text)) {
    return '';
  }
  const program = chatRequestedProgram(text);
  if (!program) return '';
  const hasAccess = chatProgramAccess(dataContext, program.key);
  if (!hasAccess) {
    return isEnglish
      ? `I can explain ${program.label}, but I cannot act as its private specialist because no active access to this programme is verified for the account.`
      : `Je peux expliquer ${program.label}, mais je ne peux pas agir comme son guide privé car aucun accès actif à ce programme n’est vérifié pour ce compte.`;
  }
  const records = Array.isArray(dataContext?.clientContext?.records)
    ? dataContext.clientContext.records.filter((row) => (
      String(row?.programKey || '').toLowerCase().replace(/^tableaux-/, '') === program.key
    ))
    : [];
  const country = dataContext?.clientContext?.userCountry || '';
  const period = dataContext?.clientContext?.personalPeriodStatistics;
  const missingData = records.length === 0;
  const lines = [
    isEnglish
      ? `Access recognized: ${program.label}. I am your official guide for this programme within the data authorized for your account.`
      : `Accès reconnu : ${program.label}. Je suis votre guide officiel pour ce programme, dans le périmètre des données autorisées pour votre compte.`,
    missingData
      ? (isEnglish
        ? `I do not yet have enough validated records for ${country || 'your country'}. To orient you correctly, send complete published results with the country, date, draw time, draw number and configured number groups.`
        : `Je n’ai pas encore assez de résultats validés pour ${country || 'votre pays'}. Pour vous orienter correctement, transmettez des tirages complets avec le pays, la date, l’heure, le numéro du tirage et les groupes de numéros configurés.`)
      : (isEnglish
        ? `I can compare the ${records.length} authorized observation(s) available for this programme by country, day, draw time, delay and period.`
        : `Je peux comparer les ${records.length} observation(s) autorisée(s) disponibles pour ce programme par pays, jour, heure de tirage, délai et période.`),
    period?.available
      ? (isEnglish
        ? `The personal comparison starts at the verified access date: ${period.from || 'access start'}.`
        : `La comparaison personnelle commence à la date d’accès vérifiée : ${period.from || 'début de l’accès'}.`)
      : '',
    isEnglish
      ? 'I will clearly separate published facts, historical tendencies and information that still needs confirmation. I do not ask you to renew; I focus on useful, verifiable analysis.'
      : 'Je distingue clairement les faits publiés, les tendances historiques et les informations qui doivent encore être confirmées. Je ne vous demande pas de vous réabonner ; je me concentre sur une analyse utile et vérifiable.'
  ].filter(Boolean);
  return lines.join('\n');
}

function chatTableauContextAnswer(question, locale, dataContext) {
  const isEnglish = String(locale).startsWith('en');
  const program = chatRequestedProgram(question);
  const tableauKeys = new Set([
    'universelle',
    'intuition',
    'oracle',
    'lnb',
    'balsa',
    'standby',
    'robot',
    'created'
  ]);
  if (!program || !tableauKeys.has(program.key)) return '';

  const hasAccess = chatProgramAccess(dataContext, program.key);
  if (!hasAccess) {
    return isEnglish
      ? `I understand that you are asking about the ${program.label} Tableau, but no active access to this Tableau is verified for the account. I will not replace its data with public results.`
      : `J’ai bien compris que votre question concerne le Tableau ${program.label}, mais aucun accès actif à ce Tableau n’est vérifié pour votre compte. Je ne vais pas remplacer ses données par des résultats publics.`;
  }

  const context = dataContext?.clientContext || {};
  const current = Array.isArray(context.currentPrograms)
    ? context.currentPrograms.find((row) => (
      String(row?.programKey || '').toLowerCase().replace(/^tableaux-/, '') === program.key
    ))
    : null;
  const currentPayload = current?.available && current?.payload
    ? current.payload
    : null;
  const currentLine = currentPayload
    ? (isEnglish
      ? `The current authorized ${program.label} publication is ${current.programmeDate}. Key: ${currentPayload.key || 'not published'}; order: ${currentPayload.order || 'not published'}; code: ${currentPayload.code || 'not published'}; NAP1: ${chatValueLabel(currentPayload.nap?.nap1) || 'not published'}; NAP2: ${chatValueLabel(currentPayload.nap?.nap2) || 'not published'}. Source: ${current.sourceTable}; updated: ${current.updatedAt || current.createdAt || 'unknown'}.`
      : `La publication actuelle autorisée de ${program.label} est celle du ${current.programmeDate}. Clé : ${currentPayload.key || 'non publiée'} ; ordre : ${currentPayload.order || 'non publié'} ; code : ${currentPayload.code || 'non publié'} ; NAP1 : ${chatValueLabel(currentPayload.nap?.nap1) || 'non publié'} ; NAP2 : ${chatValueLabel(currentPayload.nap?.nap2) || 'non publié'}. Source : ${current.sourceTable} ; mise à jour : ${current.updatedAt || current.createdAt || 'inconnue'}.`)
    : current
      ? (isEnglish
        ? `Your ${program.label} access is recognized, but no current published payload is available for ${current.programmeDate}. I will not replace it with another programme.`
        : `Votre accès à ${program.label} est reconnu, mais aucune donnée publiée actuelle n’est disponible pour le ${current.programmeDate}. Je ne la remplacerai pas par celle d’un autre programme.`)
      : '';
  const records = Array.isArray(context.records)
    ? context.records.filter((row) => (
      String(row?.programKey || row?.program || row?.programName || '')
        .toLowerCase()
        .replace(/^tableaux-/, '') === program.key
    ))
    : [];
  const statistics = [
    ...(Array.isArray(context.allProgramStatistics) ? context.allProgramStatistics : []),
    ...(Array.isArray(context.dayProgramStatistics) ? context.dayProgramStatistics : [])
  ].filter((row) => (
    String(row?.programKey || row?.program || row?.programName || '')
      .toLowerCase()
      .replace(/^tableaux-/, '') === program.key
  ));
  const exact = /\b(key|cl[eé]|num[eé]ros?|cross|croix|nap|satellite|combinaison|details?|d[eé]tails?|data|donn[eé]es?)\b/i
    .test(String(question || ''));
  if (isEnglish) {
    return [
      `I understand: you are asking about the ${program.label} Tableau, not public results.`,
      `Your access to ${program.label} is recognized. I must answer only with data authorized for this Tableau.`,
      currentLine,
      records.length
        ? `The assistant memory contains ${records.length} authorized ${program.label} observation(s) that can be compared by country, date, draw time and trend.`
        : statistics.length
          ? `The memory contains ${statistics.length} published indicator(s) for ${program.label}.`
          : `No detailed ${program.label} observation is currently attached to the chat memory.`,
      exact
        ? `For the exact value of the day, open Categories → Tableaux → ${program.label}; the unlocked Tableau card is the official source for its key, cross and NAP values.`
        : `Give me the country, date and draw time if you want a precise reading of ${program.label}.`
    ].join('\n');
  }
  return [
    `J’ai bien compris : vous parlez du Tableau ${program.label}, pas des résultats publics.`,
    `Votre accès à ${program.label} est reconnu. Je dois répondre uniquement avec les données autorisées pour ce Tableau.`,
    currentLine,
    records.length
      ? `La mémoire du virtuel contient ${records.length} observation(s) autorisée(s) de ${program.label}, comparables par pays, date, heure et tendance.`
      : statistics.length
        ? `La mémoire contient ${statistics.length} indicateur(s) publié(s) pour ${program.label}.`
        : `Aucune observation détaillée de ${program.label} n’est encore jointe à la mémoire du chat.`,
    exact
      ? `Pour la valeur exacte du jour, ouvrez Catégories → Tableaux → ${program.label} : la carte du tableau débloqué est la source officielle de sa clé, sa croix et ses NAP.`
      : `Indiquez le pays, la date et l’heure concernés pour une lecture précise de ${program.label}.`
  ].join('\n');
}

function chatSiteOverviewAnswer(question, locale) {
  const isEnglish = String(locale).startsWith('en');
  const text = String(question || '');
  if (!/(nouveau|nouvelle|d[eé]buter|commencer|pr[eé]sent|options?|fonctions?|services?|programmes?|tableaux?|m[eé]thodes?|grille|lecture|horaires?|fonctionnement|navigation|guide|aide|site|cidmap|assistant|ia\b|virtuel|expliquer|structure|propose|what|new user|start|begin|features?|schedule|hours|how does it work)/i.test(text)) {
    return '';
  }
  if (/(prix|tarif|co[uû]t|acheter|achat|d[eé]bloqu|acc[eè]s actif|mon abonnement|my access)/i.test(text)) {
    return '';
  }

  if (isEnglish) {
    return [
      'Cidmap is organized around these real sections:',
      '• Home: the public site overview and current publications.',
      '• Categories and Offers: access to the configured methods, subscriptions and individual unlocks.',
      '• Tableaux: Universelle, Intuition, Oracle, LNB, Balsa Plus, Stand-by, Robot and custom programmes.',
      '• Matrice: calculation that produces the 10 numbers used by the next decoding step.',
      '• Déchiffrement MT / Déchiffrement Plus: couples, correspondences and groups derived from the authorized Matrice numbers.',
      '• Croix nationale and Boules rejetées: their respective method areas.',
      '• Anticipé: validated future publications, only when a real early-access entitlement is active.',
      '• Résultat-Aide: published results, historical indicators, statistics and authorized result submission.',
      '• Historiques: archives available according to the account rights.',
      '• Account and Cidmap virtual: profile, access state, support and explanations.',
      'The assistant can explain concepts such as keys, NAP1, NAP2, order, combinations, satellites, permutations and percentages. These are analytical notions, not guaranteed predictions. Exact keys, numbers and private results are shown only when the account and the requested programme authorize them. Prices and active access always come from the current configuration.'
    ].join('\n');
  }

  return [
    'Cidmap est organisé autour de ces sections réelles :',
    '• Accueil : aperçu public du site et publications actuelles.',
    '• Catégories et Offres : accès aux méthodes configurées, abonnements et déblocages individuels.',
    '• Tableaux : Universelle, Intuition, Oracle, LNB, Balsa Plus, Stand-by, Robot et Programmes personnalisés.',
    '• Matrice : calcul qui produit les 10 numéros utilisés par l’étape de déchiffrement.',
    '• Déchiffrement MT / Déchiffrement Plus : couples, correspondances et groupes construits à partir des numéros autorisés de la Matrice.',
    '• Croix nationale et Boules rejetées : leurs espaces de méthode respectifs.',
    '• Anticipé : publications futures validées, uniquement lorsqu’un accès anticipé réel est actif.',
    '• Résultat-Aide : résultats publiés, indicateurs historiques, statistiques et transmission autorisée de résultats.',
    '• Historiques : archives disponibles selon les droits du compte.',
    '• Compte et Cidmap virtuel : profil, état des accès, support et explications.',
    'Le virtuel peut expliquer les notions de clés, NAP1, NAP2, ordre, combinaisons, satellites, permutations et pourcentages. Ce sont des notions d’analyse, pas des prédictions garanties. Les clés exactes, les numéros et les résultats privés ne sont montrés que si le compte et le programme demandé les autorisent. Les prix et les accès actifs proviennent toujours de la configuration actuelle.'
  ].join('\n');
}

function chatSiteSurfaceAnswer(question, locale, dataContext) {
  const isEnglish = String(locale).startsWith('en');
  const text = String(question || '');
  if (!/(comment|utilis|fonction|marche|sert|expliqu|ouvrir|trouver|acc[eè]der|o[uù]|quelle|quel|where|how|use|work|open|find|explain)/i.test(text)) {
    return '';
  }

  const authorized = (key) => chatProgramAccess(dataContext, key);
  if (/\b(matrice|matrices)\b/i.test(text)) {
    return isEnglish
      ? 'Open the Matrice section, enter the requested values and click Calculate. The page displays the calculated matrix and the 10 generated numbers. Click Continue to open the dedicated Déchiffrement Plus step. Exact private calculations are available only when the account has the corresponding access.'
      : 'Ouvrez la section Matrice, saisissez les valeurs demandées puis cliquez sur « Calculer ». La page affiche la Matrice calculée et les 10 numéros générés. Cliquez sur « Continuer » pour ouvrir l’étape Déchiffrement Plus dédiée. Les calculs privés détaillés restent accessibles uniquement si le compte possède le droit correspondant.';
  }

  if (/\b(tableaux?|programmes?)\b/i.test(text)) {
    const accessText = authorized('tableaux')
      ? (isEnglish
        ? 'Your synchronized account scope includes Tableaux.'
        : 'Le périmètre synchronisé de votre compte inclut les Tableaux.')
      : (isEnglish
        ? 'The available Tableaux depend on the active subscription or individual unlocks synchronized for the account.'
        : 'Les Tableaux disponibles dépendent de l’abonnement actif ou des déblocages individuels synchronisés pour le compte.');
    return [
      isEnglish
        ? 'Open Categories, then the Tableaux area, and select the requested method.'
        : 'Ouvrez Catégories, puis la section Tableaux, et sélectionnez la méthode souhaitée.',
      accessText,
      isEnglish
        ? 'The assistant does not reveal a private Tableau result or exact key when that Tableau is not authorized.'
        : 'Le virtuel ne révèle pas le résultat privé ni la clé exacte d’un Tableau qui n’est pas autorisé.'
    ].join('\n');
  }

  if (/\b(croix|croix nationale)\b/i.test(text)) {
    return isEnglish
      ? 'Open Categories, then Croix nationale. The page presents the current method and its published context. Any private calculation remains subject to the account access.'
      : 'Ouvrez Catégories, puis « Croix nationale ». La page présente la méthode et son contexte publié. Tout calcul privé reste soumis aux droits du compte.';
  }

  if (/\b(boules?\s+rejet|rejet[eé]es?)\b/i.test(text)) {
    return isEnglish
      ? 'Open Categories, then Boules rejetées. The section shows the method data available to the current account and does not bypass access controls.'
      : 'Ouvrez Catégories, puis « Boules rejetées ». La section affiche les données de la méthode disponibles pour le compte actuel et ne contourne pas les contrôles d’accès.';
  }

  if (/\b(r[eé]sultat[- ]?aide|r[eé]sultats?\s+publi[eé]s?|statistiques?)\b/i.test(text)) {
    return isEnglish
      ? 'Open Résultat-Aide to consult published results and authorized statistics. The assistant distinguishes a published result from a historical indicator and can guide an authorized result submission.'
      : 'Ouvrez « Résultat-Aide » pour consulter les résultats publiés et les statistiques autorisées. Le virtuel distingue un résultat publié d’un indicateur historique et peut guider la transmission d’un résultat autorisé.';
  }

  if (/\b(historiques?|archives?)\b/i.test(text)) {
    return isEnglish
      ? 'Open Historiques to search the archives available for the account. Older periods can require the corresponding historical access.'
      : 'Ouvrez « Historiques » pour rechercher les archives disponibles pour le compte. Les périodes anciennes peuvent nécessiter le déblocage historique correspondant.';
  }

  if (/\b(offres?|abonnement|forfait|compte|solde|support)\b/i.test(text)) {
    return isEnglish
      ? 'Use the Account and Categories/Offers areas to review the synchronized account state, configured offers and support options. Prices and access are read from the current configuration.'
      : 'Utilisez les sections « Compte » et « Catégories/Offres » pour consulter l’état synchronisé du compte, les offres configurées et le support. Les prix et les accès proviennent de la configuration actuelle.';
  }

  return '';
}

function chatEthicsAnswer(question, locale) {
  const isEnglish = String(locale).startsWith('en');
  if (!/(gagner|gain|gains?|remporter|profit|win|winning)/i.test(String(question || ''))
    || !/(obligatoir|certain|garanti|garantie|100\s*%|s[uû]r|assur[eé]|abonn|subscri|forfait|plan)/i.test(String(question || ''))) {
    return '';
  }
  return isEnglish
    ? [
      '**An important clarification**',
      'No subscription guarantees a win, and I cannot promise a certain result.',
      '',
      '**What the plans provide**',
      '• Algorithmic and statistical tools.',
      '• Guidance through real data, authorized tables and historical records.',
      '• Indicators whose relevance depends on the country, programme and number of published observations.',
      '',
      'If you are subscribed, I am here to guide you through the real data and tables. Historical percentages are indicators, never certainty.'
    ].join('\n')
    : [
      '**Une précision importante**',
      'Non. Un abonnement ne garantit jamais un gain et je ne peux pas promettre un résultat certain.',
      '',
      '**Ce que les plans apportent**',
      '• Des outils de calcul algorithmique et statistique.',
      '• Un accompagnement à travers les données réelles, les tableaux autorisés et les historiques.',
      '• Des indicateurs dont la pertinence dépend du pays, du programme et du nombre d’observations publiées.',
      '',
      'Si vous êtes abonné, je suis là pour vous guider à travers les données réelles et les tableaux. Les pourcentages historiques sont des indicateurs, jamais une certitude.'
    ].join('\n');
}

function chatProtectedAccessAnswer(question, locale, dataContext) {
  const context = dataContext?.clientContext || {};
  const access = context.assistantAccess || {};
  if (access.canHelp === true || access.isAdmin === true || access.isModerator === true) return '';
  if (!/(cl[eé]|nap|satellite|combinaison|permutation|statistiques?\s+(personnelles|d[eé]taill[eé]es|priv[eé]es)|analyse\s+(personnelle|d[eé]taill[eé]e)|tableau|programme)/i.test(String(question || ''))) {
    return '';
  }
  const isEnglish = String(locale).startsWith('en');
  const plans = Array.isArray(dataContext?.catalogue?.plans)
    ? dataContext.catalogue.plans.slice(0, 5)
    : [];
  const offerLines = plans.map((plan) => {
    const price = plan.priceLabel || (
      Number(plan.stars) > 0
        ? `${plan.stars} étoile(s)`
        : Number(plan.tokens) > 0
          ? `${plan.tokens} jeton(s)`
          : 'tarif publié non renseigné'
    );
    const duration = Number(plan.durationDays) > 0 ? ` · ${plan.durationDays} jours` : '';
    return `• ${plan.name || plan.slug || 'Forfait'} : ${price}${duration}`;
  });
  return isEnglish
    ? [
      '**Protected data access**',
      'I can explain the method, but I cannot display a private key, Tableau or detailed statistic without an active entitlement verified for this account.',
      '',
      '**How to read a key and its efficiency**',
      'A key is a selection tool produced by a calculation. Its percentage is measured on published results, separately by country, programme, draw time and observation period.',
      'A high percentage remains a historical observation. It can change with new draws and never guarantees a win.',
      '',
      offerLines.length ? '**Published offers**' : '**Unlock access**',
      ...(offerLines.length ? offerLines : ['Open Categories → Offers to review the configured catalogue.']),
      '',
      'An active subscription or individual unlock opens only the tables included in that entitlement. Public results remain available separately.'
    ].join('\n')
    : [
      '**Accès aux données protégées**',
      'Je peux expliquer le fonctionnement, mais je ne peux pas afficher directement une clé, un Tableau ou une statistique détaillée sans droit actif vérifié pour ce compte.',
      '',
      '**Comment lire une clé et son efficacité**',
      'Une clé est un outil de sélection issu d’un calcul. Son pourcentage est mesuré sur des résultats publiés, séparément selon le pays, le programme, l’heure du tirage et la période observée.',
      'Un pourcentage élevé reste une observation historique. Il peut évoluer avec les nouveaux tirages et ne garantit jamais un gain.',
      '',
      offerLines.length ? '**Offres publiées**' : '**Débloquer l’accès**',
      ...(offerLines.length ? offerLines : ['Ouvrez Catégories → Offres pour consulter le catalogue configuré.']),
      '',
      'Un abonnement actif ou un déblocage individuel ouvre uniquement les tableaux inclus dans ce droit. Les résultats publics restent accessibles séparément.'
    ].join('\n');
}

function chatDatabaseAnswer(question, locale, dataContext) {
  const ethics = chatEthicsAnswer(question, locale);
  if (ethics) return ethics;
  const countryAccess = chatCountryAccessAnswer(question, locale);
  if (countryAccess) return countryAccess;
  const functionKnowledge = chatFunctionKnowledgeAnswer(question, locale);
  if (functionKnowledge) return functionKnowledge;
  const intent = chatQuestionIntent(question);
  if (intent.type === 'program-guide') {
    const surface = chatSiteSurfaceAnswer(question, locale, dataContext);
    if (surface) return surface;
    const overview = chatSiteOverviewAnswer(question, locale);
    if (overview) return overview;
  }
  const dechiffrement = chatDechiffrementAnswer(question, locale, dataContext);
  if (dechiffrement) return dechiffrement;
  const futureAccess = chatFutureAccessAnswer(question, locale, dataContext);
  if (futureAccess) return futureAccess;
  const protectedAccess = chatProtectedAccessAnswer(question, locale, dataContext);
  if (protectedAccess) return protectedAccess;
  const publishedResult = chatPublishedResultAnswer(question, locale, dataContext);
  if (publishedResult) return publishedResult;
  const tableauContext = chatTableauContextAnswer(question, locale, dataContext);
  if (tableauContext) return tableauContext;
  const specialistGuide = chatSpecialistGuideAnswer(question, locale, dataContext);
  if (specialistGuide) return specialistGuide;
  const text = String(question || '');
  const broadOverview = /(?:nouveau|nouvelle|options?|fonctions?|services?|programmes?|tableaux?|m[eé]thodes?|grille|lecture|horaires?|fonctionnement|navigation|guide|aide|structure|site|cidmap|assistant|virtuel|propose|pr[eé]sent)/i
    .test(text)
    && !/(comment|utilis|fonctionne|ouvrir|trouver|acc[eè]der|o[uù]\s|where|how|use|work|open|find)/i
      .test(text);
  if (broadOverview) {
    const overview = chatSiteOverviewAnswer(question, locale);
    if (overview) return overview;
  }
  const siteSurface = chatSiteSurfaceAnswer(question, locale, dataContext);
  if (siteSurface) return siteSurface;
  const overview = chatSiteOverviewAnswer(question, locale);
  if (overview) return overview;
  const isEnglish = String(locale).startsWith('en');
  const asksPricing = /\b(prix|tarif|tarifs|co[uû]t|abonnement|abonnements|forfait|forfaits|[eé]toiles?|jetons?|price|pricing|subscription|subscriptions|plan|plans|cost)\b/i
    .test(String(question || ''));
  if (!asksPricing) return '';

  const plans = Array.isArray(dataContext?.catalogue?.plans)
    ? dataContext.catalogue.plans
    : [];
  if (!plans.length) {
    return isEnglish
      ? 'No active subscription price is currently configured in the project catalogue. The support team must configure or confirm the offer before a price can be displayed.'
      : 'Aucun tarif d’abonnement actif n’est actuellement configuré dans le catalogue du projet. Le support doit d’abord configurer ou confirmer l’offre avant qu’un prix puisse être affiché.';
  }

  const planLines = plans.map((plan) => {
    const prices = [];
    if (Number(plan.stars) > 0) prices.push(`${plan.stars} étoile(s)`);
    if (Number(plan.tokens) > 0) prices.push(`${plan.tokens} jeton(s)`);
    const price = String(plan.priceLabel || '').trim()
      || (prices.length ? prices.join(' ou ') : (isEnglish ? 'price not configured' : 'tarif non configuré'));
    const duration = Number(plan.durationDays) > 0
      ? (isEnglish ? ` · ${plan.durationDays} days` : ` · ${plan.durationDays} jours`)
      : '';
    return `• ${plan.name || plan.slug}: ${price}${duration}`;
  });
  const intro = isEnglish
    ? 'Here are the subscription prices currently configured in the project database:'
    : 'Voici les tarifs d’abonnement actuellement configurés dans la base de données du projet :';
  const note = isEnglish
    ? 'These are the configured catalogue values. If an offer is missing, it has not been published in the administration settings.'
    : 'Ce sont les valeurs du catalogue configurées par l’administration. Si une offre manque, elle n’a pas été publiée dans les paramètres administrateur.';
  return [intro, ...planLines, note].join('\n');
}

function chatInformativeFallback(question, locale, dataContext) {
  const isEnglish = String(locale).startsWith('en');
  if (isEnglish) {
    if (/\b(how|work|method|cidmap|assistant|virtual)\b/i.test(question)) {
      return [
        'Cidmap virtuel answers from the published records, the configured catalogue and the access scope attached to your account.',
        'It can explain the available tables, read published results, compare historical indicators and guide a result submission when the account is authorized.',
        'Historical percentages are indicators only, never a guarantee. Private numbers and statistics remain limited to the programmes allowed for your account.'
      ].join('\n');
    }
    if (/\b(result|draw|submit|send|publish|transmit)\b/i.test(question)) {
      return [
        'You can submit a result from the “Transmit a result” shortcut in the conversation.',
        'The form records the country, date, time, draw number and number groups. The result is published directly only when the current access permits it; otherwise it remains pending confirmation.',
        'A result is not shown as published until the configured verification step is complete.'
      ].join('\n');
    }
    if (/\b(stat|analysis|recommend|table|offer|plan|subscription)\b/i.test(question)) {
      const plans = dataContext?.catalogue?.plans || [];
      const tableaux = dataContext?.catalogue?.tableaux || [];
      const planText = plans.length
        ? `The current catalogue contains ${plans.length} configured plan(s).`
        : 'No active plan is currently exposed by the catalogue.';
      const tableText = tableaux.length
        ? `The configured tables are: ${tableaux.map((item) => item.name || item.key).join(', ')}.`
        : 'No configured table is currently exposed.';
      return [
        planText,
        tableText,
        'For a recommendation, ask for a country. I use published observations only and clearly distinguish an historical indication from a confirmed result.'
      ].join('\n');
    }
    return [
      'I can help you understand Cidmap, consult published draw information, review the configured tables and plans, or guide you through a result submission.',
      'Ask a precise question with a country, date, draw time or programme name when you need a verified answer.',
      'I will clearly separate published facts, historical indicators and information that still needs confirmation.'
    ].join('\n');
  }

  if (/\b(comment|fonctionne|méthode|cidmap|assistant|virtuel)\b/i.test(question)) {
    return [
      'Cidmap virtuel répond à partir des résultats publiés, du catalogue configuré et du niveau d’accès associé à votre compte.',
      'Il peut expliquer les tableaux disponibles, retrouver les résultats publiés, comparer des indicateurs historiques et guider la transmission d’un résultat lorsque le compte est autorisé.',
      'Les pourcentages historiques sont uniquement des indicateurs, jamais une garantie. Les numéros et statistiques privées restent limités aux programmes autorisés pour votre compte.'
    ].join('\n');
  }
  if (/\b(résultat|resultat|tirage|envoyer|publier|transmettre)\b/i.test(question)) {
    return [
      'Vous pouvez transmettre un résultat depuis le bouton « Transmettre un résultat » dans la conversation.',
      'Le formulaire recueille le pays, la date, l’heure, le numéro de tirage et les groupes de numéros. La publication est directe uniquement si votre accès actuel l’autorise ; sinon le résultat reste en attente de confirmation.',
      'Un résultat n’est pas présenté comme publié avant la fin de l’étape de vérification configurée.'
    ].join('\n');
  }
  if (/\b(statistique|statistiques|analyse|recommand|tableau|offre|forfait|abonnement)\b/i.test(question)) {
    const plans = dataContext?.catalogue?.plans || [];
    const tableaux = dataContext?.catalogue?.tableaux || [];
    const planText = plans.length
      ? `Le catalogue actuel contient ${plans.length} forfait(s) configuré(s).`
      : 'Aucun forfait actif n’est actuellement exposé par le catalogue.';
    const tableText = tableaux.length
      ? `Les tableaux configurés sont : ${tableaux.map((item) => item.name || item.key).join(', ')}.`
      : 'Aucun tableau configuré n’est actuellement exposé.';
    return [
      planText,
      tableText,
      'Pour une recommandation, indiquez un pays. Je m’appuie uniquement sur les observations publiées et je distingue clairement une indication historique d’un résultat confirmé.'
    ].join('\n');
  }
  return [
    'Je peux vous expliquer Cidmap, consulter les informations publiées d’un tirage, présenter les tableaux et forfaits configurés ou vous guider pour transmettre un résultat.',
    'Pour une réponse vérifiable, indiquez si possible le pays, la date, l’heure du tirage ou le nom du programme concerné.',
    'Je distingue toujours les faits publiés, les indicateurs historiques et les informations qui doivent encore être confirmées.'
  ].join('\n');
}

async function withChatTimeout(task, timeoutMs, label = 'chat operation') {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve(task), timeout]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

async function virtualChatApi(request, env) {
  await ensureVirtualChatSchema(env);
  let input = {};
  if (request.method === 'POST') {
    try { input = await request.json(); } catch (_) { return json({ error: 'JSON invalide.' }, 400); }
  } else {
    const url = new URL(request.url);
    input = {
      cid: url.searchParams.get('cid'),
      sessionId: url.searchParams.get('sessionId'),
      localeCode: url.searchParams.get('localeCode')
    };
  }
  const authoritative = await readAuthoritativeSupabaseContext(request, env);
  const actor = chatActor(request, input, authoritative);
  if (!actor) return json({ error: 'Connectez-vous pour utiliser le chat virtuel.' }, 401);
  const session = await getOrCreateChatSession(env, actor, input);

  if (request.method === 'GET') {
    const recent = await env.DB.prepare(`
      SELECT role, content, source, created_at
      FROM chat_messages
      WHERE session_id = ? AND user_id = ?
      ORDER BY id DESC LIMIT 24
    `).bind(session.id, actor.userId).all();
    return json({
      ok: true,
      sessionId: session.id,
      summary: String(session.summary || ''),
      messages: (recent.results || []).reverse().map(chatMessageFromRow)
    });
  }

  if (request.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405);
  const question = cleanMessageText(input.message, 4000);
  if (!question) return json({ error: 'Écrivez une question avant de l’envoyer.' }, 400);
  const locale = chatLocale(input.localeCode);
  session.locale_code = locale;
  const mode = String(input.mode || 'answer').trim().toLowerCase();
  const verifiedClientContext = mergeAuthoritativeChatContext(
    {
      ...(input.context || {}),
      userId: actor.userId,
      userRole: input.userRole || input.context?.userRole || 'visitor',
      subscriptionTier: input.subscriptionTier || input.context?.subscriptionTier || '',
      currentSurface: input.context?.currentSurface || 'virtual-assistant'
    },
    authoritative
  );
  if (mode === 'verify') {
    const accessVerified = authoritative?.access
      ? true
      : Boolean(request.headers.get('x-websim-user-id') && authoritative?.unavailable !== true);
    return json({
      ok: true,
      sessionId: session.id,
      accessVerified,
      access: authoritative?.access || verifiedClientContext.assistantAccess || null,
      verifiedContext: compactChatContext(verifiedClientContext),
      assistantContext: chatClientAssistantContext(verifiedClientContext)
    });
  }
  try {
    await appendChatMessage(env, session, actor, 'user', question, input.source || 'virtual-assistant');
  } catch (error) {
    // A transient history write must not erase the answer for the visitor.
    console.error('virtual chat user history failed', error);
  }

  if (mode === 'record') {
    const answer = cleanMessageText(input.answer, 8000);
    if (!answer) return json({ error: 'Réponse à enregistrer manquante.' }, 400);
    await appendChatMessage(env, session, actor, 'assistant', answer, input.source || 'deterministic');
    const trimmed = await trimChatSession(env, session, actor);
    return json({ ok: true, sessionId: session.id, answer, history: trimmed.history });
  }

  let knowledge = [];
  try {
    knowledge = await withChatTimeout(
      readChatKnowledge(env),
      5000,
      'chat knowledge'
    );
  } catch (error) {
    console.error('virtual chat knowledge unavailable', error);
  }
  const ranked = knowledge
    .map((row) => ({ row, score: chatKnowledgeScore(question, row) }))
    .filter((entry) => entry.score >= 0.34)
    .sort((left, right) => (
      (Number(right.row.priority) || 0) - (Number(left.row.priority) || 0)
      || right.score - left.score
    ));
  const top = ranked[0] || null;
  const intent = chatQuestionIntent(question);
  const clientContext = {
    ...verifiedClientContext,
    userId: authoritative?.access?.user?.id || actor.userId,
    assistantIntent: intent.type
  };
  let dataContext;
  if (clientContext.dataSource === 'supabase') {
    dataContext = supabaseChatDataContext(clientContext);
  } else {
    try {
      dataContext = await withChatTimeout(
        readChatDataContext(env, clientContext),
        7000,
        'chat context'
      );
    } catch (error) {
      console.error('virtual chat context unavailable', error);
      dataContext = {
        source: 'unknown',
        catalogue: {
          plans: [],
          tableaux: [],
          payment: null
        },
        clientContext: compactChatContext(clientContext)
      };
    }
  }
  let answer = '';
  let source = 'ai-rag';
  const databaseAnswer = chatDatabaseAnswer(question, locale, dataContext);
  if (databaseAnswer) {
    answer = databaseAnswer;
    source = 'database';
  } else if (top && intent.type !== 'program-guide') {
    // A manual entry is an authoritative override: it is returned verbatim
    // once the question is close enough to its intent/keywords.
    answer = top.row.answer;
    source = `admin-knowledge:${top.row.id}`;
  } else {
    let memory = { history: [], summary: '' };
    try {
      memory = await withChatTimeout(
        trimChatSession(env, session, actor),
        5000,
        'chat history'
      );
    } catch (error) {
      console.error('virtual chat history unavailable', error);
    }
    /*
     * appendChatMessage() stores the current question before the memory is
     * read. trimChatSession() therefore includes that question in its
     * short history, while the completion below also appends it as the
     * current user turn. Sending it twice makes follow-up answers less
     * reliable and can make the assistant appear to ignore the user's last
     * clarification.
     */
    const priorHistory = memory.history.slice();
    const lastHistoryMessage = priorHistory.at(-1);
    if (
      lastHistoryMessage?.role === 'user'
      && String(lastHistoryMessage.content || '') === question
    ) {
      priorHistory.pop();
    }
    const language = locale.startsWith('en') ? 'English' : locale.startsWith('es') ? 'Spanish'
      : locale.startsWith('pt') ? 'Portuguese' : locale.startsWith('ar') ? 'Arabic' : 'French';
    const system = [
      `You are the official Cidmap virtual assistant. Answer only in ${language}.`,
      `Detected intent: ${intent.type} (${intent.label}). Treat this classification as the routing contract for the current turn.`,
      'Routing contract: program-guide questions must explain programmes, methods, schedules, access and navigation; they must never be answered with a count of published results. result-search questions may retrieve an exact published result only when the requested country/date/time/history is present in the retrieved data. account-guide questions explain plans, access and account state from the synchronized context. general-guide questions receive a clear, pedagogical site explanation.',
      'Act as the official Cidmap presenter and community manager: identify the user intent and the named programme first, answer the targeted question directly, explain the relevant site path clearly, and ask one precise clarification only when a required country, date, time or programme is missing.',
      'Use a corporate, direct, polite and concise tone.',
      'Always finish with a complete sentence. If the requested information is unavailable, give a short complete fallback instead of stopping mid-answer.',
      `Authenticated session context: user_id=${dataContext.clientContext.userId || 'unknown'}, user_role=${dataContext.clientContext.userRole || 'visitor'}, subscription_tier=${dataContext.clientContext.subscriptionTier || 'none'}, subscription_status=${dataContext.clientContext.subscriptionStatus || 'none'}.`,
      'The catalogue and account context below are the only source of truth. Never invent an offer, subscription, access right, tableau status, price, result, date or action.',
      'The siteSurfaces list is navigation knowledge only. Use it to explain where a real feature lives, but never infer access, prices or data from the list.',
      'The functionCatalogue is teaching knowledge for the deployed BIG functions. Use it to explain the role and workflow of a named function in a pedagogical way. It does not grant access to private outputs and it never replaces live database values.',
      'When information is missing or cannot be verified, say so clearly and offer the support form as a concrete next step.',
      'Explain that historical percentages are indicators and never guarantees. Never mention gambling, betting, lottery operators or money gains.',
      'When an active access to a programme is verified, behave as its specialist guide: congratulate the subscriber briefly, explain what the access covers, identify the next useful action, and state exactly which country, date, time or result is missing before proposing an analysis.',
      'The specialist guide must never ask the user to renew, sell an extension, or use satisfaction as a sales argument. It may report the verified access period only when asked, and it must never imply that renewal guarantees success.',
      'When several programmes are authorized for the same user, act as a portfolio guide: compare all requested programmes together using the same country, period, draw times, days and delays. Name each programme, state the number of real observations used, distinguish a programme-specific fact from a cross-programme correlation, and let the user decide which method to follow.',
      'A normal Tableau access authorizes explanations and authorized past data, not future or pending results. Never provide a future result, exact upcoming number or upcoming Tableau output unless the retrieved context explicitly contains a verified active anticipation entitlement and the corresponding validated future publication.',
      'When comparing a subscriber history, use only the available authorized records, day patterns, delay patterns, weekly activity and personalPeriodStatistics. A personal period starts at the verified access date; do not claim a full archive when the historical entitlement or records are missing.',
      'For an authorized Tableau, you may report the exact authorized observations, remarks, dates, programmes, days, draw times and statistics that are present in the retrieved records. Do not hide an available authorized fact merely because it is detailed; keep the access boundary and the publication status.',
      'currentPrograms contains the latest authorized daily Tableau payloads read from the corresponding daily_*_programs table. When the user asks about the current or latest value of an authorized Tableau, use currentPrograms first, name its programme date and source table, and report only the fields present there. If its available flag is false, say that the current programme is not published or synchronized; never substitute another Tableau.',
      'The current daily payload is distinct from Resultat-Aide historical matches. Do not answer a Tableau question with the generic published draw count when a currentPrograms row exists.',
      'If the user asks whether a Friday may repeat a Monday pattern, compare the same authorized programme, country, draw time and relevant day/delay fields in the records. State the number of matching observations and their dates, and call it a historical pattern or hypothesis, never a certain Friday result.',
      'If the user asks whether Intuition is stronger at 21:00 this week, filter by the exact authorized programme and 21:00 draw time, use only the available current-week and historical observations, report the sample size and compare it with the other available times. If there is not enough data, say that plainly instead of converting a small sample into a probability.',
      'Respect the user access scope. Do not reveal private data outside the authorized programmes.',
      'For a country-based tableau recommendation, use only recommendationProjection. It is a secure aggregate of published records and configured offers.',
      'For recommendation prices, durations and bundle inclusions, recommendationProjection.offersByProgram is authoritative over any legacy catalogue field.',
      'Never invent a country result, score, sample size, offer, price, bundle inclusion or duration. If a country has fewer than the minimum published records, explicitly ask for at least three consecutive days or preferably one week of complete results.',
      'A recommendation is optional guidance only: present the recommended tableau, then the individual configured offer and any configured bundles that include it. Never pressure the user to buy.',
      'When a newcomer asks for the programmes or offers, explain the methods pedagogically, separate individual Tableau offers from collective bundles, and quote only the prices, durations and included programmes present in catalogue or recommendationProjection.offersByProgram. Never invent a price or imply that one access includes another programme.',
      'When a user asks for a trend, first ask for or use the country and the authorized programme. If the retrieved country has no published data, say that clearly and guide the user to the authorized result-transmission form. Ask for complete entries with country, date, draw time, draw number, first numbers, machine numbers and bonus numbers when configured.',
      'A result supplied by a user becomes usable for analysis only after the configured validation/publication step. Once validated, compare it with the authorized historical records; do not present an unvalidated submission as an official result.',
      'If a country has no recorded result, offer two honest paths: transmit validated draws for that country, or review the configured Universelle method and the configured individual or collective offers. Universelle may be a useful cross-country starting method when the catalogue says so, but its name alone never proves that every country or every other Tableau is included, and it cannot create missing results.',
      'Do not reveal keys, exact numbers, combinations, permutations or detailed statistics belonging to an unauthorized tableau.',
      'When discussing a subscriber history, distinguish the global published history from personalPeriodStatistics, which starts at the user access date and contains only authorized programmes.',
      'For a draw-number question, use drawNumberMemory only. A confirmed number is one already published for the exact country/date/time. An inferred number must be labelled as an estimate, never as a confirmed result. If the sequence is insufficient or broken, say that confirmation from the user is needed.',
      `Current date: ${dataContext.clientContext.today || new Date().toISOString().slice(0, 10)}.`,
      `Current page/surface: ${dataContext.clientContext.currentSurface || 'virtual-assistant'}.`,
      `Retrieved platform data: ${JSON.stringify(dataContext)}.`,
      `Conversation summary: ${memory.summary || 'none'}.`
    ].join(' ');
    if (env.AI?.chat) {
      try {
        const completion = await withChatTimeout(
          env.AI.chat({
            messages: [
              { role: 'system', content: system },
              ...priorHistory.map((message) => ({
                role: message.role,
                content: message.content
              })),
              { role: 'user', content: question }
            ]
          }),
          18000,
          'AI response'
        );
        answer = cleanMessageText(completion?.content, 8000);
      } catch (error) {
        console.error('virtual chat AI failed', error);
      }
    }
    if (!answer) {
      answer = chatInformativeFallback(question, locale, dataContext);
      source = 'support-fallback';
    }
  }

  try {
    await appendChatMessage(env, session, actor, 'assistant', answer, source);
  } catch (error) {
    console.error('virtual chat assistant history failed', error);
  }
  let trimmed = { history: [], summary: '' };
  try {
    trimmed = await withChatTimeout(
      trimChatSession(env, session, actor),
      5000,
      'chat history'
    );
  } catch (error) {
    console.error('virtual chat final history unavailable', error);
  }
  return json({
    ok: true,
    sessionId: session.id,
    answer,
    source,
    matchedKnowledgeId: top?.row?.id || null,
    history: trimmed.history
  });
}

async function adminChatKnowledgeApi(request, env) {
  if (!(await isConfigOwner(request))) {
    return json({ error: 'Seul le propriétaire du projet peut gérer la base de connaissances.' }, 403);
  }
  if (request.method === 'GET') {
    const { results } = await env.DB.prepare(`
      SELECT * FROM chat_knowledge
      ORDER BY enabled DESC, priority DESC, updated_at DESC, id DESC
    `).all();
    return json({ ok: true, entries: (results || []).map(chatKnowledgeFromRow) });
  }
  if (request.method === 'DELETE') {
    const url = new URL(request.url);
    const id = Number(url.pathname.split('/').pop());
    if (!Number.isInteger(id) || id <= 0) return json({ error: 'Identifiant invalide.' }, 400);
    await env.DB.prepare('DELETE FROM chat_knowledge WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }
  if (request.method !== 'POST' && request.method !== 'PUT') {
    return json({ error: 'Méthode non autorisée.' }, 405);
  }
  let body = {};
  try { body = await request.json(); } catch (_) { return json({ error: 'JSON invalide.' }, 400); }
  const id = Number(body.id);
  const intent = cleanMessageText(body.intent, 160);
  const question = cleanMessageText(body.question, 600);
  const answer = cleanMessageText(body.answer, 8000);
  const keywords = cleanMessageText(body.keywords, 500);
  const priority = Math.max(1, Math.min(10000, Number(body.priority) || 100));
  const enabled = body.enabled !== false;
  if (!intent || !question || !answer) {
    return json({ error: 'Intention, question et réponse sont obligatoires.' }, 400);
  }
  const now = new Date().toISOString();
  if (Number.isInteger(id) && id > 0) {
    await env.DB.prepare(`
      UPDATE chat_knowledge
      SET intent = ?, question = ?, answer = ?, keywords = ?, priority = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `).bind(intent, question, answer, keywords, priority, enabled ? 1 : 0, now, id).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO chat_knowledge
        (intent, question, answer, keywords, priority, enabled, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(intent, question, answer, keywords, priority, enabled ? 1 : 0, now).run();
  }
  const saved = Number.isInteger(id) && id > 0
    ? await env.DB.prepare('SELECT * FROM chat_knowledge WHERE id = ?').bind(id).first()
    : await env.DB.prepare('SELECT * FROM chat_knowledge ORDER BY id DESC LIMIT 1').first();
  return json({ ok: true, entry: saved ? chatKnowledgeFromRow(saved) : null });
}

async function ensureReferralSchema(env) {
  await env.DB.exec(REFERRAL_SCHEMA);
}

async function getReferralAccount(env, code) {
  return env.DB
    .prepare("SELECT * FROM referral_accounts WHERE referral_code = ?")
    .bind(code)
    .first();
}

async function ensureReferralAccount(env, { accountCode, userId, referredBy = null }) {
  const now = new Date().toISOString();
  const existing = await getReferralAccount(env, accountCode);
  if (existing) {
    if (referredBy && !existing.referred_by) {
      await env.DB.prepare(
        "UPDATE referral_accounts SET referred_by = ?, updated_at = ? WHERE referral_code = ?"
      ).bind(referredBy, now, accountCode).run();
    }
    return await getReferralAccount(env, accountCode);
  }

  try {
    await env.DB.prepare(`
      INSERT INTO referral_accounts
        (user_id, referral_code, referred_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(userId, accountCode, referredBy, now, now).run();
  } catch (_) {
    // A repeated account creation request is safe and should return the
    // already committed row.
  }
  return await getReferralAccount(env, accountCode);
}

async function referralApi(request, env) {
  await ensureReferralSchema(env);
  const url = new URL(request.url);

  if (request.method === "GET") {
    const code = cleanReferralCode(url.searchParams.get("accountCode"));
    if (!code) return json({ error: "Identifiant de compte manquant" }, 400);
    const account = await getReferralAccount(env, code);
    return json({ ok: true, state: referralState(account) });
  }

  if (request.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);
  let input;
  try {
    input = await request.json();
  } catch (_) {
    return json({ error: "JSON invalide" }, 400);
  }

  const action = String(input?.action || "").trim().toLowerCase();
  const accountCode = cleanReferralCode(input?.accountCode);
  const referrerCode = cleanReferralCode(input?.referrerCode);
  if (!accountCode) return json({ error: "Identifiant de compte invalide" }, 400);

  const userId = referralActor(request, accountCode);
  const account = await ensureReferralAccount(env, {
    accountCode,
    userId,
    referredBy: action === "register" ? (referrerCode || null) : null,
  });
  if (!account) return json({ error: "Compte de parrainage indisponible" }, 500);

  if (action === "share") {
    // Sharing/copying a URL is only an invitation. It must never create a
    // reward; the register action below is the sole qualifying event.
    return json({
      ok: true,
      credited: false,
      reason: "account-creation-required",
      state: referralState(account),
    });
  }

  if (action === "register") {
    if (!referrerCode || referrerCode === accountCode) {
      return json({ ok: true, credited: false, state: referralState(account) });
    }
    const visitorKey = cleanVisitorKey(input?.visitorKey);
    if (!visitorKey) return json({ error: "Identifiant visiteur invalide" }, 400);
    const accountCreatedAt = String(input?.accountCreatedAt || "").trim();
    if (!accountCreatedAt || Number.isNaN(Date.parse(accountCreatedAt))) {
      return json({ error: "Création de compte non confirmée" }, 400);
    }
    const referrer = await getReferralAccount(env, referrerCode);
    if (!referrer) {
      // A referrer can have shared before opening this browser. Creating the
      // lightweight account lets the first conversion remain attributable.
      await ensureReferralAccount(env, {
        accountCode: referrerCode,
        userId: `referral:${referrerCode}`,
      });
    }

    let credited = false;
    try {
      const now = new Date().toISOString();
      const registrationEventKey = `register:${referrerCode}:${accountCode}`;
      const existingRegistration = await env.DB
        .prepare(`
          SELECT id FROM referral_visits
          WHERE referrer_code = ? AND child_code = ?
          LIMIT 1
        `)
        .bind(referrerCode, accountCode)
        .first();
      if (existingRegistration) {
        return json({
          ok: true,
          credited: false,
          state: referralState(await getReferralAccount(env, accountCode)),
          referrerCode,
        });
      }
      await env.DB.batch([
        env.DB.prepare(`
        INSERT INTO referral_events (user_id, event_key, event_type, referrer_code, created_at)
        VALUES (?, ?, 'registration', ?, ?)
      `).bind(userId, registrationEventKey, referrerCode, now),
        env.DB.prepare(`
        INSERT INTO referral_visits
          (user_id, visitor_key, referrer_code, child_code, created_at, registered_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
          userId,
          visitorKey,
          referrerCode,
          accountCode,
          now,
          now,
        ),
        env.DB.prepare(`
        UPDATE referral_accounts
        SET share_points = share_points + 1,
            referred_by = COALESCE(referred_by, ?),
            updated_at = ?
        WHERE referral_code = ?
      `).bind(referrerCode, now, referrerCode),
        env.DB.prepare(`
        UPDATE referral_accounts
        SET referred_by = COALESCE(referred_by, ?), updated_at = ?
        WHERE referral_code = ?
      `).bind(referrerCode, now, accountCode),
      ]);
      credited = true;
    } catch (_) {
      // The unique referrer_code + visitor_key relation prevents duplicate
      // registration rewards when a page is refreshed or a form is retried.
      // The registration event key and child lookup also ensure one account
      // can only award one point to the same referrer. D1 batch keeps the
      // event, relation, and counter update atomic.
    }
    return json({
      ok: true,
      credited,
      state: referralState(await getReferralAccount(env, accountCode)),
      referrerCode,
    });
  }

  if (action === "conversion") {
    const effectiveReferrer = cleanReferralCode(account.referred_by) || referrerCode;
    if (!effectiveReferrer || effectiveReferrer === accountCode) {
      return json({ ok: true, credited: false, state: referralState(account) });
    }
    const eventKey = String(
      input?.eventKey || `conversion:${accountCode}:${String(input?.conversionId || Date.now())}`
    ).slice(0, 180);
    try {
      await env.DB.prepare(`
        INSERT INTO referral_events (user_id, event_key, event_type, referrer_code, created_at)
        VALUES (?, ?, 'conversion', ?, ?)
      `).bind(userId, eventKey, effectiveReferrer, new Date().toISOString()).run();
      await env.DB.prepare(`
        UPDATE referral_accounts
        SET stars = stars + 1, updated_at = ?
        WHERE referral_code = ?
      `).bind(new Date().toISOString(), effectiveReferrer).run();
      return json({
        ok: true,
        credited: true,
        referrerCode: effectiveReferrer,
        state: referralState(await getReferralAccount(env, accountCode)),
      });
    } catch (_) {
      return json({
        ok: true,
        credited: false,
        referrerCode: effectiveReferrer,
        state: referralState(await getReferralAccount(env, accountCode)),
      });
    }
  }

  return json({ error: "Action de parrainage inconnue" }, 400);
}

function digitalRoot(value) {
  let result = Math.abs(Number(value) || 0);
  while (result >= 10) {
    result = String(result).split("").reduce((sum, digit) => sum + Number(digit), 0);
  }
  return result;
}

function parseDate(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (!Number.isNaN(date.getTime()) &&
        date.getUTCFullYear() === Number(match[1]) &&
        date.getUTCMonth() === Number(match[2]) - 1 &&
        date.getUTCDate() === Number(match[3])) {
      return date;
    }
  }
  return null;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function dateSignature(date) {
  const day = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  const year = date.getUTCFullYear();
  const yearDigits = String(year).split("").map(Number);
  const dateDigits = [
    ...String(day).padStart(2, "0"),
    ...String(month).padStart(2, "0"),
    ...yearDigits.map(String).join(""),
  ].map(Number);
  const dateSum = day + month + yearDigits.reduce((sum, digit) => sum + digit, 0);
  const dateDigitSum = dateDigits.reduce((sum, digit) => sum + digit, 0);
  return {
    day,
    month,
    year,
    dateSum,
    dateDigitSum,
    dateFinishingDigit: digitalRoot(dateSum),
    serial: Math.floor(Date.UTC(year, month - 1, day) / 86400000),
  };
}

function parenthesizedMethod(date) {
  const year = date.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const current = Date.UTC(year, date.getUTCMonth(), date.getUTCDate());
  const dayOfYear = Math.floor((current - start) / 86400000) + 1;
  const counter = ((dayOfYear - 1) % 90) + 1;
  const two = String(counter).padStart(2, "0");
  const digits = two.split("");

  if (digits[0] === digits[1] && digits[0] !== "9") {
    const summed = String(Number(digits[0]) + Number(digits[1])).padStart(2, "0");
    return { term: `(${summed})`, removedDigits: [summed[0], summed[1]], terminaison: digits[1] };
  }
  return { term: `(${two})`, removedDigits: digits, terminaison: digits[1] };
}

function lineData(assignment) {
  return LINE_GROUPS.map((line) => {
    const values = line.map((slot) => assignment[slot - 1]);
    const sum = values.reduce((total, value) => total + value, 0);
    return { slots: line, values, sum, finishingDigit: digitalRoot(sum) };
  });
}

function alignmentSignature(alignments) {
  return alignments
    .map((alignment) => alignment.values.slice().sort((a, b) => a - b).join(""))
    .join("|");
}

function generateCandidates(availableDigits, seed, targetFinishing, preferredSum) {
  const sorted = availableDigits.slice().sort((a, b) => a - b);
  const offset = ((Math.trunc(seed) % sorted.length) + sorted.length) % sorted.length;
  const ordered = sorted.slice(offset).concat(sorted.slice(0, offset));
  const slots = Array(8).fill(null);
  const used = new Set();
  const candidates = [];

  function visit(position) {
    if (position === slots.length) {
      const alignments = lineData(slots);
      const targetScore = alignments.reduce(
        (score, alignment) => score + (alignment.finishingDigit === targetFinishing ? 1 : 0),
        0,
      );
      const preferredScore = alignments.reduce(
        (score, alignment) => score + (alignment.sum === preferredSum ? 1 : 0),
        0,
      );
      candidates.push({
        assignment: slots.slice(),
        alignments,
        signature: alignmentSignature(alignments),
        targetScore,
        preferredScore,
      });
      return;
    }
    for (const digit of ordered) {
      if (used.has(digit)) continue;
      used.add(digit);
      slots[position] = digit;
      visit(position + 1);
      slots[position] = null;
      used.delete(digit);
    }
  }

  visit(0);
  candidates.sort((a, b) => b.targetScore - a.targetScore || b.preferredScore - a.preferredScore);
  return candidates;
}

function recordFromRow(row) {
  return {
    id: row.id,
    programmeDate: row.programme_date,
    year: row.generated_year,
    month: row.generated_month,
    scope: row.scope_key,
    term: row.term,
    removedDigits: JSON.parse(row.removed_digits),
    dateSum: row.date_sum,
    dateDigitSum: row.date_digit_sum,
    dateFinishingDigit: row.date_finishing_digit,
    dateFinishing: String(row.date_finishing_digit).padStart(2, "0"),
    terminaison: row.visible_terminaison,
    assignment: JSON.parse(row.assignment),
    alignments: JSON.parse(row.alignments),
    signature: row.signature,
    createdAt: row.created_at,
  };
}

async function generateCross(request, env) {
  let input = {};
  if (request.method === "POST") {
    try {
      input = await request.json();
    } catch (_) {
      return json({ error: "JSON invalide" }, 400);
    }
  }
  const url = new URL(request.url);
  const requestedDate = input.date || url.searchParams.get("date") || isoDate(new Date());
  const date = parseDate(requestedDate);
  if (!date) return json({ error: "Date attendue au format YYYY-MM-DD" }, 400);

  const scope = input.scope === "month" || url.searchParams.get("scope") === "month" ? "month" : "year";
  const dateInfo = dateSignature(date);
  const programmeDate = isoDate(date);
  const parenthesized = parenthesizedMethod(date);
  const scopeKey = scope === "month"
    ? `M${dateInfo.year}-${String(dateInfo.month).padStart(2, "0")}`
    : `Y${dateInfo.year}`;

  await env.DB.exec(SCHEMA);

  const existingDate = await env.DB
    .prepare("SELECT * FROM cross_generations WHERE programme_date = ?")
    .bind(programmeDate)
    .first();
  if (existingDate) return json({ ok: true, reused: true, record: recordFromRow(existingDate) });

  const existingScope = await env.DB
    .prepare("SELECT signature FROM cross_generations WHERE scope_key = ?")
    .bind(scopeKey)
    .all();
  const usedSignatures = new Set((existingScope.results || []).map((row) => row.signature));

  const removed = parenthesized.removedDigits.map(Number);
  const available = DIGITS.filter((digit) => !removed.includes(digit));
  const candidates = generateCandidates(
    available,
    dateInfo.serial + dateInfo.dateSum + dateInfo.dateDigitSum + dateInfo.dateFinishingDigit,
    dateInfo.dateFinishingDigit,
    dateInfo.day,
  );
  const selected = candidates.find((candidate) => !usedSignatures.has(candidate.signature));
  if (!selected) {
    return json({
      error: "Aucune combinaison nouvelle disponible pour cette période",
      programmeDate,
      scope,
    }, 409);
  }

  const createdAt = new Date().toISOString();
  try {
    await env.DB.prepare(`
      INSERT INTO cross_generations (
        programme_date, generated_year, generated_month, scope_key, term,
        removed_digits, date_sum, date_digit_sum, date_finishing_digit,
        visible_terminaison, assignment, alignments, signature, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      programmeDate,
      dateInfo.year,
      dateInfo.month,
      scopeKey,
      parenthesized.term,
      JSON.stringify(parenthesized.removedDigits),
      dateInfo.dateSum,
      dateInfo.dateDigitSum,
      dateInfo.dateFinishingDigit,
      parenthesized.terminaison,
      JSON.stringify(selected.assignment.map(String)),
      JSON.stringify(selected.alignments),
      selected.signature,
      createdAt,
    ).run();
  } catch (error) {
    // Another request may have won the same date/signature race. Return the
    // already committed date row when available.
    const raced = await env.DB
      .prepare("SELECT * FROM cross_generations WHERE programme_date = ?")
      .bind(programmeDate)
      .first();
    if (raced) return json({ ok: true, reused: true, record: recordFromRow(raced) });
    return json({ error: "La combinaison vient d'être réservée par une autre génération" }, 409);
  }

  const saved = await env.DB
    .prepare("SELECT * FROM cross_generations WHERE programme_date = ?")
    .bind(programmeDate)
    .first();
  return json({ ok: true, reused: false, record: recordFromRow(saved) });
}

const toBool = (value, fallback = false) =>
  value === true || value === 1 || String(value).trim().toLowerCase() === 'true' ? true
    : value === false || value === 0 || value === '' || value === null || value === undefined ? fallback
      : fallback;

function configPlanFromRow(row) {
  let features = [];
  try {
    features = Array.isArray(JSON.parse(row.features || '[]')) ? JSON.parse(row.features || '[]') : [];
  } catch (_) { features = []; }
  return {
    slug: row.slug,
    display_name: row.display_name,
    unlock_currency: row.unlock_currency,
    required_stars: Number(row.required_stars) || 0,
    required_tokens: Number(row.required_tokens) || 0,
    duration_days: Number(row.duration_days) || 30,
    referral_reward_stars: Number(row.referral_reward_stars) || 1,
    price_label: row.price_label,
    features,
    payment_mode: row.payment_mode,
    enabled: Number(row.enabled) !== 0,
    updated_at: row.updated_at
  };
}

function configPriceFromRow(row, token) {
  return {
    country_code: row.country_code,
    country_name: row.country_name,
    currency_code: row.currency_code,
    currency_symbol: row.currency_symbol,
    price_per_star: token ? Number(row.price_per_star) || 0 : void 0,
    price_per_token: token ? Number(row.price_per_token) || 0 : void 0,
    amount: Number(token ? row.price_per_token : row.price_per_star) || 0,
    enabled: Number(row.enabled) !== 0,
    updated_at: row.updated_at
  };
}

function configPaymentFromRow(row) {
  if (!row) return null;
  const currencyMode = String(row.currency_mode || '').trim().toLowerCase();
  const contactChannel = ['chat', 'whatsapp'].includes(String(row.contact_channel || '').trim().toLowerCase())
    ? String(row.contact_channel || '').trim().toLowerCase()
    : 'chat';
  return {
    payment_mode: row.payment_mode,
    online_provider: row.online_provider,
    online_payment_link: row.online_payment_link,
    physical_instructions: row.physical_instructions,
    contact_label: row.contact_label,
    manual_enabled: Number(row.manual_enabled) !== 0,
    currency_mode: ['stars', 'tokens', 'both'].includes(currencyMode) ? currencyMode : 'both',
    contact_channel: contactChannel,
    whatsapp_number: String(row.whatsapp_number || '').trim(),
    chat_label: String(row.chat_label || '').trim() || 'Contacter l’équipe',
    updated_at: row.updated_at
  };
}

function configBannerFromRow(row) {
  const localized = (value) => {
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch (_) {
      return {};
    }
  };
  return {
    id: row.id,
    kind: row.kind,
    placement: row.placement,
    day: row.day === null || row.day === undefined ? null : Number(row.day),
    exact_date: row.exact_date,
    title: row.title,
    description: row.description,
    title_i18n: localized(row.title_i18n),
    description_i18n: localized(row.description_i18n),
    image_url: row.image_url,
    target_url: row.target_url,
    action_label: row.action_label,
    action_label_i18n: localized(row.action_label_i18n),
    sort_order: Number(row.sort_order) || 0,
    enabled: Number(row.enabled) !== 0,
    updated_at: row.updated_at
  };
}

function configGridFromRow(row) {
  return {
    module: row.module,
    min: Number(row.grid_min) || 1,
    max: Number(row.grid_max) || 90,
    enabled: Number(row.enabled) !== 0,
    updated_at: row.updated_at
  };
}

function configAssignmentFromRow(row) {
  return {
    grid_key: row.grid_key,
    display_name: row.display_name || row.grid_key,
    plan_slug: String(row.plan_slug || '').trim() || null,
    formula_tier: normalizeFormulaTier(row.formula_tier) || null,
    enabled: Number(row.enabled) !== 0,
    updated_at: row.updated_at
  };
}

function configIllustrationFromRow(row) {
  return {
    id: row.id,
    kind: row.kind,
    day: row.day === null || row.day === undefined ? null : Number(row.day),
    exact_date: row.exact_date,
    image_url: row.image_url,
    color: row.color,
    enabled: Number(row.enabled) !== 0,
    updated_at: row.updated_at
  };
}

async function readPlatformConfig(env) {
  await ensureTableauxAssignments(env);
  const [plans, starPrices, tokenPrices, payment, banners, grids, illustrations, assignments, commentRules, locks] = await Promise.all([
    env.DB.prepare("SELECT * FROM config_plans ORDER BY required_stars ASC, slug ASC").all(),
    env.DB.prepare("SELECT * FROM config_star_prices ORDER BY country_code ASC").all(),
    env.DB.prepare("SELECT * FROM config_token_prices ORDER BY country_code ASC").all(),
    env.DB.prepare("SELECT * FROM config_payment WHERE id = 1").first(),
    env.DB.prepare("SELECT * FROM config_banners ORDER BY sort_order ASC, id ASC").all(),
    env.DB.prepare("SELECT * FROM config_grids").all(),
    env.DB.prepare("SELECT * FROM config_daily_illustrations ORDER BY kind ASC, id ASC").all(),
    env.DB.prepare("SELECT * FROM tableaux_grid_assignments ORDER BY grid_key ASC").all(),
    env.DB.prepare("SELECT * FROM config_comment_rules ORDER BY rule_key ASC").all(),
    env.DB.prepare("SELECT * FROM config_locks ORDER BY target_type ASC, target_key ASC, id ASC").all()
  ]);
  const gridMap = {};
  (grids.results || []).forEach((row) => { gridMap[row.module] = configGridFromRow(row); });
  const illustrationList = (illustrations.results || []).map(configIllustrationFromRow);
  const illustrationMap = {};
  illustrationList.forEach((item) => {
    illustrationMap[item.kind] = illustrationMap[item.kind] || [];
    illustrationMap[item.kind].push(item);
  });
  const commentRuleMap = {};
  (commentRules.results || []).forEach((row) => {
    commentRuleMap[row.rule_key] = configCommentRuleFromRow(row);
  });
  return {
    plans: (plans.results || [])
      .filter((row) => Number(row.enabled) !== 0)
      .map(configPlanFromRow),
    plansAll: (plans.results || []).map(configPlanFromRow),
    starPrices: (starPrices.results || [])
      .filter((row) => Number(row.enabled) !== 0)
      .map((row) => configPriceFromRow(row, false)),
    tokenPrices: (tokenPrices.results || [])
      .filter((row) => Number(row.enabled) !== 0)
      .map((row) => configPriceFromRow(row, true)),
    paymentSettings: configPaymentFromRow(payment),
    banners: (banners.results || [])
      .filter((row) => Number(row.enabled) !== 0)
      .map(configBannerFromRow),
    grids: gridMap,
    gridAssignments: (assignments.results || []).map(configAssignmentFromRow),
    dailyIllustrations: illustrationMap,
    commentRules: commentRuleMap,
    locks: (locks.results || []).map(configLockFromRow),
    updatedAt: new Date().toISOString()
  };
}

async function isConfigOwner(request) {
  const userId = String(request.headers.get('x-websim-user-id') || '').trim();
  const ownerId = String(request.headers.get('x-websim-project-owner-id') || '').trim();
  if (!userId || !ownerId || userId !== ownerId) return false;
  return true;
}

async function savePlan(env, body) {
  const plan = body.plan || {};
  const slug = String(plan.slug || '').trim();
  if (!slug) return json({ error: 'Slug d’offre requis.' }, 400);
  const features = Array.isArray(plan.features) ? plan.features : [];
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO config_plans (
      slug, display_name, unlock_currency, required_stars, required_tokens,
      duration_days, referral_reward_stars, price_label, features, payment_mode,
      enabled, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      display_name = excluded.display_name,
      unlock_currency = excluded.unlock_currency,
      required_stars = excluded.required_stars,
      required_tokens = excluded.required_tokens,
      duration_days = excluded.duration_days,
      referral_reward_stars = excluded.referral_reward_stars,
      price_label = excluded.price_label,
      features = excluded.features,
      payment_mode = excluded.payment_mode,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `).bind(
    slug,
    String(plan.display_name || slug),
    String(plan.unlock_currency || 'stars'),
    Number(plan.required_stars) || 0,
    Number(plan.required_tokens) || 0,
    Number(plan.duration_days) || 30,
    Number(plan.referral_reward_stars) || 1,
    String(plan.price_label || ''),
    JSON.stringify(features),
    String(plan.payment_mode || 'manual'),
    plan.enabled !== false ? 1 : 0,
    now
  ).run();
  const row = await env.DB.prepare("SELECT * FROM config_plans WHERE slug = ?").bind(slug).first();
  return json({ ok: true, plan: configPlanFromRow(row) });
}

async function deletePlan(env, body) {
  const slug = String(body.slug || '').trim();
  if (!slug) return json({ error: 'Slug d’offre requis.' }, 400);
  await env.DB.prepare("DELETE FROM config_plans WHERE slug = ?").bind(slug).run();
  return json({ ok: true });
}

async function savePrice(env, body, token) {
  const price = body.price || {};
  const countryCode = String(price.country_code || '').trim().toUpperCase();
  if (!countryCode) return json({ error: 'Code pays requis.' }, 400);
  const table = token ? 'config_token_prices' : 'config_star_prices';
  const column = token ? 'price_per_token' : 'price_per_star';
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO ${table} (
      country_code, country_name, currency_code, currency_symbol, ${column}, enabled, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(country_code) DO UPDATE SET
      country_name = excluded.country_name,
      currency_code = excluded.currency_code,
      currency_symbol = excluded.currency_symbol,
      ${column} = excluded.${column},
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `).bind(
    countryCode,
    String(price.country_name || countryCode),
    String(price.currency_code || ''),
    String(price.currency_symbol || ''),
    Number(price.amount ?? price.price_per_star ?? price.price_per_token) || 0,
    price.enabled !== false ? 1 : 0,
    now
  ).run();
  const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE country_code = ?`).bind(countryCode).first();
  return json({ ok: true, price: configPriceFromRow(row, token) });
}

async function deletePrice(env, body, token) {
  const countryCode = String(body.country_code || '').trim().toUpperCase();
  if (!countryCode) return json({ error: 'Code pays requis.' }, 400);
  const table = token ? 'config_token_prices' : 'config_star_prices';
  await env.DB.prepare(`DELETE FROM ${table} WHERE country_code = ?`).bind(countryCode).run();
  return json({ ok: true });
}

async function savePayment(env, body) {
  const settings = body.settings || {};
  const now = new Date().toISOString();
  const currencyMode = String(settings.currency_mode || '').trim().toLowerCase();
  const validCurrencyMode = ['stars', 'tokens', 'both'].includes(currencyMode) ? currencyMode : 'both';
  const contactChannel = ['chat', 'whatsapp'].includes(String(settings.contact_channel || '').trim().toLowerCase())
    ? String(settings.contact_channel || '').trim().toLowerCase()
    : 'chat';
  await env.DB.prepare(`
    INSERT INTO config_payment (
      id, payment_mode, online_provider, online_payment_link, physical_instructions,
      contact_label, manual_enabled, currency_mode, contact_channel, whatsapp_number, chat_label, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      payment_mode = excluded.payment_mode,
      online_provider = excluded.online_provider,
      online_payment_link = excluded.online_payment_link,
      physical_instructions = excluded.physical_instructions,
      contact_label = excluded.contact_label,
      manual_enabled = excluded.manual_enabled,
      currency_mode = excluded.currency_mode,
      contact_channel = excluded.contact_channel,
      whatsapp_number = excluded.whatsapp_number,
      chat_label = excluded.chat_label,
      updated_at = excluded.updated_at
  `).bind(
    String(settings.payment_mode || 'manual'),
    String(settings.online_provider || ''),
    String(settings.online_payment_link || ''),
    String(settings.physical_instructions || ''),
    String(settings.contact_label || ''),
    settings.manual_enabled !== false ? 1 : 0,
    validCurrencyMode,
    contactChannel,
    String(settings.whatsapp_number || '').slice(0, 40),
    String(settings.chat_label || '').slice(0, 120) || 'Contacter l’équipe',
    now
  ).run();
  const row = await env.DB.prepare("SELECT * FROM config_payment WHERE id = 1").first();
  return json({ ok: true, settings: configPaymentFromRow(row) });
}

async function saveOrDeleteCommentRule(env, body) {
  if (body.action === 'delete') {
    await env.DB.prepare("DELETE FROM config_comment_rules WHERE rule_key = ?")
      .bind(String(body.key || '').trim()).run();
    return json({ ok: true });
  }
  const key = String(body.key || '').trim();
  if (!key) return json({ error: 'Règle de commentaire requise.' }, 400);
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO config_comment_rules (rule_key, comments_enabled, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(rule_key) DO UPDATE SET
      comments_enabled = excluded.comments_enabled,
      updated_at = excluded.updated_at
  `).bind(key, body.enabled === false ? 0 : 1, now).run();
  const row = await env.DB.prepare("SELECT * FROM config_comment_rules WHERE rule_key = ?").bind(key).first();
  return json({ ok: true, rule: configCommentRuleFromRow(row) });
}

function configCommentRuleFromRow(row) {
  if (!row) return null;
  return {
    key: row.rule_key,
    comments_enabled: Number(row.comments_enabled) !== 0,
    updated_at: row.updated_at
  };
}

async function saveLock(env, body) {
  const lock = body.lock || {};
  const now = new Date().toISOString();
  let id = Number(lock.id) || 0;
  const targetType = String(lock.target_type || '').trim().toLowerCase();
  if (!['cross', 'matrix', 'rejected', 'tableaux', 'category'].includes(targetType)) {
    return json({ error: 'Type de cible invalide (cross, matrix, rejected, tableaux, category).' }, 400);
  }
  const unlockCurrency = ['stars', 'tokens'].includes(String(lock.unlock_currency || '').trim().toLowerCase())
    ? String(lock.unlock_currency || '').trim().toLowerCase()
    : 'stars';
  if (id > 0) {
    await env.DB.prepare(`
      UPDATE config_locks SET
        target_type = ?, target_key = ?, country_code = ?, unlock_currency = ?,
        required_stars = ?, required_tokens = ?, plan_slug = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      targetType,
      String(lock.target_key || '').trim(),
      String(lock.country_code || '').trim().toUpperCase(),
      unlockCurrency,
      Number(lock.required_stars) || 0,
      Number(lock.required_tokens) || 0,
      String(lock.plan_slug || '').trim(),
      lock.enabled !== false ? 1 : 0,
      now,
      id
    ).run();
  } else {
    const result = await env.DB.prepare(`
      INSERT INTO config_locks (
        target_type, target_key, country_code, unlock_currency,
        required_stars, required_tokens, plan_slug, enabled, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      targetType,
      String(lock.target_key || '').trim(),
      String(lock.country_code || '').trim().toUpperCase(),
      unlockCurrency,
      Number(lock.required_stars) || 0,
      Number(lock.required_tokens) || 0,
      String(lock.plan_slug || '').trim(),
      lock.enabled !== false ? 1 : 0,
      now
    ).run();
    id = result?.meta?.last_row_id || 0;
  }
  const row = await env.DB.prepare("SELECT * FROM config_locks WHERE id = ?").bind(id).first();
  return json({ ok: true, lock: configLockFromRow(row) });
}

async function deleteLock(env, body) {
  const id = Number(body.id) || 0;
  if (!id) return json({ error: 'Identifiant de verrou requis.' }, 400);
  await env.DB.prepare("DELETE FROM config_locks WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

function configLockFromRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    target_type: row.target_type,
    target_key: row.target_key,
    country_code: row.country_code,
    unlock_currency: row.unlock_currency,
    required_stars: Number(row.required_stars) || 0,
    required_tokens: Number(row.required_tokens) || 0,
    plan_slug: row.plan_slug,
    enabled: Number(row.enabled) !== 0,
    updated_at: row.updated_at
  };
}

async function saveBanner(env, body) {
  const banner = body.banner || {};
  const now = new Date().toISOString();
  const id = Number(banner.id) || 0;
  const kind = String(banner.kind || 'ad').trim() || 'ad';
  const placement = String(banner.placement || 'homepage').trim() || 'homepage';
  const clampDay = Number.isInteger(Number(banner.day)) && banner.day !== null && banner.day !== undefined && banner.day !== ''
    ? Math.max(0, Math.min(6, Number(banner.day)))
    : null;
  const imageUrl = String(banner.image_url || '').trim().slice(0, 2000);
  const title = String(banner.title || '').trim().slice(0, 200);
  const description = String(banner.description || '').trim().slice(0, 2000);
  const localized = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '{}';
    return JSON.stringify(Object.fromEntries(
      Object.entries(value)
        .map(([locale, text]) => [
          String(locale).trim().toLowerCase().slice(0, 12),
          String(text ?? '').trim().slice(0, 2000)
        ])
        .filter(([locale, text]) => /^[a-z]{2,3}(?:-[a-z]{2})?$/.test(locale) && text)
    ));
  };
  const titleI18n = localized(banner.title_i18n);
  const descriptionI18n = localized(banner.description_i18n);
  const targetUrl = String(banner.target_url || '').trim().slice(0, 2000);
  const actionLabel = String(banner.action_label || '').trim().slice(0, 200);
  const actionLabelI18n = localized(banner.action_label_i18n);
  const exactDate = String(banner.exact_date || '').trim().slice(0, 10);
  const sortOrder = Number(banner.sort_order) || 0;
  const enabled = banner.enabled !== false ? 1 : 0;

  if (id > 0) {
    await env.DB.prepare(`
      UPDATE config_banners SET
        kind = ?, placement = ?, day = ?, exact_date = ?, title = ?, description = ?,
        title_i18n = ?, description_i18n = ?, image_url = ?, target_url = ?,
        action_label = ?, action_label_i18n = ?, sort_order = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `).bind(kind, placement, clampDay, exactDate, title, description, titleI18n, descriptionI18n, imageUrl, targetUrl, actionLabel, actionLabelI18n, sortOrder, enabled, now, id).run();
  } else {
    const result = await env.DB.prepare(`
      INSERT INTO config_banners (
        kind, placement, day, exact_date, title, description, title_i18n,
        description_i18n, image_url, target_url, action_label, action_label_i18n,
        sort_order, enabled, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(kind, placement, clampDay, exactDate, title, description, titleI18n, descriptionI18n, imageUrl, targetUrl, actionLabel, actionLabelI18n, sortOrder, enabled, now).run();
    return json({ ok: true, bannerId: result?.meta?.last_row_id || null });
  }
  const row = await env.DB.prepare("SELECT * FROM config_banners WHERE id = ?").bind(id).first();
  return json({ ok: true, banner: row ? configBannerFromRow(row) : null });
}

async function deleteBanner(env, body) {
  const id = Number(body.id) || 0;
  if (!id) return json({ error: 'Identifiant bannière requis.' }, 400);
  await env.DB.prepare("DELETE FROM config_banners WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

async function saveGrid(env, body) {
  const grid = body.grid || {};
  const module = String(grid.module || '').trim();
  if (!module) return json({ error: 'Module grille requis.' }, 400);
  const hasFormula = grid.formula_tier !== undefined
    || grid.formulaTier !== undefined
    || grid.formula !== undefined;
  let formulaTier = normalizeFormulaTier(grid.formula_tier || grid.formulaTier || grid.formula);
  let planSlug = String(grid.plan_slug || grid.planSlug || '').trim().toLowerCase();
  if (planSlug) {
    const configuredPlan = await env.DB
      .prepare('SELECT slug FROM config_plans WHERE slug = ? AND enabled <> 0')
      .bind(planSlug)
      .first();
    if (!configuredPlan && normalizeFormulaTier(planSlug)) {
      // A legacy browser may still submit Essentiel / Avancé / Intégral.
      // Preserve that old assignment format when no real offer has that slug.
      formulaTier = normalizeFormulaTier(planSlug);
      planSlug = '';
    } else if (!configuredPlan) {
      return json({ error: 'Abonnement introuvable ou désactivé pour cette grille.' }, 400);
    }
  }
  if (hasFormula && !formulaTier && grid.formula_tier !== null && grid.formulaTier !== null
    && grid.formula !== null && grid.formula !== '') {
    return json({ error: 'Formule invalide. Utilisez Essentiel, Avancé ou Intégral.' }, 400);
  }
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO config_grids (module, grid_min, grid_max, enabled, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(module) DO UPDATE SET
      grid_min = excluded.grid_min,
      grid_max = excluded.grid_max,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `).bind(
    module,
    Number(grid.min) || 1,
    Number(grid.max) || 90,
    grid.enabled !== false ? 1 : 0,
    now
  ).run();
  await env.DB.prepare(`
    INSERT INTO tableaux_grid_assignments
      (grid_key, display_name, plan_slug, formula_tier, enabled, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(grid_key) DO UPDATE SET
      plan_slug = excluded.plan_slug,
      formula_tier = excluded.formula_tier,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `).bind(
    module,
    TABLEAUX_GRID_CATALOG.find(([key]) => key === module)?.[1] || module,
    planSlug,
    formulaTier || null,
    grid.enabled !== false ? 1 : 0,
    now
  ).run();
  const row = await env.DB.prepare("SELECT * FROM config_grids WHERE module = ?").bind(module).first();
  const assignment = await env.DB.prepare(
    'SELECT * FROM tableaux_grid_assignments WHERE grid_key = ?'
  ).bind(module).first();
  return json({
    ok: true,
    grid: configGridFromRow(row),
    assignment: assignment ? configAssignmentFromRow(assignment) : null
  });
}

async function configApi(request, env) {
  await ensureTableauxAssignments(env);
  const url = new URL(request.url);

  if (request.method === 'GET') {
    if (url.pathname === '/api/config/platform') {
      return json({ ok: true, ...(await readPlatformConfig(env)) });
    }
    return json({ error: 'Ressource inconnue.' }, 404);
  }

  if (request.method !== 'POST') {
    return json({ error: 'Méthode non autorisée.' }, 405);
  }

  if (!(await isConfigOwner(request))) {
    return json({ error: 'Seul le propriétaire/administrateur peut modifier la configuration.' }, 403);
  }

  let body = {};
  try {
    body = await request.json();
  } catch (_) {
    return json({ error: 'JSON invalide.' }, 400);
  }

  switch (url.pathname) {
    case '/api/config/plan':
      return body.action === 'delete'
        ? deletePlan(env, body)
        : savePlan(env, body);
    case '/api/config/star-price':
      return body.action === 'delete'
        ? deletePrice(env, body, false)
        : savePrice(env, body, false);
    case '/api/config/token-price':
      return body.action === 'delete'
        ? deletePrice(env, body, true)
        : savePrice(env, body, true);
    case '/api/config/payment':
      return savePayment(env, body);
    case '/api/config/comment-rule':
      return saveOrDeleteCommentRule(env, body);
    case '/api/config/lock':
      return body.action === 'delete'
        ? deleteLock(env, body)
        : saveLock(env, body);
    case '/api/config/banner':
      return body.action === 'delete'
        ? deleteBanner(env, body)
        : saveBanner(env, body);
    case '/api/config/grid':
      return saveGrid(env, body);
    default:
      return json({ error: 'Ressource inconnue.' }, 404);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/messages" && (request.method === "GET" || request.method === "POST")) {
      try {
        return await messagesApi(request, env);
      } catch (error) {
        console.error("messages request failed", error);
        return json({ error: "La messagerie est temporairement indisponible" }, 500);
      }
    }
    if (url.pathname === "/api/virtual-chat" && (request.method === "GET" || request.method === "POST")) {
      try {
        return await virtualChatApi(request, env);
      } catch (error) {
        console.error("virtual chat request failed", error);
        return json({ error: "Le chat virtuel est temporairement indisponible." }, 500);
      }
    }
    if (
      url.pathname === "/api/admin/chat-knowledge"
      || url.pathname.startsWith("/api/admin/chat-knowledge/")
    ) {
      try {
        return await adminChatKnowledgeApi(request, env);
      } catch (error) {
        console.error("admin chat knowledge request failed", error);
        return json({ error: "La base de connaissances est temporairement indisponible." }, 500);
      }
    }
    if (url.pathname === "/api/referral/state" && request.method === "GET") {
      try {
        return await referralApi(request, env);
      } catch (error) {
        console.error("referral state failed", error);
        return json({ error: "Impossible de lire les récompenses" }, 500);
      }
    }
    if (url.pathname === "/api/referral/event" && request.method === "POST") {
      try {
        return await referralApi(request, env);
      } catch (error) {
        console.error("referral event failed", error);
        return json({ error: "Impossible d'enregistrer l'événement" }, 500);
      }
    }
    const isCroixNationaleGenerate =
      url.pathname === "/api/croixnationale/generate" ||
      url.pathname === "/api/croix/generate";
    if (isCroixNationaleGenerate && (request.method === "GET" || request.method === "POST")) {
      try {
        return await generateCross(request, env);
      } catch (error) {
        console.error("cross generation failed", error);
        return json({ error: "Erreur serveur pendant la génération de la Croix" }, 500);
      }
    }
    const isCroixNationaleHealth =
      url.pathname === "/api/croixnationale/health" ||
      url.pathname === "/api/croix/health";
    if (isCroixNationaleHealth && request.method === "GET") {
      return json({ ok: true, service: "croixnationale", version: "date-db-v1" });
    }
    if (url.pathname.startsWith('/api/config/')) {
      try {
        return await configApi(request, env);
      } catch (error) {
        console.error('config request failed', error);
        return json({ error: 'Configuration indisponible.' }, 500);
      }
    }
    return new Response("Not found", { status: 404 });
  },
};
