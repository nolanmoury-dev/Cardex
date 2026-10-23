// # À TOUS CEUX QUI TOUCHENT À CE CODE : à chaque mise à jour visible par les joueurs, ajoutez une entrée en haut de UPDATES dans index.html
// # (pop-up affiché une seule fois à chaque joueur pour expliquer la mise à jour). Règle de l'opérateur, valable à partir du 14/10/2026.
const crypto = require('crypto');
const T0 = require('../lib/cards');

let redis;
const W = { c: 60, r: 25, e: 11, l: 4 }, BASE = { c: 2, r: 8, e: 25, l: 80, m: 250, s: 800, u: 2500 }, R = 'crelmsu'; // m = Mythique, s = Céleste, u = Unique : créées par l'opérateur uniquement (aucun sachet n'en contient)
const RL_MAX = 10, RL_WAIT = 30000, parisDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
const rlInfo = (u) => { const r = u.rl && u.rl.d === parisDay() ? u.rl : { n: 0, t: 0 }; return { left: Math.max(0, RL_MAX - r.n), next: r.t + RL_WAIT }; };
// Mini-jeux : limite de parties par jour (heure de Paris). Retour moyen visé : ~88-96 % (jamais > 100 %), mise 10-500.
const MG_MAX = { slots: 15, flip: 15, scratch: 10, battle: 10 }, TICKET = 50, FLIP_P = 48, FLIP_MAX = 4, BATTLE_X = 1.85;
const SL = [['🚲', 22, [2, 6, 30]], ['⚽', 22, [2, 6, 30]], ['🤾', 20, [2.5, 8, 40]], ['🦁', 18, [3.5, 12, 60]], ['🏛️', 12, [5, 20, 120]], ['🚀', 6, [10, 50, 400]]];
const TK = [[6095, 0], [2100, 1], [1200, 2], [500, 4], [80, 10], [20, 50], [5, 100]]; // [poids sur 10000, multiplicateur du ticket]
const mgInfo = (u) => { const m = u.mg && u.mg.d === parisDay() ? u.mg : {}; return Object.fromEntries(Object.entries(MG_MAX).map(([k, n]) => [k, Math.max(0, n - (m[k] || 0))])); };
const mgUse = (u, k) => { if (!u.mg || u.mg.d !== parisDay()) u.mg = { d: parisDay() }; if ((u.mg[k] || 0) >= MG_MAX[k]) return 'Limite du jour atteinte : ' + MG_MAX[k] + ' parties par jour pour ce jeu. Reviens demain !'; u.mg[k] = (u.mg[k] || 0) + 1; };
const shuf = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const DAY = 864e5, MAXP = 10, PRICE = 100, PACK = 5, OPEN_MAX = 50;
// Connexion quotidienne : jour 1 à 7 (heure de Paris). Un jour raté remet la série à zéro ; après le jour 7 on repart au jour 1.
const DAILY = [10, 20, 30, 40, 50, 60, 200];
const prevDay = (d) => new Date(Date.parse(d + 'T12:00:00Z') - DAY).toISOString().slice(0, 10);
const dyInfo = (u) => { if (u.bot) return null; const t = parisDay(), s = u.ds, claimed = !!(s && s.d === t); return { day: claimed ? s.n : s && s.d === prevDay(t) ? (s.n % 7) + 1 : 1, claimed, rew: DAILY }; };
// Favorites gardées après une renaissance (livret Favoris) : leur valeur monte progressivement jusqu'à ×5 en 7 jours
// Course de la semaine : 1 pack de course par heure (non cumulable), chaque pack fait avancer la voiture de +1, +2, +5 ou +10 (de plus en plus rare)
const SKINS = ['rose', 'ete', 'hiver', 'halloween']; // thèmes de saison que l'opérateur peut activer pour tout le monde
const SKC_MAX = 12; // thèmes personnalisés que l'opérateur peut garder en réserve
const skinList = async () => { const l = await redis.get('skinc'); return Array.isArray(l) ? l : []; };
// thème actif + (si personnalisé) sa définition, pour que les joueurs puissent l'afficher
const skinState = async () => { const k = (await redis.get('skin')) || null; if (!k || SKINS.includes(k)) return { skin: k, skind: null }; const d = (await skinList()).find((x) => x.id === k); return d ? { skin: k, skind: d } : { skin: null, skind: null }; };
// --- Questionnaires de l'opérateur : 'surveys' = [{ id, q, type: 'stars' (1 à 5 étoiles) | 'qcm', opts, t, open }]. Une réponse par joueur : clé sva:<id>:<pseudo en minuscules> + ensemble svr:<id> (résultats anonymes).
const svList = async () => { const l = await redis.get('surveys'); return Array.isArray(l) ? l : []; };
const svKey = (id, p) => 'sva:' + id + ':' + String(p).toLowerCase();
const svNext = async (u) => { // prochain questionnaire ouvert auquel ce joueur n'a pas encore répondu
  if (!u || u.bot || u.pseudo === OP_NAME) return null;
  const open = (await svList()).filter((x) => x.open); if (!open.length) return null;
  const got = await redis.mget(...open.map((x) => svKey(x.id, u.pseudo))), i = open.findIndex((x, k) => got[k] == null);
  return i < 0 ? null : { id: open[i].id, q: open[i].q, type: open[i].type, opts: open[i].opts };
};
const svWipe = async (id) => { for (const p of await redis.smembers('svr:' + id)) await redis.del(svKey(id, p)); await redis.del('svr:' + id); };
const svResults = async (x) => {
  const ps = await redis.smembers('svr:' + x.id), vals = ps.length ? await redis.mget(...ps.map((p) => svKey(x.id, p))) : [], v = vals.filter(Boolean).map((a) => a.v), n = v.length;
  if (x.type === 'stars') return { ...x, n, counts: [1, 2, 3, 4, 5].map((k) => v.filter((a) => a === k).length), avg: n ? Math.round((v.reduce((a, c) => a + c, 0) / n) * 100) / 100 : null };
  return { ...x, n, counts: x.opts.map((_, k) => v.filter((a) => a === k).length) };
};
const RACE_HOUR = 36e5, CAR_COST = 200; // pas de ligne d'arrivée : celui qui est le plus loin à la fin de la semaine gagne
const raceWeek0 = () => { const d = new Date(parisDay() + 'T12:00:00Z'); return new Date(d - ((d.getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10); }; // lundi (Paris) de la semaine en cours
const raceEnd0 = () => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date()).map((x) => [x.type, x.value])), dow = (new Date(parisDay() + 'T12:00:00Z').getUTCDay() + 6) % 7; return Date.now() + ((6 - dow) * 86400 + 86400 - ((+p.hour % 24) * 3600 + +p.minute * 60 + +p.second)) * 1000; };
// Courses : une course dure 3 jours ; de temps en temps une course événement (12 h ou 24 h) se lance toute seule (RACE = course en cours, stockée dans Redis 'race:cur').
// À la fin, le 1er et le 2e (joueurs réels seulement, un bot peut être 2e mais jamais 1er) gagnent chacun une roue : la roue du 1er a de meilleurs lots.
let RACE = null, raceChk = 0;
const raceWeek = () => (RACE ? RACE.id : raceWeek0()), raceEnd = () => (RACE ? RACE.end : raceEnd0());
const WHEEL = {
  1: [{ k: 'coins', n: 800, w: 20 }, { k: 'coins', n: 1500, w: 16 }, { k: 'coins', n: 3000, w: 8 }, { k: 'packs', n: 6, w: 16 }, { k: 'coins', n: 2000, w: 14 }, { k: 'card', r: 'l', w: 12 }, { k: 'sub', n: 1, w: 9 }, { k: 'jack', w: 5 }],
  2: [{ k: 'coins', n: 300, w: 26 }, { k: 'coins', n: 500, w: 18 }, { k: 'coins', n: 800, w: 10 }, { k: 'packs', n: 3, w: 16 }, { k: 'coins', n: 400, w: 14 }, { k: 'card', r: 'r', w: 8 }, { k: 'card', r: 'e', w: 6 }, { k: 'coins', n: 1200, w: 2 }],
};
const RN0 = { c: 'commune', r: 'rare', e: 'épique', l: 'légendaire' };
const wSegs = (rank, mult) => (WHEEL[rank] || WHEEL[2]).map((g) => (['coins', 'packs', 'rx'].includes(g.k) ? { ...g, n: Math.round(g.n * (mult || 1)) } : g.k === 'jack' ? { ...g, n: Math.round(6000 * (mult || 1)) } : g));
const wLabel = (g) => (g.k === 'coins' ? '+' + g.n + ' 🪙' : g.k === 'packs' ? g.n + ' 📦' : g.k === 'rx' ? g.n + ' 🏁' : g.k === 'card' ? 'Carte ' + RN0[g.r] : g.k === 'sub' ? g.n + ' j abo' : '💎 Jackpot');
const SKINS_CAR = { flames: 1, rainbow: 2, glow: 3 }; // skins de voiture : palier d'abonnement minimum
const carSkin = (u) => { const x = subOf(u); return x && u.carSk && SKINS_CAR[u.carSk] && x.t >= SKINS_CAR[u.carSk] ? u.carSk : null; };
const raceView = (u) => { if (u.bot) return null; const w = raceWeek(), r = u.rc && u.rc.w === w ? u.rc : null, next = (u.rcT || 0) + RACE_HOUR, x = u.rcX || 0; return { w, name: RACE ? RACE.name : 'Course de la semaine', kind: RACE ? RACE.kind : 'normal', pos: r ? r.pos : 0, car: u.car || null, sk: carSkin(u), next, x, ready: x > 0 || Date.now() >= next, end: raceEnd(), cost: CAR_COST }; }; // x = packs offerts par le staff (en plus du pack gratuit de l'heure)
// Notification « pack de course prêt » : une seule fois par pack (elle revient après chaque ouverture). Les joueurs qui n'ont jamais ouvert de pack de course ne sont pas notifiés.
const raceNote = (u) => {
  if (u.bot) return false;
  const v = raceView(u); if (!v || !v.ready || !(u.rcT > 0 || v.x > 0)) return false;
  const k = v.x > 0 ? 'x' + v.x : v.next; if (u.rcN === k) return false;
  u.rcN = k; note(u, '🏁 Ton pack de course est prêt à ouvrir !'); return true;
};
// Bots : un pack de course par heure, comme les joueurs (même tirage). Ils ne passent jamais premiers au classement (voir racelb).
const CARS = ['#e5484d', '#2a7de1', '#2ea043', '#f5b301', '#8b5cf6', '#ff9ad5', '#22d3ee'];
const botRace = (u, now) => {
  if (now < (u.rcT || 0) + RACE_HOUR) return;
  const w = raceWeek(), x = crypto.randomInt(100), gain = x < 55 ? 1 : x < 85 ? 2 : x < 97 ? 5 : 10;
  if (u.rc && u.rc.w !== w) u.rcPrev = u.rc;
  u.rc = { w, pos: (u.rc && u.rc.w === w ? u.rc.pos : 0) + gain, tt: now }; u.rcT = now; u.car ||= CARS[crypto.randomInt(CARS.length)];
};
const PFP_COST = 500; // photo de profil : 1re gratuite, 2e payante, 3e et + vérifiées par l'opérateur
const FK_DAYS = 7, FK_MAX = 5;
// --- Abonnements : 3 paliers, durée au choix (1 à 30 jours), payée d'avance (prix × jours). Le bonus ne touche que les légendaires.
// u.sub = { t: palier, until: fin (ms), trial?: true } ; u.subTrial = le jour gratuit a déjà été pris (une seule fois par compte).
const SUBS = [{ t: 1, name: 'Bronze', ico: '🥉', price: 200, leg: 1.5 }, { t: 2, name: 'Argent', ico: '🥈', price: 300, leg: 2 }, { t: 3, name: 'Or', ico: '🥇', price: 500, leg: 3 }];
const SUB_MAX = 30;
const subOf = (u) => { const x = u && u.sub && u.sub.until > Date.now() && SUBS.find((y) => y.t === u.sub.t); return x || null; };
const subMult = (u) => { const x = subOf(u); return x ? x.leg : 1; };
// Fin d'abonnement : tout s'enlève d'un coup (bonus + couleur de fond d'abonné) et le joueur est prévenu dans sa boîte 🔔
function subCheck(u) {
  if (!u || !u.sub || u.sub.until > Date.now()) return;
  const x = SUBS.find((y) => y.t === u.sub.t);
  note(u, u.sub.trial ? '⭐ Ton jour d\'essai gratuit est terminé : le bonus de chances et ta couleur de fond d\'abonné sont retirés. Tu peux t\'abonner dans Réglages.' : '⭐ Ton abonnement ' + (x ? x.name + ' ' : '') + 'est terminé : le bonus de chances et ta couleur de fond d\'abonné sont retirés. Tu peux te réabonner dans Réglages.');
  delete u.sub; delete u.subCol;
}
// Applique un abonnement offert (cadeau ou code) : même palier = prolongation, palier plus haut = remplace tout de suite.
// Un palier PLUS BAS que celui en cours est refusé (on ne rétrograde jamais personne) : renvoie alors l'abonnement actuel, sinon null.
function applySub(u, T, d) {
  subCheck(u);
  const cur = subOf(u);
  if (cur && cur.t > T.t) return cur;
  u.sub = { t: T.t, until: (cur && cur.t === T.t ? u.sub.until : Date.now()) + d * DAY };
  return null;
}
// --- Codes : { CODE: { code, label, t, coins, packs, rx, bought:{thème:n}, cards:{id:n}, sub:{t,days}|null, max (null = illimité), exp (ms|null), used:[pseudos en minuscules] } }
const normCode = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, '');
const fkMult = (u, id) => { const t = (u.fk || {})[id]; return t ? 1 + (FK_MAX - 1) * Math.min(1, (Date.now() - t) / (FK_DAYS * DAY)) : 1; };
const stepOf = (k) => Math.round((10 + (4 * k) / 9) * 60000); // 10 min pour le 1er sachet, 14 min pour le 10e (total 2 h)
const pend = [];
async function vapid() {
  let v = await redis.get('vapid');
  if (!v) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const j = publicKey.export({ format: 'jwk' });
    v = { pub: Buffer.concat([Buffer.from([4]), Buffer.from(j.x, 'base64url'), Buffer.from(j.y, 'base64url')]).toString('base64url'), priv: privateKey.export({ format: 'jwk' }).d };
    await redis.set('vapid', v);
  }
  return v;
}
async function flush() {
  const items = pend.splice(0);
  if (!items.length) return;
  try {
    const wp = require('web-push'), v = await vapid();
    wp.setVapidDetails('mailto:noreply@example.com', v.pub, v.priv);
    await Promise.all(items.flatMap(([subs, text]) => subs.map((s) => wp.sendNotification(s, JSON.stringify({ title: 'Cardex', body: text })).catch(() => {}))));
  } catch (e) { console.error('push', e.message); }
}
async function bcast(text, except) {
  for (const p of await redis.smembers('users')) {
    if (except && p === except) continue;
    const v = await redis.get(key(p)); if (!v) continue;
    note(v, text); await redis.set(key(v.pseudo), v);
  }
}
const pfpList = async () => { const q = (await redis.get('pfpq')) || [], out = []; for (const p of q) { const v = await redis.get(key(p)); if (v && v.pfpReq) out.push({ pseudo: v.pseudo, img: v.pfpReq.img, t: v.pfpReq.t, n: v.pfpN || 0 }); } return out; };
const OP_ID = (process.env.OPERATOR_ID || 'operateur').toLowerCase();
const OP_NAME = 'Noln_mry';
// --- IP (hachée avec une clé secrète : on ne stocke jamais l'adresse en clair) et bannissements
const IP_KEY = process.env.IP_SALT || process.env.OPERATOR_CODE || 'cardex-ip';
const ipHash = (req) => { const ip = String((req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || (req.socket && req.socket.remoteAddress) || '').split(',')[0].trim(); return ip ? crypto.createHmac('sha256', IP_KEY).update(ip).digest('hex').slice(0, 24) : null; };
const addIp = (u, h) => { if (h) u.ips = [h, ...(u.ips || []).filter((x) => x !== h)].slice(0, 5); };
const banOf = (u) => (u && u.ban && (u.ban.until == null || u.ban.until > Date.now()) ? { until: u.ban.until, reason: u.ban.reason || '' } : null);
const banIp = (h, u, until) => redis.set('banip:' + h, { until, pseudo: u.pseudo }, until == null ? undefined : { ex: Math.max(1, Math.ceil((until - Date.now()) / 1000)) });
// Compte de l'opérateur (Noln_mry) : toutes les notifications du staff arrivent dans sa boîte 🔔 (et en push sur ses appareils)
async function opUser() {
  let v = await redis.get(key(OP_NAME));
  if (!v) {
    const salt = crypto.randomBytes(16).toString('hex');
    v = { pseudo: OP_NAME, salt, hash: hash(crypto.randomBytes(8).toString('hex'), salt), coins: 200, packs: 1, bought: {}, last: Date.now(), cards: {}, since: {}, fav: [], notifs: [] };
    await redis.set(key(OP_NAME), v); await redis.sadd('users', OP_NAME);
  }
  return v;
}
async function opNote(text, self) {
  try {
    if (self && self.pseudo === OP_NAME) { note(self, text); await redis.set(key(self.pseudo), self); return; }
    const v = await opUser(); note(v, text); await redis.set(key(OP_NAME), v);
  } catch (e) { console.error('opNote', e.message); }
}
// Messages de maintenance prêts à l'emploi (un par onglet du bas) ; le staff peut en cocher plusieurs et ajouter un message libre.
const MAINT_PRESETS = {
  shop: ['🛒 Boutique', 'Mise à jour de la Boutique : sachets, prix ou objets.'],
  col: ['🗂️ Collection', 'Mise à jour des collections : nouvelles cartes ou nouvelles catégories.'],
  mk: ['🏪 Marché', 'Mise à jour du Marché : annonces et échanges.'],
  jeu: ['🎲 Jeux', 'Mise à jour des Jeux.'],
  rk: ['🏆 Social', 'Mise à jour du Social : classement et messages.'],
  set: ['⚙️ Réglages', 'Mise à jour des Réglages.'],
};
const maintInfo = async () => { const i = (await redis.get('maintinfo')) || {}; return { msgs: (i.presets || []).filter((k) => MAINT_PRESETS[k]).map((k) => MAINT_PRESETS[k][1]), msg: i.msg || '' }; };
const cn = (c) => c.slice(c.indexOf(':') + 1);
async function checkName(nn, u) {
  if (!/^[A-Za-z0-9_]{3,20}$/.test(nn)) return 'Pseudo : 3 à 20 lettres, chiffres ou _';
  const l = nn.toLowerCase();
  if (u && l === u.pseudo.toLowerCase()) return "C'est déjà ce pseudo";
  if (l === OP_ID || l === OP_NAME.toLowerCase() || isBotName(nn) || (await redis.get('u:' + l))) return 'Ce pseudo est déjà pris';
}
async function renameUser(u, nn, count) {
  const old = u.pseudo;
  await redis.del('u:' + old.toLowerCase()); await redis.srem('users', old); await redis.sadd('users', nn);
  u.pseudo = nn; if (count) u.renames = (u.renames || 0) + 1;
  const mk = (await redis.get('market')) || [];
  for (const [lk, e] of Object.entries(u.dm || {})) { // migrer les conversations vers le nouveau pseudo
    const ok = dmKey(old, e.p), nk = dmKey(nn, e.p), th = (await redis.get(ok)) || [];
    await redis.set(nk, th.map((m) => (m.f === old ? { ...m, f: nn } : m))); await redis.del(ok); await redis.srem('dms', ok); await redis.sadd('dms', nk);
    const o = await redis.get('u:' + e.p.toLowerCase());
    if (o && o.dm) { const x = o.dm[old.toLowerCase()]; delete o.dm[old.toLowerCase()]; if (x) o.dm[nn.toLowerCase()] = { ...x, p: nn, f: x.f === old ? nn : x.f }; await redis.set('u:' + e.p.toLowerCase(), o); }
  }
  u.dm = Object.fromEntries(Object.entries(u.dm || {}).map(([lk, e]) => [lk, { ...e, f: e.f === old ? nn : e.f }]));
  for (const k of ['challenges', 'chh']) { // défis en cours et historique : suivre le changement de pseudo
    const L = await redis.get(k);
    if (L && L.some((x) => [x.from, x.to, x.a, x.b].includes(old))) await redis.set(k, L.map((x) => ({ ...x, ...(x.from === old ? { from: nn } : {}), ...(x.to === old ? { to: nn } : {}), ...(x.a === old ? { a: nn } : {}), ...(x.b === old ? { b: nn } : {}) })));
  }
  if (mk.some((x) => x.seller === old || x.to === old)) await redis.set('market', mk.map((x) => ({ ...x, seller: x.seller === old ? nn : x.seller, ...(x.to === old ? { to: nn } : {}) })));
}
const OP_CODE = process.env.OPERATOR_CODE || '100823';
const key = (p) => 'u:' + p.toLowerCase();
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const int = (v, max = 1e6) => Math.max(0, Math.min(max, parseInt(v, 10) || 0));
const envFind = (re) => { const k = Object.keys(process.env).find((x) => re.test(x) && process.env[x]); return k && process.env[k]; };
const live = (o) => !o.hidden && (!o.until || o.until > Date.now());
const loadCu = async () => ({ cols: [], objs: [], vals: {}, stats: {}, ...((await redis.get('custom')) || {}) });
// Lien de photo facultatif d'une carte (collection provisoire ou objet) : https uniquement, remplace l'image Wikipédia
const picOf = (s) => { const x = String(s || '').trim(); return /^https:\/\/[^\s"'<>\\]{4,300}$/.test(x) || /^\/api\/game\?img=[a-f0-9]{12}$/.test(x) ? x : null; };
const full = (cu) => {
  const t = { ...T0 };
  cu.cols.forEach((c) => (t[c.key] = c));
  const o = { name: 'Objets', icon: '🎁', color: '#db2777', hidden: true, c: [], r: [], e: [], l: [], m: [], s: [], u: [], im: {} };
  cu.objs.forEach((x) => { o[x.r].push(x.name); if (x.img) o.im[x.name] = x.img; });
  t.obj = o;
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, { ...v, m: Array.isArray(v.m) ? v.m : [], s: Array.isArray(v.s) ? v.s : [], u: Array.isArray(v.u) ? v.u : [] }]));
};
const rarOf = (cat, id) => { const i = id.indexOf(':'), o = cat[id.slice(0, i)], n = id.slice(i + 1); return o && [...R].find((r) => (o[r] || []).includes(n)); };
const defBase = (id, r, cu) => { const ob = id.startsWith('obj:') && cu.objs.find((x) => 'obj:' + x.name === id); return ob ? Math.max(1, Math.floor(ob.price * 0.6)) : BASE[r]; };
// Valeur de base d'une carte : réglable par l'opérateur (cu.vals), sinon selon la rareté ; l'ancienneté s'ajoute par-dessus (+1 %/jour, max ×2)
const val = (u, id, cat, cu) => {
  const r = rarOf(cat, id); if (!r) return 0;
  const b = (cu.vals && cu.vals[id]) || defBase(id, r, cu);
  const d = Math.min(100, Math.floor((Date.now() - ((u.since || {})[id] || Date.now())) / DAY));
  return Math.max(1, Math.round(b * (1 + d / 100) * fkMult(u, id)));
};
// --- Badges : à l'ouverture d'un sachet, chaque carte a 1/20 d'être Bronze, 1/30 Argent, 1/50 Or (tirage unique : jamais deux badges).
// u.cards[id] = TOUS les exemplaires (badgés compris) ; u.bd[id] = { 1: n bronze, 2: n argent, 3: n or } = combien de ces exemplaires portent un badge.
// Un exemplaire badgé compte dans la collection tant que le joueur n'a pas d'exemplaire identique SANS badge ; dès qu'il en a un, le badgé passe dans les livrets de badges.
const BADGES = [{ t: 1, name: 'Bronze', ico: '🥉', odds: 20 }, { t: 2, name: 'Argent', ico: '🥈', odds: 30 }, { t: 3, name: 'Or', ico: '🥇', odds: 50 }];
const rollBadge = () => { let x = Math.random(); for (const b of [BADGES[2], BADGES[1], BADGES[0]]) { x -= 1 / b.odds; if (x < 0) return b.t; } return 0; };
const bdSum = (u, id) => { const b = u.bd && u.bd[id]; return b ? (b[1] || 0) + (b[2] || 0) + (b[3] || 0) : 0; };
const add = (u, id, n) => { if (!u.cards[id]) u.since[id] = Date.now(); u.cards[id] = (u.cards[id] || 0) + n; };
const addB = (u, id, t) => { add(u, id, 1); u.bd ||= {}; const b = (u.bd[id] ||= {}); b[t] = (b[t] || 0) + 1; };
// On retire d'abord les exemplaires SANS badge, puis les badgés (le Bronze en premier) : un badge n'est perdu que s'il n'y a plus rien d'autre à retirer.
const rm = (u, id, n) => {
  u.cards[id] -= n;
  const b = u.bd && u.bd[id];
  if (b) { let over = bdSum(u, id) - Math.max(0, u.cards[id]); for (const t of [1, 2, 3]) while (over > 0 && b[t] > 0) { b[t]--; over--; } for (const t of [1, 2, 3]) if (!b[t]) delete b[t]; if (!bdSum(u, id)) delete u.bd[id]; }
  if (u.cards[id] <= 0) { delete u.cards[id]; delete u.since[id]; if (u.bd) delete u.bd[id]; if (u.fk) delete u.fk[id]; u.fav = u.fav.filter((x) => x !== id); }
};

// Prix de vente d'une carte badgée = valeur normale × (Bronze 1,5 · Argent 2 · Or 3). Bonus en défi : +1 / +2 / +4 en vie ET en attaque.
const BDM = { 1: 1.5, 2: 2, 3: 3 }, BDB = { 1: 1, 2: 2, 3: 4 };
// Retire UN exemplaire précis : sans badge (tr = 0) ou portant le badge tr
const rmT = (u, id, tr) => { if (tr) { const b = u.bd[id]; b[tr]--; if (!b[tr]) delete b[tr]; if (!bdSum(u, id)) delete u.bd[id]; } rm(u, id, 1); };
// Argent gagné en vendant k exemplaires de id via rm (sans badge d'abord, puis les badgés, Bronze en premier) ; v = valeur normale d'une carte
const sellValue = (u, id, k, v) => {
  let left = k, g = 0; const p = Math.min(left, Math.max(0, (u.cards[id] || 0) - bdSum(u, id))); g += v * p; left -= p;
  const b = (u.bd && u.bd[id]) || {};
  for (const t of [1, 2, 3]) { const x = Math.min(left, b[t] || 0); g += Math.round(v * BDM[t]) * x; left -= x; }
  return g;
};
const addM = (u, x) => (x.bd ? addB(u, x.card, x.bd) : add(u, x.card, 1)); // carte d'une annonce (badgée ou non)
const dk = (s) => { const m = String(s).match(/^(.*)@([123])$/); return m ? { id: m[1], tr: +m[2] } : { id: String(s), tr: 0 }; }; // "carte" ou "carte@2" (2 = exemplaire Argent)
// =================== DÉFIS ===================
// Cartes jouables : collections de niveau II à V, ou n'importe quelle collection dont le joueur a déjà fait une renaissance ; objets seulement si l'opérateur leur a donné des stats.
const CH = { fee: 5, max: 5000, ttl: 48 * 36e5, day: 10, vs: 3, sent: 5 };
const HP0 = { c: [20, 5], r: [30, 8], e: [45, 12], l: [70, 18], m: [110, 28], s: [160, 40], u: [240, 60] }, LVM = [1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.4, 2.6], COST = { c: 1, r: 3, e: 8, l: 20, m: 40, s: 70, u: 120 };
const csFrom = (H, p) => H.reduce((c, h) => { if (h.a === p || h.b === p) { const m = h.w * (h.a === p ? 1 : -1); if (m > 0) c.w++; else if (m < 0) c.l++; else c.d++; } return c; }, { w: 0, l: 0, d: 0 }); // victoires / défaites / égalités en défi
const rbTot = (u) => Object.values((u && u.rb) || {}).reduce((a, x) => a + x, 0);
const statsBase = (id, cat, cu, raw) => {
  const o = !raw && (cu.stats || {})[id];
  if (o) return { hp: o.hp, atk: o.atk, custom: true };
  const r = rarOf(cat, id); if (!r) return null;
  const t = id.slice(0, id.indexOf(':')), lv = Math.min(9, Math.max(1, (cat[t] && cat[t].lv) || 1));
  const h = parseInt(crypto.createHash('md5').update(id).digest('hex').slice(0, 6), 16) / 0xffffff, k = LVM[lv - 1] * (0.9 + 0.2 * h); // écart propre à chaque carte : -10 % à +10 %
  return { hp: Math.max(1, Math.round(HP0[r][0] * k)), atk: Math.max(1, Math.round(HP0[r][1] * k)) };
};
const statsOf = (id, cat, cu, raw, tr = 0) => { const s = statsBase(id, cat, cu, raw); return s && tr ? { ...s, hp: s.hp + BDB[tr], atk: s.atk + BDB[tr] } : s; }; // tr = badge de l'exemplaire engagé
const playable = (u, id, cat, cu) => {
  if (!statsOf(id, cat, cu)) return false;
  if (id.startsWith('obj:')) return true;
  const t = id.slice(0, id.indexOf(':'));
  return ((cat[t] && cat[t].lv) || 1) >= 2 || ((u.rb || {})[t] || 0) >= 1;
};
const dlInfo = (u) => { const d = u.dl && u.dl.d === parisDay() ? u.dl : { n: 0, o: {} }, max = u.dlMax != null ? u.dlMax : CH.day; return { left: Math.max(0, max - d.n), max, o: d.o || {} }; };
const dlUse = (u, opp) => { if (!u.dl || u.dl.d !== parisDay()) u.dl = { d: parisDay(), n: 0, o: {} }; u.dl.n++; const k = opp.toLowerCase(); u.dl.o[k] = (u.dl.o[k] || 0) + 1; };
// Cartes engagées : sorties de la collection du joueur (donc bloquées partout) puis rendues ou transférées au résultat
const lock = (u, ids) => ids.map((s) => { const { id, tr } = dk(s), x = { id, tr, since: (u.since || {})[id] || Date.now(), fav: u.fav.includes(id), fk: (u.fk || {})[id] }; rmT(u, id, tr); return x; });
const unlock = (u, xs) => xs.forEach((x) => { const had = u.cards[x.id]; if (x.tr) addB(u, x.id, x.tr); else add(u, x.id, 1); if (!had) { u.since[x.id] = x.since; if (x.fav && !u.fav.includes(x.id)) u.fav.push(x.id); if (x.fk) (u.fk ||= {})[x.id] = x.fk; } });
const refundCh = (A, x, text) => { if (x.mode === 'war') A.coins += x.s; unlock(A, x.c); note(A, text); };
function pickCards(u, ids, fmt, stake, mode, cat, cu) {
  if (!Array.isArray(ids) || ids.length !== fmt) return 'Choisis exactement ' + fmt + ' carte' + (fmt > 1 ? 's' : '');
  const cnt = {}; let pts = 0;
  for (const s of ids) {
    const { id, tr } = dk(s), r = rarOf(cat, id);
    if (!r) return 'Carte inconnue';
    if (!tr && !playable(u, id, cat, cu)) return cn(id) + " n'est pas jouable en défi (il faut une carte de renaissance, une carte badgée ou une carte objet)"; // un exemplaire badgé est toujours jouable
    cnt[s] = (cnt[s] || 0) + 1;
    const have = tr ? ((u.bd && u.bd[id] && u.bd[id][tr]) || 0) : Math.max(0, (u.cards[id] || 0) - bdSum(u, id));
    if (cnt[s] > have) return "Tu n'as pas assez d'exemplaires de " + cn(id) + (tr ? ' (badge ' + BADGES[tr - 1].name + ')' : ' sans badge');
    if (mode === 'war' && u.fav.includes(id)) return cn(id) + ' est en favori ⭐ : retire-la des favoris pour la jouer en mode Guerre';
    pts += COST[r];
  }
  if (pts > Math.floor(stake / 10)) return 'Trop de force : ' + pts + ' points pour ' + Math.floor(stake / 10) + ' autorisés (mise ' + stake + ' ÷ 10). Augmente la mise ou prends des cartes plus faibles.';
}
function duel(ia, ib, sa, sb, ta = 0, tb = 0) {
  let ha = sa.hp, hb = sb.hp; const r = [], roll = (a) => Math.max(1, Math.round(a * (0.8 + crypto.randomInt(0, 401) / 1000)));
  for (let i = 0; i < 60 && ha > 0 && hb > 0; i++) { const da = roll(sa.atk), db = roll(sb.atk); hb -= da; ha -= db; r.push([da, db]); }
  const ea = Math.max(0, ha), eb = Math.max(0, hb);
  return { a: ia, b: ib, ta, tb, ha: sa.hp, aa: sa.atk, hb: sb.hp, ab: sb.atk, r, ea, eb, w: Math.sign(ea - eb) };
}
// A = celui qui a lancé le défi (x), B = celui qui accepte. Retourne le combat enregistré (replay).
async function settle(A, B, x, sb, cb, cat, cu) {
  const sa = x.s, ca = x.c, war = x.mode === 'war', duels = [];
  for (let i = 0; i < x.fmt; i++) duels.push(duel(ca[i].id, cb[i].id, statsOf(ca[i].id, cat, cu, false, ca[i].tr || 0), statsOf(cb[i].id, cat, cu, false, cb[i].tr || 0), ca[i].tr || 0, cb[i].tr || 0));
  const wa = duels.filter((d) => d.w === 1).length, wb = duels.filter((d) => d.w === -1).length;
  const w = wa !== wb ? Math.sign(wa - wb) : Math.sign(duels.reduce((a, d) => a + d.ea - d.eb, 0)); // plus de duels gagnés, sinon plus de points de vie restants
  const h = { id: crypto.randomBytes(6).toString('hex'), t: Date.now(), a: A.pseudo, b: B.pseudo, mode: x.mode, fmt: x.fmt, sa, sb, w, d: duels, pot: 0, fee: 0, got: null };
  if (w === 0 || !war) { if (war) { A.coins += sa; B.coins += sb; } unlock(A, ca); unlock(B, cb); }
  else {
    const [W, Lo, cw, cl] = w > 0 ? [A, B, ca, cb] : [B, A, cb, ca], tot = sa + sb;
    h.pot = tot - Math.floor((tot * CH.fee) / 100); h.fee = tot - h.pot;
    W.coins += h.pot; unlock(W, cw);
    const k = crypto.randomInt(cl.length); h.got = cl[k].id;
    cl.forEach((c, i) => { if (i === k) { if (c.tr) addB(W, c.id, c.tr); else add(W, c.id, 1); } else unlock(Lo, [c]); });
  }
  { const H0 = (await redis.get('chh')) || []; for (const [P, m] of [[A, w], [B, -w]]) { const c = P.cs || (P.cs = csFrom(H0, P.pseudo)); if (m > 0) c.w++; else if (m < 0) c.l++; else c.d++; } }
  dlUse(A, B.pseudo); dlUse(B, A.pseudo);
  const say = (P, O) => {
    const m = (P === A ? 1 : -1) * w, ms = P === A ? sa : sb;
    return '⚔️ ' + (war ? 'Guerre' : 'Amical') + ' ' + x.fmt + 'v' + x.fmt + ' contre ' + O.pseudo + ' : ' + (m === 0 ? 'égalité' + (war ? ' (mises rendues)' : '') : m > 0 ? 'victoire !' + (war ? ' +' + h.pot + ' 🪙 et la carte ' + cn(h.got) : '') : 'défaite' + (war ? ' −' + ms + ' 🪙 et la carte ' + cn(h.got) : ''));
  };
  note(A, say(A, B)); note(B, say(B, A));
  const H = (await redis.get('chh')) || []; H.unshift(h); await redis.set('chh', H.slice(0, 300));
  return h;
}
let chChk = 0;
async function expireCh() { // défis sans réponse au bout de 48 h : mise et cartes rendues
  const now = Date.now(); if (now - chChk < 60000) return; chChk = now;
  const L = (await redis.get('challenges')) || [], dead = L.filter((x) => x.exp <= now);
  if (!dead.length) return;
  await redis.set('challenges', L.filter((x) => x.exp > now));
  for (const x of dead) { const A = await redis.get(key(x.from)); if (!A) continue; refundCh(A, x, '⌛ Ton défi ' + (x.to ? 'contre ' + x.to : 'ouvert') + " est resté sans réponse : mise et cartes rendues"); await redis.set(key(A.pseudo), A); }
}

function note(u, text, quiet) {
  if (!quiet) {
    (u.notifs ||= []).push(text);
    (u.inbox ||= []).unshift({ id: Date.now() + Math.random().toString(36).slice(2, 6), text, t: Date.now() });
    u.inbox = u.inbox.slice(0, 30);
  }
  if ((u.subs || []).length) pend.push([u.subs, text]);
}
// --- Messages privés : fil "dm:a|b" (200 derniers messages) ; chaque joueur garde un résumé dans u.dm = { pseudo_minuscule: { p, t, x, f, n } } (n = non lus)
const dmKey = (a, b) => 'dm:' + [a.toLowerCase(), b.toLowerCase()].sort().join('|');
async function dmPush(a, b, text, sys) {
  const k = dmKey(a.pseudo, b.pseudo), th = (await redis.get(k)) || [], t = Date.now();
  th.push({ id: t + Math.random().toString(36).slice(2, 5), f: a.pseudo, t, x: text, ...(sys ? { s: 1 } : {}) });
  await redis.set(k, th.slice(-200)); await redis.sadd('dms', k);
  const slot = (o, other, unread) => {
    o.dm ||= {};
    const e = (o.dm[other.pseudo.toLowerCase()] ||= { p: other.pseudo, n: 0 });
    e.p = other.pseudo; e.t = t; e.x = text.slice(0, 80); e.f = a.pseudo; if (unread) e.n = (e.n || 0) + 1;
  };
  slot(a, b, false); slot(b, a, true);
}
// notification légère (toast + push) sans remplir la boîte 🔔
function ping(u, text) {
  (u.notifs ||= []).push(text);
  if ((u.subs || []).length) pend.push([u.subs, text]);
}
async function dmDrop(u) { // suppression d'un compte : fils et résumés chez les autres
  for (const [, e] of Object.entries(u.dm || {})) {
    const k = dmKey(u.pseudo, e.p); await redis.del(k); await redis.srem('dms', k);
    const o = await redis.get('u:' + e.p.toLowerCase());
    if (o && o.dm) { delete o.dm[u.pseudo.toLowerCase()]; await redis.set('u:' + e.p.toLowerCase(), o); }
  }
}
// Sachets gratuits : un stock (10 max) et un compteur PAR SACHET (par collection : foot, vélo, espace…). Ouvrir un sachet ne retire que du stock de CE sachet.
// u.fl[collection] = { n, last }. u.packs = réserve commune : sachets offerts (codes, roue, staff…), utilisés par n'importe quel sachet quand son propre stock est vide.
// Le 1er sachet est TOUJOURS à 10 min. Les suivants s'allongent régulièrement pour que le stock de 10 se remplisse en 2 h × FM(niveau) (niveau 1 = 2 h … niveau 9 = 10 h).
const FM = (L) => 1 + 0.5 * (L - 1), stepL = (k, L) => Math.round((10 + (k * (120 * FM(L) - 100)) / 45) * 60000);
const slKey = (cat, t) => baseOf(cat, t), slLv = (u, k) => (LINES.includes(k) ? lineLv(u, k) : 1);
const freeOf = (u, cat, t) => { const x = (u.fl || {})[slKey(cat, t)]; return (x ? x.n : 0) + (u.packs || 0); };
const freeTake = (u, cat, t, n) => { const x = (u.fl || {})[slKey(cat, t)], a = x ? Math.min(x.n, n) : 0; if (a) x.n -= a; if (n > a) u.packs -= n - a; };
const freeAll = (u) => (u.packs || 0) + Object.values(u.fl || {}).reduce((a, x) => a + x.n, 0);
const tk1 = (x, L, now) => { if (x.n >= MAXP) { x.last = now; return; } let st; while (x.n < MAXP && now - x.last >= (st = stepL(x.n, L))) { x.last += st; x.n++; } if (x.n >= MAXP) x.last = now; };
function slMig(u, now) { // ancien système (un stock partagé par niveau) → un stock par sachet. On répartit l'ancien stock entre les sachets du même niveau : personne ne perd rien, rien n'est créé.
  if (u.fl) return;
  const old = (L) => (L <= 1 ? u.packs || 0 : ((u.fp || {})[L] || { n: 0 }).n), oldLast = (L) => (L <= 1 ? u.last : ((u.fp || {})[L] || {}).last) || now, lv = [...new Set(LINES.map((l) => lineLv(u, l)))];
  let pool = 0; u.fl = {};
  for (const L of lv) { const ls = LINES.filter((l) => lineLv(u, l) === L), tot = old(L); ls.forEach((l, i) => { u.fl[l] = { n: Math.floor(tot / ls.length) + (i < tot % ls.length ? 1 : 0), last: oldLast(L) }; }); }
  for (const L of new Set([1, ...Object.keys(u.fp || {}).map(Number)])) if (!lv.includes(L)) pool += old(L);
  u.packs = pool; delete u.fp;
}
function slEnsure(u, cat, now) { for (const t of Object.keys(cat)) { if (t === 'obj') continue; const k = slKey(cat, t); if (!u.fl[k]) u.fl[k] = { n: 1, last: now || Date.now() }; } } // collections hors lignes (provisoires) : 1 sachet offert pour commencer
function tick(u) { const now = Date.now(); slMig(u, now); for (const [k, x] of Object.entries(u.fl)) tk1(x, slLv(u, k), now); }
const shopOf = async (cat) => {
  const s = (await redis.get('shop')) || {};
  return Object.fromEntries(Object.entries(cat).filter(([, o]) => live(o)).map(([t]) => [t, { discount: int(s[(cat[t] && cat[t].base) || t] && s[(cat[t] && cat[t].base) || t].discount, 90), blocked: !!(s[(cat[t] && cat[t].base) || t] && s[(cat[t] && cat[t].base) || t].blocked) }]));
};
// Niveaux : chaque collection de base (foot…) a plusieurs niveaux = autant de collections différentes (foot, foot2…foot6). Niveaux 6 à 9 : +100 cartes par niveau (200, 300, 400, 500) avec mythiques, célestes et uniques.
// Niveau d'un joueur sur une ligne = 1 + son nombre total de renaissances sur cette ligne (5 max). Le prix du sachet double à chaque niveau : 100, 200, 400, 800, 1600.
const LVMAX = 7, /* mettre 9 quand les niveaux 8 et 9 existent */ LINES = Object.keys(T0).filter((t) => Object.values(T0).some((o) => o.base === t));
const lvOf = (cat, t) => (cat[t] && cat[t].lv) || 1, baseOf = (cat, t) => (cat[t] && cat[t].base) || t;
const lineLv = (u, b) => Math.min(LVMAX, 1 + [b, ...Array.from({ length: LVMAX - 1 }, (_, i) => b + (i + 2))].reduce((a, k) => a + (((u && u.rb) || {})[k] || 0), 0));
// Un niveau supérieur d'une ligne reste invisible (marché, échanges, cadeaux, recherche…) tant que le joueur ne l'a pas débloqué : comme s'il n'existait pas. On garde ce qu'il possède déjà.
const known = (u, cat, t) => { const o = cat[t]; return !o || !o.base || o.lv <= lineLv(u, o.base) || Object.keys(u.cards || {}).some((id) => id.startsWith(t + ':')) || ((u.bought || {})[t] || 0) > 0; };
const knownId = (u, cat, id) => known(u, cat, String(id).slice(0, String(id).indexOf(':')));
const price = (sh, t, cat) => Math.round((PRICE * 2 ** (lvOf(cat, t) - 1) * (100 - sh.discount)) / 100);
// boutique d'un joueur : un seul sachet par ligne (celui de son niveau) ; les anciens ne restent que s'il en reste d'achetés
const visShop = (u, sh, cat) => Object.fromEntries(Object.entries(sh).filter(([t]) => { const b = baseOf(cat, t), ob = cat[t]; if (ob && ob.until != null && !ob.base && ((u.rb || {})[t] || 0) >= 1) return false; return !LINES.includes(b) || lvOf(cat, t) === lineLv(u, b) || (u.bought || {})[t] > 0; }).map(([t, s]) => [t, { ...s, nobuy: LINES.includes(baseOf(cat, t)) && lvOf(cat, t) !== lineLv(u, baseOf(cat, t)) }]));
const view = (u, sh, cat, cu, mk) => ({
  market: (mk || []).filter((x) => !x.to || x.to === u.pseudo || x.seller === u.pseudo).filter((x) => x.seller === u.pseudo || (knownId(u, cat, x.card) && (!x.want || knownId(u, cat, x.want)))), inbox: u.inbox || [],
  dms: Object.values(u.dm || {}).sort((a, b) => b.t - a.t), pseudo: u.pseudo, ban: banOf(u), ch: { ok: rbTot(u) > 0, left: dlInfo(u).left, max: dlInfo(u).max }, st: Object.fromEntries(Object.keys(u.cards).map((id) => { const s = statsOf(id, cat, cu); return [id, s ? [s.hp, s.atk, playable(u, id, cat, cu) ? 1 : 0] : null]; })), rl: rlInfo(u), mg: mgInfo(u), dn: u.dn || null, renames: u.renames || 0, rb: u.rb || {}, dy: dyInfo(u), rc: raceView(u), fk: u.fk || {}, pf: u.pf || null, sub: subOf(u) ? { t: u.sub.t, until: u.sub.until, trial: !!u.sub.trial, col: u.subCol || null } : null, subTrial: !!u.subTrial, subs: SUBS, pfn: u.pfpN || 0, pfq: !!u.pfpReq, coins: u.coins, packs: u.packs, bought: u.bought || {},
  rw: (u.rw || []).map((x) => ({ rank: x.rank, name: x.name })), rws: (u.rw || [])[0] ? wSegs(u.rw[0].rank, u.rw[0].mult).map(wLabel) : null,
  fl: Object.fromEntries(Object.entries(u.fl || {}).map(([k, x]) => [k, { n: x.n, next: x.n >= MAXP ? null : x.last + stepL(x.n, slLv(u, k)) }])), cards: u.cards, bd: u.bd || {}, fav: u.fav, theme: u.theme || null,
  vals: Object.fromEntries(Object.keys(u.cards).map((id) => [id, val(u, id, cat, cu)])),
  shop: Object.fromEntries(Object.entries(sh).map(([t, s]) => [t, { ...s, price: price(s, t, cat), full: PRICE * 2 ** (lvOf(cat, t) - 1), lvl: lvOf(cat, t) }])), lv: Object.fromEntries(LINES.map((b) => [b, lineLv(u, b)])), lvn: Object.fromEntries(LINES.map((b) => [b, (cat[b + (lineLv(u, b) + 1)] || {}).name || null])),
  objs: cu.objs.filter((x) => !x.gone), themes: Object.fromEntries(Object.entries(cat).filter(([t]) => known(u, cat, t))),
});
// Plus le niveau du sachet est haut, plus les légendaires (et un peu les épiques) sont rares ; la différence revient aux communes.
const LEG = [4, 2.5, 1.5, 0.9, 0.5, 0.4, 0.35, 0.3, 0.25], EPI = [11, 10, 9, 8, 7, 6.5, 6, 5.5, 5];
// Niveaux 6 à 9 seulement : chances (en % par carte) d'une carte mythique, céleste, unique. Avant le niveau 6, elles ne sortent jamais.
const MSU = [null, null, null, null, null, [0.08, 0.03, 0.005], [0.10, 0.04, 0.007], [0.12, 0.05, 0.010], [0.15, 0.06, 0.015]];
// Plus un joueur approche de la fin d'une collection (niveaux 6+), plus ses chances de mythique / céleste / unique montent :
// ×1 jusqu'à 70 % de la collection, puis jusqu'à ×5 à 90 %, puis jusqu'à ×20 à 100 %. S'il ne lui manque QUE des mythiques / célestes / uniques,
// chaque carte tirée a en plus 1 % de chances d'être directement une des cartes manquantes.
const cids = (o, t) => [...R].flatMap((r) => (o[r] || []).map((n) => t + ':' + n));
function pity(u, o, t) {
  const msu = ['m', 's', 'u'].flatMap((r) => (o[r] || []).map((n) => t + ':' + n));
  if (!u || !msu.length) return { k: 1, aim: null };
  const all = cids(o, t), miss = all.filter((id) => !(u.cards[id] > 0)), p = 1 - miss.length / all.length, mm = msu.filter((id) => !(u.cards[id] > 0));
  return { k: p < 0.7 ? 1 : p < 0.9 ? 1 + ((p - 0.7) / 0.2) * 4 : 5 + ((p - 0.9) / 0.1) * 15, aim: mm.length && mm.length === miss.length ? mm : null };
}
function draw(o, t, lv = 1, mult = 1, py = { k: 1, aim: null }) {
  if (py.aim && Math.random() < 0.01) return py.aim[Math.floor(Math.random() * py.aim.length)];
  const ms = MSU[lv - 1] || [0, 0, 0], w = { ...W, l: (LEG[lv - 1] ?? LEG[0]) * mult, e: EPI[lv - 1] ?? EPI[0], m: ms[0] * py.k, s: ms[1] * py.k, u: ms[2] * py.k }; // mult = bonus d'abonnement sur les légendaires
  w.c = 100 - w.r - w.e - w.l - w.m - w.s - w.u;
  let x = Math.random() * 100, r = 'c';
  for (const k of 'crelmsu') { if ((x -= w[k]) < 0) { r = k; break; } }
  if (!(o[r] || []).length) r = 'c';
  return t + ':' + o[r][Math.floor(Math.random() * o[r].length)];
}

// --- Bots : 4 joueurs simulés (fort, moyen-fort, moyen, nul), actifs 12 h sur 24 (heure de Paris), sans tâche planifiée :
// ils jouent "au rattrapage" dès que quelqu'un utilise le site (au plus un tour toutes les 90 s).
const BOTS = [
  { name: 'Maxime_G', lvl: 'fort', shift: [7, 19], every: 10 },
  { name: 'Chloe_78', lvl: 'mf', shift: [8, 20], every: 15 },
  { name: 'Lucas_FR', lvl: 'moy', shift: [7, 19], every: 25 },
  { name: 'Zoe_cards', lvl: 'nul', shift: [8, 20], every: 40 },
];
const isBotName = (n) => BOTS.some((x) => x.name.toLowerCase() === String(n).toLowerCase());
// s = marge de prix à la vente, b/bm = prix max à l'achat (x valeur) pour une carte quelconque / manquante, rb = chance d'acheter,
// tm = ratio minimal accepté en échange, ct = chance de contre-offre, off = offres d'échange ouvertes
const LV = {
  fort: { s: [1.1, 1.35], b: 0.85, bm: 1.05, rb: 1, tm: 1.0, ct: 1, off: 2, cu: 0.5, dc: 0.9, dl: 0.25 },
  mf: { s: [0.95, 1.5], b: 0.95, bm: 1.1, rb: 0.8, tm: 0.9, ct: 0.7, off: 1, cu: 0.35, dc: 0.8, dl: 0.15 },
  moy: { s: [0.7, 1.9], b: 1.2, bm: 1.2, rb: 0.4, tm: 0.75, ct: 0.3, off: 0, cu: 0.2, dc: 0.7, dl: 0.05 },
  nul: { s: [0.3, 3], b: 99, bm: 99, rb: 0.25, tm: 99, ct: 0, off: 0, cu: 0.05, dc: 0.5, dl: 0 },
};
// Classement d'une course : joueurs réels + bots (un bot reste toujours derrière le meilleur joueur : il peut être 2e, jamais 1er).
function raceBoard(list, id) {
  const real = list.filter((v) => v && !v.bot && !banOf(v)), pos = (v) => (v.rc && v.rc.w === id ? v.rc.pos : 0), top = Math.max(0, ...real.map(pos));
  return [...real, ...list.filter((v) => v && v.bot)].map((v) => { const r = v.rc && v.rc.w === id ? v.rc : null, ps = r ? r.pos : 0; return { pseudo: v.pseudo, bot: !!v.bot, pos: v.bot ? Math.min(ps, real.length ? Math.max(0, top - 1) : ps) : ps, tt: (r && r.tt) || 0, car: v.car || null, sk: carSkin(v), pf: v.pf || null }; })
    .sort((a, c) => c.pos - a.pos || a.bot - c.bot || (a.tt || 9e15) - (c.tt || 9e15) || a.pseudo.localeCompare(c.pseudo)).map((x, i) => ({ ...x, rank: i + 1 }));
}
async function raceFinish(cur, now) {
  const names = await redis.smembers('users'), list = names.length ? await redis.mget(...names.map(key)) : [], board = raceBoard(list, cur.id);
  const win = board.length && !board[0].bot && board[0].pos > 0 ? board[0] : null;
  await redis.set('race:last', { id: cur.id, name: cur.name, kind: cur.kind, winner: win ? { pseudo: win.pseudo, pos: win.pos } : null });
  for (const x of board.slice(0, 2)) {
    if (x.bot || x.pos <= 0 || (x.rank === 2 && !win)) continue;
    const v = await redis.get(key(x.pseudo)); if (!v) continue;
    (v.rw ||= []).push({ id: cur.id, rank: x.rank, name: cur.name, kind: cur.kind, mult: cur.mult || 1 });
    note(v, '🎡 ' + cur.name + ' terminée : tu finis ' + (x.rank === 1 ? '1er' : '2e') + ' avec ' + x.pos + ' points ! Une roue t’attend dans Social → Course.'); await redis.set(key(v.pseudo), v);
  }
  const ev = cur.kind === 'normal' && Math.random() < 0.35, h = ev ? (Math.random() < 0.5 ? 12 : 24) : 72;
  const nx = ev ? { id: 'e' + now.toString(36), start: now, end: now + h * 36e5, kind: 'event', name: '⚡ Course événement (' + h + ' h)', mult: 2 } : { id: 'c' + now.toString(36), start: now, end: now + 72 * 36e5, kind: 'normal', name: 'Course de 3 jours', mult: 1 };
  await redis.set('race:cur', nx); return nx;
}
async function raceSync() {
  const now = Date.now();
  if (RACE && now < RACE.end && now - raceChk < 20000) return;
  let cur = await redis.get('race:cur');
  if (!cur) { cur = { id: raceWeek0(), start: now, end: raceEnd0(), kind: 'normal', name: 'Course de la semaine', mult: 1 }; await redis.set('race:cur', cur); }
  if (now >= cur.end && (await redis.set('race:lock', now, { nx: true, ex: 60 }))) { const c2 = await redis.get('race:cur'); cur = c2 && now >= c2.end ? await raceFinish(c2, now) : c2 || cur; }
  RACE = cur; raceChk = now;
}
// Roue de fin de course : le serveur tire le lot, la roue ne fait que l'animer.
function wheelSpin(u, w, cat) {
  const segs = wSegs(w.rank, w.mult), tot = segs.reduce((a, g) => a + g.w, 0); let x = crypto.randomInt(tot * 100) / 100, idx = 0;
  for (let i = 0; i < segs.length; i++) { if ((x -= segs[i].w) < 0) { idx = i; break; } }
  const g = segs[idx], card = (r) => { const bs = LINES[crypto.randomInt(LINES.length)], lv = lineLv(u, bs), t = lv > 1 && cat[bs + lv] ? bs + lv : bs, o = cat[t], a = (o[r] && o[r].length ? o[r] : o.c); const id = t + ':' + a[crypto.randomInt(a.length)]; add(u, id, 1); return cn(id); };
  let text;
  if (g.k === 'coins') { u.coins += g.n; text = g.n + ' 🪙'; }
  else if (g.k === 'packs') { u.packs += g.n; text = g.n + ' sachets gratuits'; }
  else if (g.k === 'rx') { u.rcX = (u.rcX || 0) + g.n; text = g.n + ' packs de course'; }
  else if (g.k === 'sub') { const cur = subOf(u); if (cur) u.sub.until += g.n * DAY; else u.sub = { t: 1, until: Date.now() + g.n * DAY }; text = g.n + ' jour d’abonnement'; }
  else if (g.k === 'card') text = 'la carte ' + card(g.r) + ' (' + RN0[g.r] + ')';
  else { u.coins += g.n; text = 'LE JACKPOT : ' + g.n + ' 🪙 et la carte ' + card('l') + ' (légendaire)'; }
  return { idx, text, segs: segs.map(wLabel) };
}
// Renaissance d'une collection (joueurs et bots) : renvoie un texte d'erreur, ou le résultat.
function rebirthDo(u, t, cat, cu) {
  const o = cat[t];
  if (!o || t === 'obj') return ('Collection inconnue');
  const ids = [...R].flatMap((r) => (o[r] || []).map((n) => t + ':' + n));
  if (o.until != null && !o.base && ((u.rb || {})[t] || 0) >= 1) return ('Cette collection provisoire a déjà fait sa renaissance (une seule fois)');
  if (!ids.length || ids.some((id) => !u.cards[id])) return ('Collection incomplète');
  const gain = Math.floor(ids.reduce((a, id) => a + val(u, id, cat, cu), 0) / 5);
  let kept = 0;
  for (const id of Object.keys(u.cards)) if (id.startsWith(t + ':')) {
    if (u.fav.includes(id)) { if (u.cards[id] > 1) rm(u, id, u.cards[id] - 1); (u.fk ||= {})[id] = Date.now(); kept++; } // favorite : gardée (1 exemplaire) dans le livret Favoris, sa valeur monte jusqu'à ×5 en 7 jours
    else rm(u, id, u.cards[id]);
  }
  const L0 = lineLv(u, baseOf(cat, t)), rb0 = rbTot(u);
  (u.rb ||= {})[t] = (u.rb[t] || 0) + 1; u.coins += gain;
  if (o.until != null && !o.base && u.bought[t] > 0) { u.packs += u.bought[t]; delete u.bought[t]; } // collection provisoire : les sachets restants deviennent des sachets gratuits
  const L1 = lineLv(u, baseOf(cat, t)), nt = L1 > L0 ? (L1 > 1 ? baseOf(cat, t) + L1 : baseOf(cat, t)) : null;
  return { chUnlock: rb0 === 0, gain, lv: L1, kept, unlocked: nt && cat[nt] ? cat[nt].name : null, last: !(nt && cat[nt]) && LINES.includes(baseOf(cat, t)) && L1 >= LVMAX };
}
// Défis des bots : choix des cartes (le fort/moyen-fort prend les plus puissantes, les autres au hasard) puis réponse à un défi.
function botPick(u, fmt, stake, cat, cu, strong, mode) {
  const pool = [];
  for (const [id, n] of Object.entries(u.cards)) {
    const have = Math.max(0, n - bdSum(u, id)), r = rarOf(cat, id), st = r && statsOf(id, cat, cu);
    if (!have || !st || u.fav.includes(id) || !playable(u, id, cat, cu)) continue;
    for (let i = 0; i < Math.min(have, fmt); i++) pool.push({ id, c: COST[r], p: st.hp + st.atk * 3 });
  }
  if (pool.length < fmt) return null;
  if (strong) pool.sort((a, c) => c.p - a.p); else shuf(pool);
  const budget = Math.floor(stake / 10), minC = Math.min(...pool.map((x) => x.c)), ids = []; let spent = 0;
  for (const x of pool) if (ids.length < fmt && spent + x.c + (fmt - ids.length - 1) * minC <= budget) { ids.push(x.id); spent += x.c; }
  return ids.length === fmt && !pickCards(u, ids, fmt, stake, mode, cat, cu) ? ids : null;
}
async function botAccept(B, x, A, cat, cu) { // B = bot qui répond, A = joueur qui a lancé le défi ; renvoie le combat, ou null si le bot refuse
  const P = LV[B.bot], di = dlInfo(B), da = dlInfo(A);
  if (!rbTot(B) || di.left <= 0 || da.left <= 0 || (di.o[A.pseudo.toLowerCase()] || 0) >= CH.vs || (da.o[B.pseudo.toLowerCase()] || 0) >= CH.vs || Math.random() > P.dc) return null;
  const st = x.mode === 'war' ? Math.min(x.s, B.coins) : x.s;
  if (st < 10) return null;
  const ids = botPick(B, x.fmt, st, cat, cu, B.bot === 'fort' || B.bot === 'mf', x.mode);
  if (!ids) return null;
  const L = (await redis.get('challenges')) || [];
  if (!L.some((y) => y.id === x.id)) return null;
  await redis.set('challenges', L.filter((y) => y.id !== x.id));
  const cb = lock(B, ids); if (x.mode === 'war') B.coins -= st;
  return settle(A, B, x, st, cb, cat, cu);
}
async function botTurn(u, cat, cu, sh, mk) {
  const P = LV[u.bot], rnd = (a, c) => a + Math.random() * (c - a), V = (id) => val(u, id, cat, cu), pick = (a) => a[Math.floor(Math.random() * a.length)];
  const save = async (v) => redis.set(key(v.pseudo), v);
  tick(u); slEnsure(u, cat); sh = visShop(u, sh, cat);
  // 1. sachets : le fort n'en achète que s'ils sont rentables (valeur moyenne d'un sachet ~46 coins)
  const themes = Object.keys(sh).filter((t) => !sh[t].blocked && t !== 'obj');
  if (themes.length) {
    const t = pick(themes), p = price(sh[t], t, cat);
    if (u.coins >= p + 50 && (P.rb < 0.5 || u.bot === 'nul' ? Math.random() < 0.3 : p <= 45)) { u.coins -= p; u.bought[t] = (u.bought[t] || 0) + 1; }
  }
  for (let i = 0; i < 12; i++) {
    let t = Object.keys(u.bought).find((k) => u.bought[k] > 0 && sh[k] && !sh[k].blocked);
    if (t) u.bought[t]--; else {
      const av = themes.filter((k) => freeOf(u, cat, k) > 0); // sachets gratuits : un stock par sachet
      if (!av.length) break;
      const miss = (k) => cids(cat[k], k).filter((id) => !u.cards[id]).length;
      t = u.bot === 'fort' || u.bot === 'mf' ? av.sort((a, c) => miss(c) - miss(a))[0] : pick(av);
      freeTake(u, cat, t, 1);
    }
    const py = pity(u, cat[t], t);
    Array.from({ length: PACK }, () => draw(cat[t], t, lvOf(cat, t), 1, py)).forEach((id) => add(u, id, 1));
  }
  // 1b. renaissance : collection de niveau actuel complète (les bots qui y sont presque reçoivent parfois la dernière carte manquante)
  for (const t of Object.keys(sh)) {
    const o = cat[t], bs = baseOf(cat, t);
    if (!o || t === 'obj' || !LINES.includes(bs) || lvOf(cat, t) !== lineLv(u, bs)) continue;
    const ids = cids(o, t); let miss = ids.filter((id) => !u.cards[id]);
    if (miss.length && miss.length <= Math.ceil(ids.length * 0.1) && Math.random() < P.cu) { add(u, pick(miss), 1); miss = ids.filter((id) => !u.cards[id]); }
    if (ids.length && !miss.length) { const r = rebirthDo(u, t, cat, cu); if (typeof r !== 'string') break; }
  }
  // 2. échanges reçus (ciblés ou ouverts)
  for (const x of mk.filter((y) => y.want && y.seller !== u.pseudo && !y.ask && (!y.to || y.to === u.pseudo))) {
    if (!u.cards[x.want]) continue;
    const give = V(x.want), get = V(x.card), ratio = (get / give) * (u.cards[x.card] ? 1 : 1.25) * (u.cards[x.want] > 1 ? 1.2 : 0.8);
    const v = await redis.get(key(x.seller));
    if (ratio >= P.tm || (u.bot === 'nul' && Math.random() < 0.5)) {
      mk = mk.filter((y) => y !== x); rm(u, x.want, 1); add(u, x.card, 1);
      if (v) { add(v, x.want, 1); await dmPush(u, v, '✅ Échange accepté : ' + cn(x.card) + ' contre ' + cn(x.want), true); note(v, '🔁 ' + u.pseudo + ' a accepté ton échange : tu reçois ' + cn(x.want)); await save(v); }
    } else if (x.to === u.pseudo && ratio >= P.tm * 0.7 && Math.random() < P.ct) {
      x.ask = Math.max(1, Math.ceil((give - get) * 1.1));
      if (v) { note(v, '💬 ' + u.pseudo + ' demande +' + x.ask + ' 🪙 en plus pour ' + cn(x.card) + ' contre ' + cn(x.want)); await save(v); }
    } else if (x.to === u.pseudo) {
      mk = mk.filter((y) => y !== x);
      if (v) { add(v, x.card, 1); note(v, '❌ ' + u.pseudo + " a refusé ton échange : ta carte t'est rendue"); await save(v); }
    }
  }
  // 3. mise en vente des doublons (prix selon le niveau)
  const mine = () => mk.filter((x) => x.seller === u.pseudo);
  if (Math.random() < 0.6) {
    for (const [id, n] of Object.entries(u.cards).filter(([id, n]) => n > 1 && !u.fav.includes(id)).slice(0, 3)) {
      if (mine().length >= 8) break;
      rm(u, id, 1); mk.push({ id: crypto.randomBytes(6).toString('hex'), seller: u.pseudo, card: id, price: Math.max(1, Math.round(V(id) * rnd(...P.s))), t: Date.now() });
    }
  }
  // 4. achats au Marché
  let bought = 0;
  for (const x of [...mk].sort(() => Math.random() - 0.5)) {
    if (bought >= 2) break;
    if (x.want || x.seller === u.pseudo || Math.random() > P.rb) continue;
    if (x.price <= V(x.card) * (u.cards[x.card] ? P.b : P.bm) && x.price <= u.coins - 20) {
      mk = mk.filter((y) => y !== x); u.coins -= x.price; addM(u, x); bought++;
      const v = await redis.get(key(x.seller));
      if (v) { v.coins += x.price; note(v, '💰 ' + u.pseudo + ' a acheté ta carte ' + cn(x.card) + ' pour ' + x.price + ' coins'); await save(v); }
    }
  }
  // 5. offres d'échange ouvertes : un doublon contre une carte manquante de même rareté
  if (P.off && mine().filter((x) => x.want).length < P.off && Math.random() < 0.3) {
    const d = Object.keys(u.cards).find((id) => u.cards[id] > 1 && !u.fav.includes(id) && !id.startsWith('obj:'));
    const r = d && rarOf(cat, d), m = r && pick(Object.keys(cat).filter((t) => t !== 'obj' && !cat[t].base && live(cat[t])).flatMap((t) => cat[t][r].map((n) => t + ':' + n)).filter((id) => !u.cards[id]).concat([null]));
    if (m) { rm(u, d, 1); mk.push({ id: crypto.randomBytes(6).toString('hex'), seller: u.pseudo, card: d, want: m, price: 0, to: null, t: Date.now() }); }
  }
  botRace(u, Date.now());
  // 6. défis : le bot relève les défis ouverts, et lance parfois le sien
  if (rbTot(u) > 0) {
    for (const x of ((await redis.get('challenges')) || []).filter((y) => !y.to && y.from !== u.pseudo && y.exp > Date.now()).slice(0, 2)) {
      const A = await redis.get(key(x.from));
      if (A && !A.bot && (await botAccept(u, x, A, cat, cu))) await redis.set(key(A.pseudo), A);
    }
    const L = (await redis.get('challenges')) || [];
    if (Math.random() < P.dl && !L.some((y) => y.from === u.pseudo) && dlInfo(u).left > 0) {
      const war = Math.random() < 0.5, fmt = Math.random() < 0.5 ? 3 : 1, st = war ? Math.min(u.coins, 50 * (1 + crypto.randomInt(4))) : 100;
      const ids = st >= 10 && botPick(u, fmt, st, cat, cu, u.bot === 'fort' || u.bot === 'mf', war ? 'war' : 'fun');
      if (ids) { const c = lock(u, ids), now = Date.now(); if (war) u.coins -= st; L.push({ id: crypto.randomBytes(6).toString('hex'), from: u.pseudo, to: null, mode: war ? 'war' : 'fun', fmt, s: st, c, t: now, exp: now + CH.ttl }); await redis.set('challenges', L); }
    }
  }
  return mk;
}
let botsOk = false;
async function ensureBots() {
  if (botsOk) return;
  const now = Date.now();
  for (const B of BOTS) {
    const u = await redis.get(key(B.name));
    if (!u) {
      const salt = crypto.randomBytes(16).toString('hex');
      await redis.set(key(B.name), { pseudo: B.name, salt, hash: hash(crypto.randomBytes(8).toString('hex'), salt), coins: 200, packs: 1, bought: {}, last: now, cards: {}, since: {}, fav: [], notifs: [], bot: B.lvl });
    } else if (!u.bot) { console.error('bots: le pseudo ' + B.name + ' est pris par un vrai joueur'); continue; }
    await redis.sadd('users', B.name);
  }
  botsOk = true;
}
let botChk = 0;
async function runBots() {
  const now = Date.now();
  if (now - botChk < 30000) return;
  botChk = now;
  if (await redis.get('maint')) return;
  const t = await redis.get('bots:t');
  if (t && now - t < 90000) return;
  await redis.set('bots:t', now);
  const h = +new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: 'numeric', hourCycle: 'h23' }).format(new Date(now));
  const cu = await loadCu(), cat = full(cu), sh = await shopOf(cat);
  let mk = null;
  for (const B of BOTS) {
    let u = await redis.get(key(B.name));
    if (!u) {
      const salt = crypto.randomBytes(16).toString('hex');
      u = { pseudo: B.name, salt, hash: hash(crypto.randomBytes(8).toString('hex'), salt), coins: 200, packs: 1, bought: {}, last: now, cards: {}, since: {}, fav: [], notifs: [], bot: B.lvl };
      await redis.set(key(B.name), u); await redis.sadd('users', B.name);
    } else if (!u.bot) continue;
    u.since ||= {}; u.fav ||= []; u.bought ||= {};
    if (h < B.shift[0] || h >= B.shift[1] || now - (u.lastAct || 0) < B.every * 60000) continue;
    mk ||= (await redis.get('market')) || [];
    u.lastAct = now; mk = await botTurn(u, cat, cu, sh, mk);
    await redis.set(key(u.pseudo), u);
  }
  if (mk) await redis.set('market', mk);
  // Notification de course aux joueurs avec notifications push (même appli fermée) : déclenchée dès que quelqu'un utilise le site
  const names = await redis.smembers('users'), list = names.length ? await redis.mget(...names.map(key)) : [];
  for (const v of list) if (v && !v.bot && (v.subs || []).length && now - (v.seen || 0) < 7 * DAY && raceNote(v)) await redis.set(key(v.pseudo), v);
}

// --- Notification quotidienne : "Viens ouvrir tes packs gratuits" vers 12h30 (heure de Paris), via Vercel Cron (GET /api/game?cron=1).
// Le cron est en UTC : on le déclenche à 10h30 ET 11h30 UTC (été / hiver) ; le code ne notifie qu'une fois par jour et seulement entre 12h et 14h à Paris.
const DAILY_MSG = 'Viens ouvrir tes packs gratuits ! 🎁';
async function dailyPush() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t).value, day = g('year') + '-' + g('month') + '-' + g('day'), mins = +g('hour') * 60 + +g('minute');
  if (mins < 720 || mins >= 840) return { sent: 0, skipped: 'hors de la fenêtre 12h-14h (Paris)' };
  if (await redis.get('maint')) return { sent: 0, skipped: 'maintenance' };
  if ((await redis.get('daily:last')) === day) return { sent: 0, skipped: 'déjà envoyée aujourd\'hui' };
  await redis.set('daily:last', day);
  const names = await redis.smembers('users'), list = names.length ? await redis.mget(...names.map(key)) : [];
  let n = 0;
  for (const v of list) if (v && (v.subs || []).length) { note(v, DAILY_MSG, true); n++; } // quiet : notification push seulement, pas dans la boîte de réception
  await flush();
  return { sent: n };
}

const handler = async (req, res) => {
  const fail = (m, c = 400) => res.status(c).json({ error: m });
  const ok = (d) => res.status(200).json(d);
  const cron = req.method === 'GET' && new URL(req.url, 'http://x').searchParams.get('cron') === '1';
  const imgId = req.method === 'GET' ? new URL(req.url, 'http://x').searchParams.get('img') : null; // photo de carte envoyée par l'opérateur depuis sa galerie
  if (req.method !== 'POST' && !cron && !imgId) return fail('POST uniquement', 405);
  if (cron && process.env.CRON_SECRET) {
    const sent = (req.headers.authorization || '').replace(/^Bearer /, '') || new URL(req.url, 'http://x').searchParams.get('key');
    if (sent !== process.env.CRON_SECRET) return fail('Non autorisé', 401);
  }
  const b = req.body || {};
  try {
    if (!redis) {
      const url = envFind(/(REST_API_URL|REDIS_REST_URL)$/), token = envFind(/(REST_API_TOKEN|REDIS_REST_TOKEN)$/);
      if (!url || !token) return fail('Base de données non reliée : dans Vercel, ajoute Upstash Redis au projet (Storage > Connect Project), puis fais Redeploy', 500);
      redis = new (require('@upstash/redis').Redis)({ url, token });
    }
    if (imgId) {
      const d = /^[a-f0-9]{12}$/.test(imgId) ? await redis.get('cimg:' + imgId) : null, m = typeof d === 'string' && d.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+=*)$/);
      if (!m) return fail('Image inconnue', 404);
      res.setHeader('Content-Type', 'image/' + m[1]); res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.status(200).send(Buffer.from(m[2], 'base64'));
    }
    if (cron) return ok(await dailyPush());
    await raceSync().catch((e) => console.error('raceSync', e.message));
    await ensureBots().catch((e) => console.error('ensureBots', e.message));
    await runBots().catch((e) => console.error('bots', e.message));

    if (b.action === 'register' || b.action === 'login') {
      const pseudo = String(b.pseudo || '').trim(), pw = String(b.password || '');
      if (b.action === 'login' && OP_ID && pseudo.toLowerCase() === OP_ID) {
        if (pw !== OP_CODE) return fail('Identifiant ou code incorrect', 401);
        const token = crypto.randomBytes(24).toString('hex');
        await redis.set('s:' + token, { op: true }, { ex: 86400 * 7 });
        return ok({ token, op: true });
      }
      if (!/^[A-Za-z0-9_]{3,20}$/.test(pseudo)) return fail('Pseudo : 3 à 20 lettres, chiffres ou _');
      if (!pw) return fail('Entre un mot de passe');
      if (b.action === 'register' && (await redis.get('maint'))) return fail('🔧 Maintenance : les inscriptions reviennent bientôt');
      let u = await redis.get(key(pseudo));
      const ih = ipHash(req);
      if (b.action === 'register') {
        const bi = ih && (await redis.get('banip:' + ih));
        if (bi && (bi.until == null || bi.until > Date.now())) return fail("Inscription impossible depuis cette connexion pour le moment");
        if (u || pseudo.toLowerCase() === OP_ID || pseudo.toLowerCase() === OP_NAME.toLowerCase() || isBotName(pseudo)) return fail('Ce pseudo est déjà pris');
        const salt = crypto.randomBytes(16).toString('hex');
        u = { pseudo, salt, hash: hash(pw, salt), coins: 200, packs: 1, bought: {}, last: Date.now(), cards: {}, since: {}, fav: [], notifs: [], ips: ih ? [ih] : [], seen: Date.now() };
        await redis.set(key(pseudo), u);
        await redis.sadd('users', pseudo);
        await opNote('🆕 Nouvelle inscription : ' + pseudo);
      } else if (!u || hash(pw, u.salt) !== u.hash) return fail('Pseudo ou mot de passe incorrect', 401);
      else if (ih) { addIp(u, ih); if (banOf(u)) await banIp(ih, u, u.ban.until); await redis.set(key(u.pseudo), u); }
      const token = crypto.randomBytes(24).toString('hex');
      await redis.set('s:' + token, { p: u.pseudo }, { ex: 86400 * 30 });
      return ok({ token });
    }

    let s = b.token && (await redis.get('s:' + b.token));
    if (!s) return fail('Session expirée, reconnecte-toi', 401);
    const cu = await loadCu(), cat = full(cu);
    if (s.op && b.as === 'player' && OP_ID) {
      s = { p: OP_NAME };
      const oldOp = await redis.get(key(OP_ID));
      if (oldOp && key(OP_ID) !== key(OP_NAME) && !(await redis.get(key(OP_NAME)))) {
        await redis.srem('users', oldOp.pseudo); await redis.del(key(OP_ID));
        oldOp.pseudo = OP_NAME; await redis.set(key(OP_NAME), oldOp); await redis.sadd('users', OP_NAME);
      }
      if (!(await redis.get(key(OP_NAME)))) {
        const salt = crypto.randomBytes(16).toString('hex'), nm = OP_NAME;
        await redis.set(key(nm), { pseudo: nm, salt, hash: hash(crypto.randomBytes(8).toString('hex'), salt), coins: 200, packs: 1, bought: {}, last: Date.now(), cards: {}, since: {}, fav: [], notifs: [] });
        await redis.sadd('users', nm);
      }
    }

    if (s.op) {
      if (b.action === 'users') {
        const names = (await redis.smembers('users')).sort();
        const list = names.length ? await redis.mget(...names.map(key)) : [];
        const users = list.filter(Boolean).map((u) => { tick(u); return { pseudo: u.pseudo, bot: u.bot || null, coins: u.coins, packs: u.packs, bought: u.bought || {}, cards: u.cards, bd: u.bd || {}, seen: u.bot ? u.lastAct || 0 : u.seen || 0, banned: !!banOf(u), pf: !!u.pf, push: (u.subs || []).length > 0 }; });
        return ok({ ...(await skinState()), skinc: await skinList(), maint: !!(await redis.get('maint')), maintinfo: (await redis.get('maintinfo')) || { presets: [], msg: '' }, maintPresets: Object.entries(MAINT_PRESETS).map(([k, v]) => ({ k, label: v[0] })), subs: SUBS, users, shop: await shopOf(cat), custom: cu, reports: (await redis.get('reports')) || [], pfpq: await pfpList(), market: (await redis.get('market')) || [], themes: cat });
      }
      if (b.action === 'shop') {
        if (!cat[b.theme] || b.theme === 'obj') return fail('Thème inconnu');
        const cur = (await redis.get('shop')) || {};
        cur[b.theme] = { discount: int(b.discount, 90), blocked: !!b.blocked };
        await redis.set('shop', cur);
        return ok({ done: true });
      }
      if (b.action === 'give') {
        const u = await redis.get(key(String(b.pseudo || '')));
        if (!u) return fail('Joueur introuvable');
        u.fav ||= []; u.since ||= {}; u.notifs ||= [];
        tick(u);
        const sg = b.mode === 'take' ? -1 : 1, c = int(b.coins), p = int(b.packs, 1000), parts = [];
        u.coins = Math.max(0, u.coins + sg * c);
        u.packs = Math.max(0, u.packs + sg * p);
        if (c) parts.push(c + ' coins');
        if (p) parts.push(p + ' sachet' + (p > 1 ? 's' : ''));
        const ids = [].concat(b.cards || (b.card ? [b.card] : [])).map(String), bt = BDM[int(b.badge, 3)] ? int(b.badge, 3) : 0; // bt : 0 = sans badge, 1 Bronze, 2 Argent, 3 Or
        for (const id of ids) {
          if (!rarOf(cat, id)) return fail('Carte inconnue');
          const have = bt ? ((u.bd && u.bd[id] && u.bd[id][bt]) || 0) : Math.max(0, (u.cards[id] || 0) - bdSum(u, id));
          if (sg < 0 && !have) return fail("Ce joueur n'a pas la carte " + id.slice(id.indexOf(':') + 1) + (bt ? ' avec le badge ' + BADGES[bt - 1].name : ' sans badge'));
        }
        for (const id of ids) {
          if (sg > 0) { if (bt) addB(u, id, bt); else add(u, id, 1); } else rmT(u, id, bt);
          parts.push((bt ? BADGES[bt - 1].ico + ' ' : '') + 'la carte ' + id.slice(id.indexOf(':') + 1) + (bt ? ' (badge ' + BADGES[bt - 1].name + ')' : ''));
        }
        if (parts.length) note(u, (sg > 0 ? "🎁 L'opérateur t'a donné : " : "⚠️ L'opérateur t'a retiré : ") + parts.join(', '));
        await redis.set(key(u.pseudo), u);
        return ok({ done: true });
      }
      if (b.action === 'imgup') {
        const d = String(b.img || '');
        if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(d) || d.length > 70000) return fail('Image invalide ou trop lourde : choisis une autre photo');
        const id = crypto.randomBytes(6).toString('hex');
        await redis.set('cimg:' + id, d);
        return ok({ url: '/api/game?img=' + id });
      }
      if (b.action === 'addcol') {
        const name = String(b.name || '').trim().slice(0, 30);
        if (name.length < 2) return fail('Nom trop court');
        const now0 = Date.now(), un0 = Number(b.until);
        if (b.until != null && !(un0 > now0)) return fail('La date de fin doit être dans le futur');
        const endAt = b.until != null ? Math.min(un0, now0 + 366 * DAY) : now0 + Math.max(1, int(b.days, 365) || 7) * DAY;
        const o = { key: 'x' + Date.now(), name, icon: String(b.icon || '').trim().slice(0, 4) || '⭐', color: /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : '#0ea5e9', until: endAt, c: [], r: [], e: [], l: [], m: [], s: [], u: [] };
        // Format : une carte par ligne (préfixe c: r: e: l: m: s: u: facultatif) ; une ligne qui commence par https:// juste en dessous = lien de la photo de cette carte (facultatif)
        let last = null, nb = 0;
        for (const ln0 of String(b.cards || '').split('\n').slice(0, 600)) {
          const ln = ln0.trim(); if (!ln) continue;
          if (/^(https?:\/\/|\/api\/game\?img=)/i.test(ln)) {
            if (!/^(https:\/\/|\/api\/game\?img=)/i.test(ln)) return fail('Le lien de photo doit commencer par https:// : ' + ln.slice(0, 60));
            if (!last) return fail('Un lien de photo doit être juste sous le nom de sa carte : ' + ln.slice(0, 60));
            const p = picOf(ln); if (!p) return fail('Lien de photo invalide pour « ' + last + ' »');
            (o.im ||= {})[last] = p; last = null; continue;
          }
          const m = ln.match(/^([crelmsu]):(.+)$/i), r = m ? m[1].toLowerCase() : 'c', n = (m ? m[2] : ln).trim().slice(0, 60);
          last = n || null;
          if (n && !o[r].includes(n) && nb < 200) { o[r].push(n); nb++; }
        }
        if (!o.c.length) return fail('Mets au moins une carte commune (ligne sans préfixe)');
        cu.cols.push(o);
        await redis.set('custom', cu);
        return ok({ done: true });
      }
      if (b.action === 'extcol') {
        const c = cu.cols.find((x) => x.key === b.key);
        if (!c) return fail('Collection inconnue');
        const un = Number(b.until), now = Date.now();
        if (!(un > now)) return fail('La date de fin doit être dans le futur');
        c.until = Math.min(un, now + 366 * DAY);
        await redis.set('custom', cu);
        return ok({ done: true });
      }
      if (b.action === 'endcol') {
        const c = cu.cols.find((x) => x.key === b.key);
        if (!c) return fail('Collection inconnue');
        c.until = Date.now();
        await redis.set('custom', cu);
        return ok({ done: true });
      }
      if (b.action === 'addobj') {
        const name = String(b.name || '').trim().slice(0, 40), r = R.includes(b.rarity) ? b.rarity : 'c', pr = int(b.price, 1e6);
        if (name.length < 2 || pr < 1) return fail('Nom et prix requis');
        cu.objs = cu.objs.filter((x) => x.name !== name);
        const st = parseInt(b.stock, 10);
        const img = String(b.img || '').trim();
        if (img && !picOf(img)) return fail('Le lien de la photo doit commencer par https:// (ou laisse le champ vide)');
        cu.objs.push({ name, r, price: pr, stock: st > 0 ? Math.min(st, 1e6) : null, ...(img ? { img } : {}) });
        await redis.set('custom', cu);
        await bcast('🛍️ Nouvel objet en boutique : ' + name);
        return ok({ done: true });
      }
      if (b.action === 'delobj') {
        const x = cu.objs.find((o) => o.name === b.name);
        if (!x) return fail('Objet inconnu');
        x.gone = true;
        await redis.set('custom', cu);
        return ok({ done: true });
      }
      if (b.action === 'msg') {
        const text = String(b.text || '').trim().slice(0, 200);
        if (!text) return fail('Message vide');
        const names = b.pseudo === '*' ? await redis.smembers('users') : [String(b.pseudo || '')];
        let n = 0;
        for (const p of names) {
          const u = await redis.get(key(p)); if (!u) continue;
          note(u, '📢 Staff : ' + text); await redis.set(key(u.pseudo), u); n++;
        }
        if (!n) return fail('Joueur introuvable');
        return ok({ done: true, n });
      }
      if (b.action === 'dmlist') {
        const ks = await redis.smembers('dms'), ths = ks.length ? await redis.mget(...ks) : [];
        const list = ks.map((k, i) => { const th = ths[i] || []; const l = th[th.length - 1]; return l && { k, a: k.slice(3).split('|'), n: th.length, t: l.t, x: l.x.slice(0, 80), f: l.f }; }).filter(Boolean).sort((x, y) => y.t - x.t).slice(0, 200);
        const names = [...new Set(list.flatMap((c) => c.a))], us = names.length ? await redis.mget(...names.map((n) => 'u:' + n)) : [], nm = Object.fromEntries(names.map((n, i) => [n, (us[i] && us[i].pseudo) || n]));
        return ok({ convs: list.map((c) => ({ ...c, a: c.a.map((n) => nm[n]) })) });
      }
      if (b.action === 'dmview') {
        const k = String(b.k || ''); if (!k.startsWith('dm:')) return fail('Conversation introuvable');
        return ok({ thread: ((await redis.get(k)) || []).slice(-200) });
      }
      if (b.action === 'codelist') {
        const codes = Object.values((await redis.get('codes')) || {}).sort((x, y) => y.t - x.t);
        return ok({ codes });
      }
      if (b.action === 'codeadd') { // créer un code : récompenses au choix (coins, sachets, cartes, packs de course, abonnement), limite d'utilisations et date d'expiration facultatives
        const codes = (await redis.get('codes')) || {};
        let code = normCode(b.code);
        if (code) { if (!/^[A-Z0-9_-]{3,24}$/.test(code)) return fail('Code : 3 à 24 caractères (lettres, chiffres, - ou _)'); }
        else { do { code = crypto.randomBytes(5).toString('hex').toUpperCase().slice(0, 8); } while (codes[code]); }
        if (codes[code]) return fail('Ce code existe déjà');
        if (Object.keys(codes).length >= 500) return fail('500 codes maximum : supprime les anciens');
        const c = { code, label: String(b.label || '').trim().slice(0, 60), t: Date.now(), coins: int(b.coins, 1e9), packs: int(b.packs, 1000), rx: int(b.rx, 500), bought: {}, cards: {}, sub: null, max: int(b.max, 1e6) || null, exp: null, used: [] };
        for (const [t, n] of Object.entries(b.bought || {})) { if (!cat[t] || t === 'obj') return fail('Collection inconnue : ' + t); const v = int(n, 1000); if (v) c.bought[t] = v; }
        for (const [id, n] of Object.entries(b.cards || {})) { if (!rarOf(cat, id)) return fail('Carte inconnue : ' + id); const v = int(n, 1000); if (v) c.cards[id] = v; }
        if (b.sub && int(b.sub.t, 3)) {
          const T = SUBS.find((x) => x.t === int(b.sub.t, 3)), d = int(b.sub.days, 365);
          if (!T) return fail('Palier inconnu');
          if (d < 1) return fail("Durée de l'abonnement : 1 à 365 jours");
          c.sub = { t: T.t, days: d };
        }
        if (String(b.days ?? '').trim() !== '') { const d = int(b.days, 3650); if (d < 1) return fail("Expiration : au moins 1 jour (ou laisse vide pour « jamais »)"); c.exp = Date.now() + d * DAY; }
        if (!(c.coins || c.packs || c.rx || c.sub || Object.keys(c.bought).length || Object.keys(c.cards).length)) return fail('Choisis au moins une récompense');
        codes[code] = c;
        await redis.set('codes', codes);
        return ok({ done: true, code });
      }
      if (b.action === 'codedel') {
        const codes = (await redis.get('codes')) || {}, code = normCode(b.code);
        if (!codes[code]) return fail('Code introuvable');
        delete codes[code];
        await redis.set('codes', codes);
        return ok({ done: true });
      }
      if (b.action === 'svadd') { // envoyer un questionnaire à tous les joueurs : étoiles de 1 à 5 ou QCM (2 à 8 réponses)
        const q = String(b.q || '').trim().slice(0, 200), type = b.type === 'qcm' ? 'qcm' : 'stars';
        if (q.length < 3) return fail('Écris la question (3 caractères minimum)');
        let opts = [];
        if (type === 'qcm') { opts = (Array.isArray(b.opts) ? b.opts : []).map((x) => String(x || '').trim().slice(0, 60)).filter(Boolean).slice(0, 8); if (opts.length < 2) return fail('QCM : écris au moins 2 réponses (une par ligne)'); }
        const L = await svList(), sv = { id: crypto.randomBytes(5).toString('hex'), q, type, opts, t: Date.now(), open: true };
        L.push(sv);
        while (L.length > 30) await svWipe(L.shift().id);
        await redis.set('surveys', L);
        if (b.notify !== false) await bcast('📋 Le staff te pose une question : ouvre le jeu pour répondre.', OP_NAME);
        return ok({ done: true, id: sv.id });
      }
      if (b.action === 'svlist') { const L = await svList(); return ok({ surveys: await Promise.all(L.slice().reverse().map(svResults)) }); }
      if (b.action === 'svclose') {
        const L = await svList(), x = L.find((y) => y.id === b.id); if (!x) return fail('Questionnaire introuvable');
        x.open = !!b.open; await redis.set('surveys', L); return ok({ done: true });
      }
      if (b.action === 'svdel') {
        const L = await svList(); if (!L.some((y) => y.id === b.id)) return fail('Questionnaire introuvable');
        await redis.set('surveys', L.filter((y) => y.id !== b.id)); await svWipe(b.id); return ok({ done: true });
      }
      if (b.action === 'maint') {
        await redis.set('maint', !!b.on);
        if (b.on) await redis.set('maintinfo', { presets: (Array.isArray(b.presets) ? b.presets : []).filter((k) => MAINT_PRESETS[k]).slice(0, 6), msg: String(b.msg || '').trim().slice(0, 300) });
        else await redis.del('maintinfo');
        return ok({ done: true });
      }
      if (b.action === 'rename') {
        const u = await redis.get(key(String(b.pseudo || ''))), nn = String(b.name || '').trim();
        if (!u) return fail('Joueur introuvable');
        if (u.pseudo.toLowerCase() === OP_NAME.toLowerCase()) return fail("Le pseudo de l'opérateur ne change pas");
        const er = await checkName(nn, u); if (er) return fail(er);
        await renameUser(u, nn, false);
        note(u, '✏️ Le staff a changé ton pseudo : ' + nn);
        await redis.set(key(u.pseudo), u);
        return ok({ done: true });
      }
      if (b.action === 'deluser') {
        const u = await redis.get(key(String(b.pseudo || '')));
        if (!u) return fail('Joueur introuvable');
        await dmDrop(u);
        await redis.set('challenges', ((await redis.get('challenges')) || []).filter((x) => x.from !== u.pseudo));
        await redis.del(key(u.pseudo)); await redis.srem('users', u.pseudo);
        await redis.set('market', ((await redis.get('market')) || []).filter((x) => x.seller !== u.pseudo));
        return ok({ done: true });
      }
      if (b.action === 'giverace') {
        const u = await redis.get(key(String(b.pseudo || '')));
        if (!u) return fail('Joueur introuvable');
        if (!raceView(u)) return fail("Ce compte ne participe pas à la course (bot)");
        const n = int(b.n, 50);
        if (n < 1) return fail('Choisis un nombre de packs entre 1 et 50');
        const take = b.mode === 'take', cur = u.rcX || 0;
        if (take && cur < 1) return fail("Ce joueur n'a aucun pack de course offert à retirer");
        const done = take ? Math.min(n, cur) : n;
        u.rcX = take ? cur - done : Math.min(500, cur + done);
        note(u, take ? '⚠️ Le staff t’a retiré ' + done + ' pack' + (done > 1 ? 's' : '') + ' de course' : '🎁 Le staff t’a offert ' + done + ' pack' + (done > 1 ? 's' : '') + ' de course : tu peux les ouvrir dans Social › Course');
        await redis.set(key(u.pseudo), u);
        return ok({ done: true, rx: u.rcX });
      }
      if (b.action === 'skin') {
        const k = String(b.skin || '');
        if (k && !SKINS.includes(k) && !(await skinList()).some((x) => x.id === k)) return fail('Thème inconnu');
        if (k) await redis.set('skin', k); else await redis.del('skin');
        return ok({ done: true, skin: k || null });
      }
      if (b.action === 'skinsave') {
        const name = String(b.name || '').trim().slice(0, 24), emoji = String(b.emoji || '').replace(/["'\\<>&]/g, '').trim().slice(0, 8), ac = String(b.ac || '');
        if (!name) return fail('Donne un nom au thème');
        if (!/^#[0-9a-fA-F]{6}$/.test(ac)) return fail('Couleur invalide');
        const list = await skinList(), id = String(b.id || '');
        const i = id ? list.findIndex((x) => x.id === id) : -1;
        if (id && i < 0) return fail('Thème introuvable');
        if (i < 0 && list.length >= SKC_MAX) return fail('Maximum ' + SKC_MAX + ' thèmes personnalisés : supprime-en un');
        const d = { id: i < 0 ? 'c' + Date.now().toString(36) : id, name, emoji, ac: ac.toLowerCase() };
        if (i < 0) list.push(d); else list[i] = d;
        await redis.set('skinc', list);
        return ok({ done: true, skinc: list, id: d.id });
      }
      if (b.action === 'skindel') {
        const id = String(b.id || ''), list = await skinList();
        if (!list.some((x) => x.id === id)) return fail('Thème introuvable');
        const nl = list.filter((x) => x.id !== id);
        if (nl.length) await redis.set('skinc', nl); else await redis.del('skinc');
        if ((await redis.get('skin')) === id) await redis.del('skin'); // le thème actif est supprimé : retour au thème normal
        return ok({ done: true, skinc: nl });
      }
      if (b.action === 'pinfo') {
        const u = await redis.get(key(String(b.pseudo || '')));
        if (!u) return fail('Joueur introuvable');
        tick(u);
        const nms = await redis.smembers('users'), all = nms.length ? await redis.mget(...nms.map(key)) : [];
        const same = (u.ips || []).length ? all.filter((x) => x && x.pseudo !== u.pseudo && (x.ips || []).some((h) => u.ips.includes(h))).map((x) => x.pseudo) : [];
        return ok({ p: { seen: u.bot ? u.lastAct || 0 : u.seen || 0, ban: banOf(u), same, pseudo: u.pseudo, bot: u.bot || null, coins: u.coins, packs: u.packs, bought: u.bought || {}, cards: u.cards || {}, rb: u.rb || {}, rl: rlInfo(u).left, dl: { left: dlInfo(u).left, max: dlInfo(u).max }, mg: mgInfo(u), renames: u.renames || 0, race: !!raceView(u), rx: u.rcX || 0, push: (u.subs || []).length > 0, sub: subOf(u) ? { t: u.sub.t, name: subOf(u).name, ico: subOf(u).ico, until: u.sub.until, trial: !!u.sub.trial, col: u.subCol || null } : null, subTrial: !!u.subTrial }, max: { rl: RL_MAX, mg: MG_MAX, subs: SUBS } });
      }
      if (b.action === 'subset') { // offrir (ou prolonger) un abonnement, ou le retirer (tier = 0)
        const u = await redis.get(key(String(b.pseudo || '')));
        if (!u) return fail('Joueur introuvable');
        if (u.bot) return fail("Les bots n'ont pas d'abonnement");
        subCheck(u);
        const tier = int(b.tier, 3);
        if (!tier) {
          if (!u.sub) return fail("Ce joueur n'a pas d'abonnement");
          delete u.sub; delete u.subCol;
          note(u, "⚠️ Le staff a retiré ton abonnement : le bonus de chances et ta couleur de fond d'abonné sont retirés");
        } else {
          const T = SUBS.find((x) => x.t === tier), d = int(b.days, 365);
          if (!T) return fail('Palier inconnu');
          if (d < 1) return fail('Choisis une durée de 1 à 365 jours');
          const cur = subOf(u);
          u.sub = { t: T.t, until: (cur && cur.t === T.t ? u.sub.until : Date.now()) + d * DAY };
          note(u, "🎁 Le staff t'offre l'abonnement " + T.name + ' : ' + d + ' jour' + (d > 1 ? 's' : ''));
        }
        await redis.set(key(u.pseudo), u);
        return ok({ done: true });
      }
      if (b.action === 'pset') {
        const u = await redis.get(key(String(b.pseudo || '')));
        if (!u) return fail('Joueur introuvable');
        u.bought ||= {}; u.since ||= {}; u.fav ||= []; u.notifs ||= []; u.cards ||= {}; u.rb ||= {};
        tick(u);
        const P = b.set || {};
        if (P.coins != null) u.coins = int(P.coins, 1e9);
        if (P.packs != null) { const n = int(P.packs, 1000); if (n !== u.packs) { u.packs = n; u.last = Date.now(); } }
        for (const [t, n] of Object.entries(P.bought || {})) { if (!cat[t] || t === 'obj') continue; const v = int(n, 1000); if (v) u.bought[t] = v; else delete u.bought[t]; }
        for (const [t, n] of Object.entries(P.rb || {})) { if (!cat[t] || t === 'obj') continue; const v = int(n, 100); if (v) u.rb[t] = v; else delete u.rb[t]; }
        if (P.dlMax != null) u.dlMax = int(P.dlMax, 1000);
        if (P.rl != null) u.rl = { d: parisDay(), n: RL_MAX - Math.min(RL_MAX, int(P.rl, RL_MAX)), t: 0 };
        if (P.mg) {
          if (!u.mg || u.mg.d !== parisDay()) u.mg = { d: parisDay() };
          for (const k of Object.keys(MG_MAX)) if (P.mg[k] != null) u.mg[k] = MG_MAX[k] - Math.min(MG_MAX[k], int(P.mg[k], MG_MAX[k]));
        }
        for (const [id, n] of Object.entries(P.cards || {})) {
          if (!rarOf(cat, id)) return fail('Carte inconnue : ' + id);
          const want = int(n, 10000), cur = u.cards[id] || 0;
          if (want > cur) add(u, id, want - cur); else if (want < cur) rm(u, id, cur - want);
        }
        note(u, '⚙️ Le staff a mis à jour ton compte');
        await redis.set(key(u.pseudo), u);
        return ok({ done: true });
      }
      if (b.action === 'ban') {
        const u = await redis.get(key(String(b.pseudo || '')));
        if (!u) return fail('Joueur introuvable');
        if (u.bot) return fail('Un bot ne se bannit pas');
        if (u.pseudo === OP_NAME) return fail("L'opérateur ne se bannit pas");
        const secs = b.perm ? null : int(b.days, 3650) * 86400 + int(b.hours, 1e5) * 3600 + int(b.minutes, 1e6) * 60 + int(b.seconds, 1e8);
        if (secs !== null && secs < 1) return fail('Choisis une durée ou « Définitif »');
        const until = secs === null ? null : Date.now() + secs * 1000;
        u.ban = { until, reason: String(b.reason || '').trim().slice(0, 300), t: Date.now() };
        for (const h of u.ips || []) await banIp(h, u, until);
        { // ses défis en attente sont annulés et remboursés
          const L = (await redis.get('challenges')) || [], mine = L.filter((x) => x.from === u.pseudo);
          if (mine.length) { await redis.set('challenges', L.filter((x) => x.from !== u.pseudo)); mine.forEach((x) => refundCh(u, x, '↩️ Ton défi en attente a été annulé : mise et cartes rendues')); }
        }
        note(u, '⛔ Ton compte a été banni' + (u.ban.reason ? ' : ' + u.ban.reason : ''));
        await redis.set(key(u.pseudo), u);
        return ok({ done: true });
      }
      if (b.action === 'pwreset') { // mot de passe perdu : l'opérateur en donne un nouveau au joueur
        const u = await redis.get(key(String(b.pseudo || '')));
        if (!u) return fail('Joueur introuvable');
        if (u.bot) return fail('Les bots n’ont pas de mot de passe');
        const pw = String(b.password || '');
        if (pw.length < 8) return fail('Mot de passe trop court (8 caractères minimum)');
        if (pw.length > 64) return fail('Mot de passe trop long (64 caractères maximum)');
        u.salt = crypto.randomBytes(16).toString('hex'); u.hash = hash(pw, u.salt);
        await redis.set(key(u.pseudo), u);
        return ok({ done: true });
      }
      if (b.action === 'unban') {
        const u = await redis.get(key(String(b.pseudo || '')));
        if (!u) return fail('Joueur introuvable');
        delete u.ban;
        for (const h of u.ips || []) { const bi = await redis.get('banip:' + h); if (bi && bi.pseudo === u.pseudo) await redis.del('banip:' + h); }
        note(u, '✅ Ton bannissement a été levé : bon retour !');
        await redis.set(key(u.pseudo), u);
        return ok({ done: true });
      }
      if (b.action === 'cardinfo') {
        const id = String(b.id || ''), r = rarOf(cat, id);
        if (!r) return fail('Carte inconnue');
        const names = await redis.smembers('users'), list = names.length ? await redis.mget(...names.map(key)) : [], mk0 = (await redis.get('market')) || [];
        let hand = 0, owners = 0, bots = 0;
        for (const v of list) { const n = v && v.cards && v.cards[id]; if (n) { hand += n; owners++; if (v.bot) bots++; } }
        const sale = mk0.filter((x) => x.card === id && !x.want).length, trade = mk0.filter((x) => x.card === id && x.want).length, def = defBase(id, r, cu), set = (cu.vals || {})[id];
        return ok({ card: { id, name: cn(id), col: (cat[id.slice(0, id.indexOf(':'))] || {}).name || '?', r, def, cur: set || def, custom: !!set, st: statsOf(id, cat, cu), sd: statsOf(id, cat, cu, true), hand, sale, trade, total: hand + sale + trade, owners, bots } });
      }
      if (b.action === 'cardstat') {
        const id = String(b.id || '');
        if (!rarOf(cat, id)) return fail('Carte inconnue');
        const hp = int(b.hp, 100000), atk = int(b.atk, 100000); cu.stats ||= {};
        if (hp > 0 && atk > 0) cu.stats[id] = { hp, atk }; else delete cu.stats[id];
        await redis.set('custom', cu);
        return ok({ done: true });
      }
      if (b.action === 'cardset') {
        const id = String(b.id || '');
        if (!rarOf(cat, id)) return fail('Carte inconnue');
        const v = int(b.value, 1e6); cu.vals ||= {};
        if (v > 0) cu.vals[id] = v; else delete cu.vals[id];
        await redis.set('custom', cu);
        return ok({ done: true });
      }
      if (b.action === 'mkret' || b.action === 'mkretall') { // rendre une annonce (ou toutes les annonces anciennes) à son vendeur
        const mk0 = (await redis.get('market')) || [], now = Date.now(), days = Math.max(0, +b.days || 0);
        const hit = mk0.filter((x) => (b.action === 'mkret' ? x.id === b.id : !days || now - x.t >= days * DAY));
        if (!hit.length) return fail(b.action === 'mkret' ? 'Annonce introuvable' : 'Aucune annonce à rendre');
        const cache = {}, got = {};
        for (const x of hit) {
          if (x.staff) continue; // annonce du staff : rien à rendre à personne
          const v = cache[x.seller] || (cache[x.seller] = await redis.get(key(x.seller)));
          if (!v) continue;
          v.fav ||= []; v.since ||= {}; v.cards ||= {};
          add(v, x.card, 1); (got[x.seller] ||= []).push(cn(x.card));
        }
        for (const [p, names] of Object.entries(got)) { note(cache[p], '↩️ Le staff t\'a rendu ' + names.length + ' carte' + (names.length > 1 ? 's' : '') + ' du Marché : ' + [...new Set(names)].slice(0, 5).join(', ') + (names.length > 5 ? '…' : '')); await redis.set(key(p), cache[p]); }
        await redis.set('market', mk0.filter((x) => !hit.includes(x)));
        return ok({ done: true, n: hit.length });
      }
      if (b.action === 'mkprice') {
        const mk0 = (await redis.get('market')) || [], x = mk0.find((y) => y.id === b.id && !y.want), pr = int(b.price, 1e6);
        if (!x) return fail("Annonce introuvable (ou c'est une offre d'échange)");
        if (pr < 1) return fail('Prix invalide');
        x.price = pr; await redis.set('market', mk0);
        return ok({ done: true });
      }
      if (b.action === 'mkadd') { // le staff met lui-même des cartes en vente
        const id = String(b.card || ''), pr = int(b.price, 1e6), q = Math.max(1, Math.min(20, int(b.qty, 20) || 1)), bt = BDM[int(b.badge, 3)] ? int(b.badge, 3) : 0;
        if (!rarOf(cat, id)) return fail('Carte inconnue');
        if (pr < 1) return fail('Prix invalide');
        const mk0 = (await redis.get('market')) || [];
        for (let i = 0; i < q; i++) mk0.push({ id: crypto.randomBytes(6).toString('hex'), seller: OP_NAME, card: id, price: pr, t: Date.now(), staff: true, ...(bt ? { bd: bt } : {}) });
        await redis.set('market', mk0);
        if (b.notify) await bcast('🏷️ Nouvelle carte au Marché : ' + (bt ? BADGES[bt - 1].ico + ' ' : '') + cn(id) + ' (' + pr + ' 🪙)', OP_NAME);
        return ok({ done: true });
      }
      if (b.action === 'pfpok' || b.action === 'pfpno' || b.action === 'pfpdel') {
        const u = await redis.get(key(String(b.pseudo || '')));
        if (!u) return fail('Joueur introuvable');
        if (b.action === 'pfpdel') { if (!u.pf) return fail("Ce joueur n'a pas de photo"); delete u.pf; note(u, '🖼️ Le staff a retiré ta photo de profil'); }
        else {
          if (!u.pfpReq) return fail('Aucune demande en attente pour ce joueur');
          if (b.action === 'pfpok') { u.pf = u.pfpReq.img; u.pfpN = (u.pfpN || 0) + 1; note(u, '✅ Ta nouvelle photo de profil a été validée'); }
          else note(u, '❌ Ta demande de changement de photo de profil a été refusée');
          delete u.pfpReq;
          await redis.set('pfpq', ((await redis.get('pfpq')) || []).filter((x) => x !== u.pseudo));
        }
        await redis.set(key(u.pseudo), u);
        return ok({ done: true });
      }
      if (b.action === 'delreport') {
        await redis.set('reports', ((await redis.get('reports')) || []).filter((x) => x.id !== b.id));
        return ok({ done: true });
      }
      return fail('Action inconnue');
    }

    await expireCh().catch((e) => console.error('expireCh', e.message));
    const u = await redis.get(key(s.p));
    if (!u) return fail('Session expirée, reconnecte-toi', 401);
    u.bought ||= {}; u.since ||= {}; u.fav ||= []; u.notifs ||= []; u.inbox ||= [];
    tick(u); slEnsure(u, cat);
    u.seen = Date.now();
    raceNote(u);
    subCheck(u);
    if (u.ban && u.ban.until != null && u.ban.until <= Date.now()) { delete u.ban; note(u, '✅ Ton bannissement est terminé : bon retour !'); }
    const banned = !!banOf(u);
    if (banned && !['me', 'report', 'settings', 'delnote'].includes(b.action)) return fail('⛔ Compte banni : seuls les Réglages sont accessibles');
    const maintOn = !!(await redis.get('maint')) && u.pseudo !== OP_NAME;
    if (maintOn && !['me', 'report', 'settings', 'rank', 'chrank'].includes(b.action)) return fail('🔧 Maintenance : une mise à jour arrive bientôt');
    const shAll = await shopOf(cat), sh = visShop(u, shAll, cat);
    let mk = (await redis.get('market')) || [];
    let extra = {};
    const pack = () => {
      const s = sh[b.theme] || (u.bought[b.theme] > 0 && shAll[b.theme]);
      { const oo = cat[b.theme]; if (oo && oo.until != null && !oo.base && ((u.rb || {})[b.theme] || 0) >= 1) return 'Cette collection provisoire a déjà fait sa renaissance : plus de sachets pour toi'; }
      if (!s) return 'Ce sachet n\'existe pas ou n\'est plus disponible';
      if (s.blocked) return 'Ce sachet est bloqué pour le moment';
    };

    if (b.action === 'buy') {
      const e = pack(); if (e) return fail(e);
      if (sh[b.theme].nobuy) return fail("Ce sachet n'est plus en vente : passe au niveau supérieur");
      const p = price(sh[b.theme], b.theme, cat);
      if (u.coins < p) return fail('Pas assez de coins');
      u.coins -= p;
      u.bought[b.theme] = (u.bought[b.theme] || 0) + 1;
    } else if (b.action === 'open') {
      const e = pack(); if (e) return fail(e);
      const LV0 = lvOf(cat, b.theme), have = (u.bought[b.theme] || 0) + freeOf(u, cat, b.theme);
      if (have < 1) return fail('Aucun sachet disponible');
      const n = Math.min(have, OPEN_MAX, b.all ? OPEN_MAX : Math.max(1, int(b.n, OPEN_MAX) || 1)); // plusieurs sachets de la même collection d'un coup
      for (let i = 0; i < n; i++) { if (u.bought[b.theme] > 0) u.bought[b.theme] -= 1; else freeTake(u, cat, b.theme, 1); }
      const py = pity(u, cat[b.theme], b.theme), drawn = Array.from({ length: PACK * n }, () => draw(cat[b.theme], b.theme, LV0, subMult(u), py));
      const bad = drawn.map(() => rollBadge()); // 0 = aucun badge, 1 = Bronze, 2 = Argent, 3 = Or
      drawn.forEach((id, i) => (bad[i] ? addB(u, id, bad[i]) : add(u, id, 1)));
      extra = { drawn, bad, n };
    } else if (b.action === 'buyobj') {
      const x = cu.objs.find((o) => !o.gone && 'obj:' + o.name === b.id);
      if (!x) return fail('Objet indisponible');
      if (x.stock != null && x.stock <= 0) return fail('Objet épuisé');
      if (u.coins < x.price) return fail('Pas assez de coins');
      u.coins -= x.price; add(u, b.id, 1);
      if (x.stock != null) { x.stock -= 1; await redis.set('custom', cu); }
    } else if (b.action === 'subbuy') {
      const T = SUBS.find((x) => x.t === int(b.tier, 3));
      if (!T) return fail('Palier inconnu');
      const d = int(b.days, SUB_MAX);
      if (d < 1) return fail('Choisis une durée de 1 à ' + SUB_MAX + ' jours');
      const cost = T.price * d;
      if (u.coins < cost) return fail('Pas assez de coins : il faut ' + cost + ' 🪙 pour ' + d + ' jour' + (d > 1 ? 's' : '') + ' de ' + T.name);
      const cur = subOf(u);
      u.coins -= cost;
      u.sub = { t: T.t, until: (cur && cur.t === T.t ? u.sub.until : Date.now()) + d * DAY }; // même palier = prolongation ; autre palier = remplace l'ancien tout de suite, sans remboursement
    } else if (b.action === 'subcolor') { // couleur de fond choisie par le joueur abonné (vide = couleur par défaut)
      if (!subOf(u)) return fail('Réservé aux abonnés');
      const c = String(b.color || '').trim().toLowerCase();
      if (!c) delete u.subCol;
      else if (/^#[0-9a-f]{6}$/.test(c)) u.subCol = c;
      else return fail('Couleur invalide');
    } else if (b.action === 'subtrial') {
      if (u.subTrial) return fail('Tu as déjà utilisé ton jour gratuit');
      if (subOf(u)) return fail('Tu as déjà un abonnement en cours');
      u.subTrial = true;
      u.sub = { t: 1, until: Date.now() + DAY, trial: true };
    } else if (b.action === 'sell') {
      let list;
      if (b.mode === 'dupes') list = Object.entries(u.cards).filter(([id, n]) => n > 1 && !u.fav.includes(id) && (!b.theme || id.startsWith(b.theme + ':'))).map(([id, n]) => [id, n - 1]);
      else if (b.mode === 'all') { // collection terminée : tout part, même le 1er exemplaire ; seules les favorites restent (livret Favoris)
        const oc = cat[b.theme];
        if (!oc || b.theme === 'obj') return fail('Collection inconnue');
        if (!(oc.until != null && !oc.base && oc.until <= Date.now())) return fail('« Tout vendre » est réservé aux collections terminées');
        list = Object.entries(u.cards).filter(([id]) => id.startsWith(b.theme + ':') && !u.fav.includes(id)).map(([id, n]) => [id, n]);
      } else if (b.mode === 'list') { // doublons choisis : on garde toujours 1 exemplaire, jamais de favori
        const o = b.cards && typeof b.cards === 'object' ? b.cards : {};
        list = Object.entries(o).filter(([id]) => !u.fav.includes(id)).map(([id, n]) => [id, Math.max(0, Math.min(int(n, 50), (u.cards[id] || 0) - 1))]);
      } else list = [[String(b.card), 1]];
      let gain = 0, cnt = 0;
      for (const [id, n] of list) {
        const k = Math.min(n, u.cards[id] || 0); if (k < 1) continue;
        gain += sellValue(u, id, k, val(u, id, cat, cu)); cnt += k; rm(u, id, k);
      }
      if (!cnt) return fail('Rien à vendre (les favoris ⭐' + (b.mode === 'dupes' ? ' et le 1er exemplaire' : '') + ' sont gardés)');
      u.coins += gain; extra = { gain, cnt };
    } else if (b.action === 'sellbd') { // livrets de badges : vendre une carte badgée (ou tout le livret si aucune carte n'est donnée) ; seules celles dont tu as aussi l'exemplaire sans badge sont dans les livrets
      const tier = int(b.tier, 3);
      if (!BDM[tier]) return fail('Badge inconnu');
      const ids = b.card ? [String(b.card)] : Object.keys(u.bd || {});
      let gain = 0, cnt = 0;
      for (const id of ids) {
        const bb = u.bd && u.bd[id];
        if (!bb || !bb[tier] || !rarOf(cat, id) || (u.cards[id] || 0) - bdSum(u, id) < 1) continue;
        const n = b.card && !b.all ? 1 : bb[tier], one = Math.round(val(u, id, cat, cu) * BDM[tier]);
        bb[tier] -= n; if (!bb[tier]) delete bb[tier]; if (!bdSum(u, id)) delete u.bd[id];
        u.cards[id] -= n; gain += one * n; cnt += n;
      }
      if (!cnt) return fail('Rien à vendre : une carte badgée sans exemplaire normal tient la place de ta collection');
      u.coins += gain; extra = { gain, cnt };
    } else if (b.action === 'fav') {
      if (!u.cards[b.card]) return fail('Carte non possédée');
      u.fav = u.fav.includes(b.card) ? u.fav.filter((x) => x !== b.card) : [...u.fav, b.card];
    } else if (b.action === 'report') {
      const text = String(b.text || '').trim().slice(0, 500);
      if (text.length < 5) return fail('Décris le problème (5 caractères minimum)');
      const idea = b.cat === 'idea', r = (await redis.get('reports')) || [];
      r.unshift({ id: Date.now(), pseudo: u.pseudo, cat: idea ? 'idea' : 'bug', text: (idea ? '💡 [Idée] ' : '') + (banned ? '⛔ [Banni] ' : '') + (maintOn ? '🔧 [Maintenance] ' : '') + text, t: Date.now() });
      await redis.set('reports', r.slice(0, 100));
      await opNote((idea ? '💡 [Idée] ' : '🚩 ') + (banned ? '[Banni] ' : '') + u.pseudo + ' au staff : ' + (text.length > 140 ? text.slice(0, 140) + '…' : text), u);
      return ok({ done: true });
    } else if (b.action === 'settings') {
      if (b.theme) u.theme = b.theme === 'light' ? 'light' : 'dark';
      if (b.pw) {
        if (hash(String(b.old || ''), u.salt) !== u.hash) return fail('Ancien mot de passe incorrect');
        if (String(b.pw).length < 4) return fail('Nouveau mot de passe trop court (4 minimum)');
        u.salt = crypto.randomBytes(16).toString('hex'); u.hash = hash(String(b.pw), u.salt);
      }
    } else if (b.action === 'bet') {
      const a = int(b.amount, 500);
      if (!['snake', 'tetris'].includes(b.game)) return fail('Jeu inconnu');
      if (a < 10) return fail('Mise minimale : 10 coins (maximale : 500)');
      if (u.coins < a) return fail('Pas assez de coins');
      u.coins -= a;
      const gid = crypto.randomBytes(12).toString('hex');
      await redis.set('g:' + gid, { p: u.pseudo, game: b.game, bet: a, t: Date.now() }, { ex: 3600 });
      extra = { gid };
    } else if (b.action === 'roulette') {
      const a = int(b.amount, 500), k = b.kind, v = int(b.value, 36), n = crypto.randomInt(37);
      const RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36], red = RED.includes(n);
      if (a < 10) return fail('Mise minimale : 10 coins (maximale : 500)');
      if (u.coins < a) return fail('Pas assez de coins');
      const ri = rlInfo(u);
      if (ri.left <= 0) return fail('Limite atteinte : 10 tours de roulette par jour. Reviens demain !');
      if (Date.now() < ri.next) return fail('Patiente ' + Math.ceil((ri.next - Date.now()) / 1000) + ' s avant le prochain tour');
      let win, mult;
      if (k === 'red') { win = red; mult = 2.5; } else if (k === 'black') { win = n > 0 && !red; mult = 2.5; }
      else if (k === 'even') { win = n > 0 && n % 2 === 0; mult = 2.5; } else if (k === 'odd') { win = n % 2 === 1; mult = 2.5; }
      else if (k === 'dozen' && v <= 2) { win = n > 0 && Math.floor((n - 1) / 12) === v; mult = 3.7; }
      else if (k === 'num') { win = n === v; mult = 43; } else return fail('Pari inconnu');
      const gain = win ? Math.floor(a * mult) : 0;
      u.coins += gain - a; u.rl = { d: parisDay(), n: (RL_MAX - ri.left) + 1, t: Date.now() };
      extra = { n, red, win, gain, bet: a };
    } else if (b.action === 'slots') {
      const a = int(b.amount, 500);
      if (a < 10) return fail('Mise minimale : 10 coins (maximale : 500)');
      if (u.coins < a) return fail('Pas assez de coins');
      const e = mgUse(u, 'slots'); if (e) return fail(e);
      const reels = Array.from({ length: 5 }, () => { let x = crypto.randomInt(100); for (let i = 0; i < SL.length; i++) if ((x -= SL[i][1]) < 0) return i; return 0; });
      const cnt = SL.map((_, i) => reels.filter((r) => r === i).length), m = Math.max(...cnt), k = cnt.indexOf(m);
      const gain = m >= 3 ? Math.floor(a * SL[k][2][m - 3]) : 0;
      u.coins += gain - a; extra = { reels: reels.map((i) => SL[i][0]), gain, bet: a, win: gain > 0, m, sym: SL[k][0] };
    } else if (b.action === 'flip') {
      const st = b.step, d = u.dn, flip = () => crypto.randomInt(100) < FLIP_P;
      if (st === 'start') {
        const a = int(b.amount, 500);
        if (d) return fail('Une partie est déjà en cours : encaisse ou double d’abord');
        if (a < 10) return fail('Mise minimale : 10 coins (maximale : 500)');
        if (u.coins < a) return fail('Pas assez de coins');
        const e = mgUse(u, 'flip'); if (e) return fail(e);
        u.coins -= a; const win = flip();
        if (win) u.dn = { bet: a, n: 1 };
        extra = { win, side: win === (b.pick === 'pile') ? 'pile' : 'face', bet: a };
      } else if (st === 'double') {
        if (!d) return fail('Aucune partie en cours');
        const win = flip(); if (win) d.n += 1; else u.dn = null;
        extra = { win, side: win ? 'pile' : 'face', bet: d.bet };
      } else if (st === 'cash') {
        if (!d) return fail('Aucune partie en cours');
        extra = { gain: d.bet * 2 ** d.n, cashed: true }; u.coins += extra.gain; u.dn = null;
      } else return fail('Action inconnue');
      if (u.dn && u.dn.n >= FLIP_MAX) { extra.gain = u.dn.bet * 2 ** u.dn.n; extra.cashed = true; u.coins += extra.gain; u.dn = null; }
    } else if (b.action === 'scratch') {
      if (u.coins < TICKET) return fail('Pas assez de coins (ticket : ' + TICKET + ')');
      const e = mgUse(u, 'scratch'); if (e) return fail(e);
      let x = crypto.randomInt(10000), mult = 0; for (const [w, m] of TK) { if ((x -= w) < 0) { mult = m; break; } }
      const V = [1, 2, 4, 10, 50, 100].map((m) => m * TICKET), prize = mult * TICKET;
      const pool = shuf(V.filter((v) => v !== prize).flatMap((v) => [v, v]));
      const cases = mult ? shuf([prize, prize, prize, ...pool.slice(0, 3)]) : pool.slice(0, 6);
      u.coins += prize - TICKET; extra = { cases, gain: prize, win: prize > 0, price: TICKET };
    } else if (b.action === 'battle') {
      const a = int(b.amount, 500);
      if (a < 10) return fail('Mise minimale : 10 coins (maximale : 500)');
      if (u.coins < a) return fail('Pas assez de coins');
      const e = mgUse(u, 'battle'); if (e) return fail(e);
      const pick = () => { const t = LINES[crypto.randomInt(LINES.length)]; return draw(cat[t], t, 1); };
      const rk = (id) => R.indexOf(rarOf(cat, id)), rounds = []; let res = 0;
      for (let i = 0; i < 5 && !res; i++) { const p = pick(), o = pick(); rounds.push([p, o]); res = Math.sign(rk(p) - rk(o)); }
      const gain = res > 0 ? Math.floor(a * BATTLE_X) : res < 0 ? 0 : a;
      u.coins += gain - a; extra = { rounds, res, gain, bet: a };
    } else if (b.action === 'betend') {
      const g = await redis.get('g:' + b.gid);
      if (!g || g.p !== u.pseudo) return fail('Partie introuvable');
      await redis.del('g:' + b.gid);
      const el = (Date.now() - g.t) / 1000, sn = g.game === 'snake';
      const sc = Math.min(int(b.score, 10000), sn ? Math.floor(el / 0.8) : Math.floor(el / 2.5));
      const m = sn ? Math.min(4, Math.max(0, (sc - 5) / 10)) : Math.min(4, Math.max(0, (sc - 3) / 6));
      const gain = Math.floor(g.bet * m);
      u.coins += gain; extra = { gain, score: sc };
    } else if (b.action === 'racepack') {
      const v = raceView(u);
      if (!v) return fail('La course est réservée aux joueurs');
      if (!v.ready) return fail('Ton prochain pack de course arrive dans ' + Math.ceil((v.next - Date.now()) / 6e4) + ' min');
      const x = crypto.randomInt(100), gain = x < 55 ? 1 : x < 85 ? 2 : x < 97 ? 5 : 10, to = v.pos + gain, now = Date.now();
      if (u.rc && u.rc.w !== v.w) u.rcPrev = u.rc; // on garde le score de la semaine précédente pour désigner le vainqueur
      u.rc = { w: v.w, pos: to, tt: now }; if ((u.rcX || 0) > 0) u.rcX--; else u.rcT = now; // les packs offerts partent en premier : le compte à rebours du pack gratuit ne bouge pas
      extra = { gain, from: v.pos, to, rar: { 1: 'c', 2: 'r', 5: 'e', 10: 'l' }[gain] };
    } else if (b.action === 'carcolor') {
      const c = String(b.color || '').toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(c)) return fail('Couleur invalide');
      if (u.car === c) return fail('Ta voiture a déjà cette couleur');
      if (u.coins < CAR_COST) return fail('Pas assez de coins : ' + CAR_COST + ' 🪙 pour repeindre ta voiture');
      u.coins -= CAR_COST; u.car = c;
    } else if (b.action === 'racelb') {
      const names = await redis.smembers('users'), list = names.length ? await redis.mget(...names.map(key)) : [];
      const all = raceBoard(list, raceWeek()).map(({ bot: _b, ...x }) => x), last = (await redis.get('race:last')) || null;
      const n = [5, 10].includes(+b.n) ? +b.n : 200, rows = all.slice(0, n), me = all.find((x) => x.pseudo === u.pseudo);
      if (me && !rows.includes(me)) rows.push(me);
      extra = { race: { rows: rows.map((x, i) => (i < 10 || x === me ? x : { ...x, pf: null })), total: all.length, end: raceEnd(), name: RACE ? RACE.name : null, kind: RACE ? RACE.kind : 'normal', last: last && last.winner ? { pseudo: last.winner.pseudo, pos: last.winner.pos, name: last.name } : null } };
    } else if (b.action === 'wheelspin') {
      const w = (u.rw || [])[0];
      if (!w) return fail('Aucune roue à tourner');
      u.rw.shift(); extra = { ...wheelSpin(u, w, cat), rank: w.rank };
    } else if (b.action === 'carskin') {
      const k = String(b.skin || '');
      if (k && !SKINS_CAR[k]) return fail('Skin inconnu');
      if (k && (!subOf(u) || subOf(u).t < SKINS_CAR[k])) return fail('Réservé aux abonnés du palier requis');
      u.carSk = k || null;
    } else if (b.action === 'pfp') {
      if (u.pseudo === OP_NAME) return fail("L'opérateur n'a pas de photo de profil");
      const img = String(b.img || '');
      if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(img) || img.length > 24000) return fail('Image invalide ou trop lourde : choisis une autre photo');
      const n = u.pfpN || 0;
      if (n >= 2) { // 3e changement et suivants : l'opérateur vérifie avant d'afficher
        if (u.pfpReq) return fail('Une demande est déjà en attente de vérification');
        u.pfpReq = { img, t: Date.now() };
        const q = (await redis.get('pfpq')) || []; if (!q.includes(u.pseudo)) { q.push(u.pseudo); await redis.set('pfpq', q); }
        await opNote('🖼️ ' + u.pseudo + ' demande à changer sa photo de profil : à vérifier dans Opérateur → Joueurs → Photos de profil');
        extra = { pending: true };
      } else {
        if (n === 1) { if (u.coins < PFP_COST) return fail('Pas assez de coins : ' + PFP_COST + ' 🪙 pour ce changement'); u.coins -= PFP_COST; }
        u.pf = img; u.pfpN = n + 1; extra = { applied: true };
      }
    } else if (b.action === 'daily') {
      const d = dyInfo(u);
      if (!d) return fail('Pas de récompense quotidienne pour ce compte');
      if (d.claimed) return fail('Récompense du jour déjà récupérée : reviens demain');
      const gain = DAILY[d.day - 1]; u.coins += gain; u.ds = { d: parisDay(), n: d.day };
      extra = { gain, day: d.day };
    } else if (b.action === 'rename') {
      const nn = String(b.name || '').trim();
      if (u.pseudo.toLowerCase() === OP_NAME.toLowerCase()) return fail("Le pseudo de l'opérateur ne change pas");
      if ((u.renames || 0) >= 1) return fail('Ton changement gratuit est déjà utilisé : demande au staff (Réglages → Contacter un staff)');
      const er = await checkName(nn, u); if (er) return fail(er);
      await renameUser(u, nn, true);
      await redis.set('s:' + b.token, { p: nn }, { ex: 86400 * 30 });
      mk = (await redis.get('market')) || [];
    } else if (b.action === 'rebirth') {
      const t = String(b.t || ''), r = rebirthDo(u, t, cat, cu);
      if (typeof r === 'string') return fail(r);
      extra = r;
    } else if (b.action === 'rank') {
      const names = await redis.smembers('users'), list = names.length ? await redis.mget(...names.map(key)) : [];
      extra = { rank: list.filter(Boolean).map((v) => {
        const n = { l: 0, e: 0, r: 0, c: 0 };
        for (const [id, q] of Object.entries(v.cards || {})) { const r = rarOf(cat, id); if (n[r] != null && !id.startsWith('obj:')) n[r] += r === 'l' ? q : 1; } // légendaires : chaque exemplaire compte (2 fois la même = 2 légendaires)
        return { pseudo: v.pseudo, ...n, rb: Object.values(v.rb || {}).reduce((a, x) => a + x, 0), coins: v.coins, pf: v.pf || null };
      }).sort((a, b) => b.rb - a.rb || b.l - a.l || b.e - a.e || b.r - a.r || b.c - a.c || b.coins - a.coins).slice(0, [5, 10].includes(+b.n) ? +b.n : 10000).map((x, i) => (i < 10 ? x : { ...x, pf: null })) };
    } else if (b.action === 'chrank') { // classement des défis : ouvert à tous, même vide
      const names = await redis.smembers('users'), list = names.length ? await redis.mget(...names.map(key)) : [], H = (await redis.get('chh')) || [];
      const rows = list.filter((v) => v && !v.bot && !banOf(v)).map((v) => { const c = v.cs || csFrom(H, v.pseudo); return { pseudo: v.pseudo, w: c.w, l: c.l, d: c.d, n: c.w + c.l + c.d, pf: v.pf || null }; })
        .filter((r) => r.n > 0).sort((x, y) => y.w - x.w || y.w / y.n - x.w / x.n || y.n - x.n || x.pseudo.localeCompare(y.pseudo));
      extra = { chrank: rows.slice(0, [5, 10].includes(+b.n) ? +b.n : 10000).map((x, i) => (i < 10 ? x : { ...x, pf: null })) };
    } else if (b.action === 'vapid') {
      extra = { key: (await vapid()).pub };
    } else if (b.action === 'subscribe') {
      const sb = b.sub;
      if (!sb || !sb.endpoint || !sb.keys) return fail('Abonnement invalide');
      u.subs = [...(u.subs || []).filter((x) => x.endpoint !== sb.endpoint), { endpoint: sb.endpoint, keys: sb.keys }].slice(-5);
    } else if (b.action === 'delnote') {
      u.inbox = b.id === 'all' ? [] : u.inbox.filter((x) => x.id !== b.id);
    } else if (b.action === 'list') {
      const pr = int(b.price, 1e6);
      if (pr < 1) return fail('Prix invalide');
      if (!u.cards[b.card]) return fail('Carte non possédée');
      if (mk.filter((x) => x.seller === u.pseudo).length >= 20) return fail('20 annonces maximum');
      rm(u, b.card, 1);
      mk.push({ id: crypto.randomBytes(6).toString('hex'), seller: u.pseudo, card: b.card, price: pr, t: Date.now() });
      await redis.set('market', mk);
      await bcast('🏷️ Nouvelle carte au Marché : ' + b.card.slice(b.card.indexOf(':') + 1) + ' (' + pr + ' 🪙)', u.pseudo);
    } else if (b.action === 'players') {
      extra = { players: (await redis.smembers('users')).filter((n) => n !== u.pseudo).sort() };
    } else if (b.action === 'peek') {
      const v = await redis.get(key(String(b.pseudo || '')));
      if (!v) return fail('Joueur introuvable');
      extra = { peek: { pseudo: v.pseudo, cards: Object.fromEntries(Object.entries(v.cards || {}).filter(([id]) => knownId(u, cat, id))) } };
    } else if (b.action === 'gift') {
      const v = await redis.get(key(String(b.to || '')));
      if (!v || v.pseudo === u.pseudo) return fail('Joueur introuvable');
      v.since ||= {}; v.fav ||= []; v.cards ||= {}; v.bought ||= {};
      const txt = String(b.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      let what;
      if (b.kind === 'coins') {
        const c = int(b.amount);
        if (c < 1) return fail('Montant invalide');
        if (c > u.coins) return fail('Pas assez de coins');
        u.coins -= c; v.coins += c; what = c + ' 🪙';
      } else if (b.kind === 'pack') {
        const t = String(b.theme || 'free');
        if (t === 'free') {
          if (freeAll(u) < 1) return fail("Tu n'as aucun sachet gratuit");
          tick(v);
          if ((u.packs || 0) > 0) u.packs -= 1; else { const big = Object.values(u.fl).sort((x, y) => y.n - x.n)[0]; big.n -= 1; }
          v.packs = (v.packs || 0) + 1; what = 'un sachet gratuit';
        } else {
          if (t === 'obj' || !shAll[t]) return fail("Ce sachet n'existe pas");
          if (!(u.bought[t] > 0)) return fail("Tu n'as pas de sachet " + cat[t].name);
          u.bought[t] -= 1; v.bought[t] = (v.bought[t] || 0) + 1; what = 'un sachet ' + cat[t].name;
        }
      } else {
        const ids = [].concat(b.cards || (b.card ? [b.card] : [])).map(String), cnt = {};
        if (!ids.length) return fail('Choisis au moins une carte');
        if (ids.length > 10) return fail('10 cartes maximum par lot');
        for (const id of ids) {
          if (!rarOf(cat, id)) return fail('Carte inconnue');
          cnt[id] = (cnt[id] || 0) + 1;
          if (cnt[id] > (u.cards[id] || 0)) return fail('Tu ne possèdes pas assez de ' + cn(id));
        }
        for (const [id, n] of Object.entries(cnt)) { rm(u, id, n); add(v, id, n); }
        const names = Object.entries(cnt).map(([id, n]) => cn(id) + (n > 1 ? ' ×' + n : ''));
        what = ids.length === 1 ? 'la carte ' + names[0] : 'un lot de ' + ids.length + ' cartes (' + names.join(', ') + ')';
      }
      await dmPush(u, v, '🎁 Cadeau : ' + what + (txt ? ' — « ' + txt + ' »' : ''), true);
      note(v, '🎁 ' + u.pseudo + " t'a offert " + what + (txt ? ' — « ' + txt + ' »' : ''));
      await redis.set(key(v.pseudo), v);
      extra = { gifted: what, to: v.pseudo };
    } else if (b.action === 'subgift') { // offrir un abonnement depuis une conversation : payé par celui qui offre (prix × jours)
      const v = await redis.get(key(String(b.to || '')));
      if (!v || v.pseudo === u.pseudo) return fail('Joueur introuvable');
      if (v.bot) return fail("Les bots n'ont pas d'abonnement");
      const T = SUBS.find((x) => x.t === int(b.tier, 3));
      if (!T) return fail('Palier inconnu');
      const d = int(b.days, SUB_MAX);
      if (d < 1) return fail('Choisis une durée de 1 à ' + SUB_MAX + ' jours');
      const cost = T.price * d;
      if (u.coins < cost) return fail('Pas assez de coins : il faut ' + cost + ' 🪙 pour offrir ' + d + ' jour' + (d > 1 ? 's' : '') + ' de ' + T.name);
      const hi = applySub(v, T, d);
      if (hi) return fail(v.pseudo + ' a déjà un abonnement ' + hi.name + ' en cours : tu peux lui offrir le même palier (pour le prolonger) ou un palier plus haut, pas un palier plus bas');
      u.coins -= cost;
      const what = "l'abonnement " + T.ico + ' ' + T.name + ' (' + d + ' jour' + (d > 1 ? 's' : '') + ')';
      await dmPush(u, v, '🎁 Cadeau : ' + what, true);
      note(v, '🎁 ' + u.pseudo + " t'a offert " + what + " : le bonus de chances et la couleur de fond d'abonné sont actifs");
      await redis.set(key(v.pseudo), v);
      extra = { gifted: what, to: v.pseudo };
    } else if (b.action === 'redeem') { // Réglages → Code : un code ne s'utilise qu'une fois par joueur
      const now = Date.now(), code = normCode(b.code);
      u.codeF = (u.codeF || []).filter((x) => now - x < 600000);
      const bad = async (m) => { u.codeF.push(now); await redis.set(key(u.pseudo), u); return fail(m); }; // les mauvais codes sont comptés (5 essais ratés = 10 minutes de pause)
      if (u.codeF.length >= 5) return fail('Trop d’essais ratés : réessaie dans quelques minutes');
      if (!code) return fail('Entre un code');
      const codes = (await redis.get('codes')) || {}, c = codes[code];
      if (!c) return await bad('Code invalide');
      if (c.exp && c.exp <= now) return await bad('Ce code a expiré');
      c.used ||= [];
      if (c.used.includes(u.pseudo.toLowerCase())) return fail('Tu as déjà utilisé ce code');
      if (c.max && c.used.length >= c.max) return await bad("Ce code a déjà été utilisé le nombre maximum de fois");
      const T = c.sub ? SUBS.find((x) => x.t === c.sub.t) : null;
      if (T) { const hi = applySub(u, T, c.sub.days); if (hi) return fail('Ce code donne un abonnement ' + T.name + ', mais ton abonnement ' + hi.name + ' est plus haut : réessaie quand il sera terminé (le code n’est pas consommé)'); }
      const parts = [];
      if (c.coins) { u.coins += c.coins; parts.push(c.coins + ' 🪙'); }
      if (c.packs) { u.packs += c.packs; parts.push(c.packs + ' sachet' + (c.packs > 1 ? 's' : '') + ' gratuit' + (c.packs > 1 ? 's' : '')); }
      for (const [t, n] of Object.entries(c.bought || {})) { if (!cat[t] || t === 'obj') continue; u.bought[t] = (u.bought[t] || 0) + n; parts.push(n + ' sachet' + (n > 1 ? 's' : '') + ' ' + cat[t].name); }
      for (const [id, n] of Object.entries(c.cards || {})) { if (!rarOf(cat, id)) continue; add(u, id, n); parts.push((n > 1 ? n + ' × ' : '') + 'la carte ' + id.slice(id.indexOf(':') + 1)); }
      if (c.rx) { u.rcX = Math.min(500, (u.rcX || 0) + c.rx); parts.push(c.rx + ' pack' + (c.rx > 1 ? 's' : '') + ' de course'); }
      if (T) parts.push("l'abonnement " + T.ico + ' ' + T.name + ' (' + c.sub.days + ' jour' + (c.sub.days > 1 ? 's' : '') + ')');
      c.used.push(u.pseudo.toLowerCase());
      codes[code] = c;
      await redis.set('codes', codes);
      note(u, '🎟️ Code ' + code + ' utilisé : ' + (parts.join(', ') || 'rien'));
      extra = { redeemed: parts.join(', ') || 'rien' };
    } else if (b.action === 'dmsend') {
      const v = await redis.get(key(String(b.to || '')));
      if (!v || v.pseudo === u.pseudo) return fail('Joueur introuvable');
      const txt = String(b.text || '').replace(/\s+/g, ' ').trim().slice(0, 500);
      if (!txt) return fail('Message vide');
      const now = Date.now(); u.msgT = (u.msgT || []).filter((x) => now - x < 60000);
      if (u.msgT.length >= 12) return fail('Doucement ! 12 messages par minute maximum');
      u.msgT.push(now);
      await dmPush(u, v, txt, false);
      ping(v, '💬 ' + u.pseudo + ' : ' + (txt.length > 90 ? txt.slice(0, 90) + '…' : txt));
      await redis.set(key(v.pseudo), v);
    } else if (b.action === 'dmget') {
      const o = await redis.get(key(String(b.with || '')));
      if (!o) return fail('Joueur introuvable');
      const e = (u.dm || {})[o.pseudo.toLowerCase()]; if (e) e.n = 0;
      extra = { thread: ((await redis.get(dmKey(u.pseudo, o.pseudo))) || []).slice(-100), with: o.pseudo };
    } else if (b.action === 'tradeoffer') {
      const gv = b.give, w = String(b.want || '');
      if (!u.cards[gv]) return fail('Carte non possédée');
      if (!rarOf(cat, w) || w.startsWith('obj:') || gv === w || !knownId(u, cat, w)) return fail('Carte demandée invalide');
      if (mk.filter((x) => x.seller === u.pseudo).length >= 20) return fail('20 annonces maximum');
      let to = null, tv = null;
      if (b.to) {
        tv = await redis.get(key(String(b.to)));
        if (!tv || tv.pseudo === u.pseudo) return fail('Joueur introuvable');
        if (!tv.cards[w]) return fail("Ce joueur n'a pas cette carte");
        to = tv.pseudo;
      }
      rm(u, gv, 1);
      mk.push({ id: crypto.randomBytes(6).toString('hex'), seller: u.pseudo, card: gv, want: w, price: 0, to, t: Date.now() });
      await redis.set('market', mk);
      if (tv) { await dmPush(u, tv, '🔁 Proposition d\'échange : ' + cn(gv) + ' contre ' + cn(w), true); note(tv, '🔁 ' + u.pseudo + ' te propose : ' + cn(gv) + ' contre ' + cn(w)); await redis.set(key(tv.pseudo), tv); }
      else await bcast('🔁 Nouvel échange : ' + cn(gv) + ' contre ' + cn(w), u.pseudo);
    } else if (b.action === 'tradeaccept') {
      const x = mk.find((y) => y.id === b.id && y.want);
      if (!x || !knownId(u, cat, x.card)) return fail('Offre déjà acceptée ou retirée');
      if (x.seller === u.pseudo) return fail("C'est ta propre offre");
      if (x.to && x.to !== u.pseudo) return fail("Cette offre ne t'est pas destinée");
      if (x.ask) return fail('Contre-offre en attente de la réponse du proposeur');
      if (!u.cards[x.want]) return fail("Tu n'as pas la carte demandée");
      mk = mk.filter((y) => y !== x); await redis.set('market', mk);
      rm(u, x.want, 1); add(u, x.card, 1);
      const v = await redis.get(key(x.seller));
      if (v) { add(v, x.want, 1); note(v, '🔁 ' + u.pseudo + ' a accepté ton échange : tu reçois ' + cn(x.want)); await redis.set(key(v.pseudo), v); }
    } else if (b.action === 'tradecounter') {
      const x = mk.find((y) => y.id === b.id && y.want && y.to === u.pseudo), ask = int(b.ask, 1e6);
      if (!x) return fail('Offre introuvable');
      if (x.ask) return fail('Contre-offre déjà envoyée');
      if (ask < 1) return fail('Montant invalide');
      x.ask = ask; await redis.set('market', mk);
      const v = await redis.get(key(x.seller));
      if (v) { await dmPush(u, v, '💬 Contre-offre : +' + ask + ' 🪙 en plus pour ' + cn(x.card) + ' contre ' + cn(x.want), true); note(v, '💬 ' + u.pseudo + ' demande +' + ask + ' 🪙 en plus pour ' + cn(x.card) + ' contre ' + cn(x.want)); await redis.set(key(v.pseudo), v); }
    } else if (b.action === 'tradeconfirm') {
      const x = mk.find((y) => y.id === b.id && y.want && y.seller === u.pseudo && y.ask);
      if (!x) return fail('Contre-offre introuvable');
      if (u.coins < x.ask) return fail('Pas assez de coins');
      const v = await redis.get(key(x.to));
      if (!v || !v.cards[x.want]) return fail("Ce joueur n'a plus la carte demandée : retire l'offre");
      mk = mk.filter((y) => y !== x); await redis.set('market', mk);
      u.coins -= x.ask; rm(v, x.want, 1); add(u, x.want, 1); add(v, x.card, 1); v.coins += x.ask;
      await dmPush(u, v, '✅ Contre-offre acceptée (+' + x.ask + ' 🪙) : ' + cn(x.card) + ' contre ' + cn(x.want), true); note(v, '✅ ' + u.pseudo + ' a accepté ta contre-offre (+' + x.ask + ' 🪙) : tu reçois ' + cn(x.card)); await redis.set(key(v.pseudo), v);
    } else if (b.action === 'tradedecline') {
      const x = mk.find((y) => y.id === b.id && y.want && y.to === u.pseudo);
      if (!x) return fail('Offre introuvable');
      mk = mk.filter((y) => y !== x); await redis.set('market', mk);
      const v = await redis.get(key(x.seller));
      if (v) { add(v, x.card, 1); await dmPush(u, v, '❌ Échange refusé : ' + cn(x.card) + ' contre ' + cn(x.want), true); note(v, '❌ ' + u.pseudo + ' a refusé ton échange : ta carte t\'est rendue'); await redis.set(key(v.pseudo), v); }
    } else if (b.action === 'unlist') {
      const x = mk.find((y) => y.id === b.id && y.seller === u.pseudo);
      if (!x) return fail('Annonce introuvable');
      mk = mk.filter((y) => y !== x); add(u, x.card, 1);
      await redis.set('market', mk);
    } else if (b.action === 'buymk') {
      const x = mk.find((y) => y.id === b.id);
      if (!x || !knownId(u, cat, x.card)) return fail('Annonce déjà vendue ou retirée');
      if (x.want) return fail("C'est une offre d'échange");
      if (x.seller === u.pseudo) return fail("C'est ta propre annonce");
      if (u.coins < x.price) return fail('Pas assez de coins');
      mk = mk.filter((y) => y !== x);
      await redis.set('market', mk);
      u.coins -= x.price; addM(u, x);
      const v = await redis.get(key(x.seller));
      if (v) {
        v.coins += x.price;
        note(v, '💰 ' + u.pseudo + ' a acheté ta carte ' + x.card.slice(x.card.indexOf(':') + 1) + ' pour ' + x.price + ' coins');
        await redis.set(key(v.pseudo), v);
      }
    } else if (b.action === 'chlist') {
      const now = Date.now(), L = ((await redis.get('challenges')) || []).filter((x) => x.exp > now), H = (await redis.get('chh')) || [];
      const cl = (x) => ({ id: x.id, from: x.from, to: x.to, mode: x.mode, fmt: x.fmt, s: x.s, exp: x.exp }); // jamais les cartes de l'adversaire
      extra = { inc: L.filter((x) => x.to === u.pseudo).map(cl), open: L.filter((x) => !x.to && x.from !== u.pseudo).map(cl), sent: L.filter((x) => x.from === u.pseudo).map(cl), res: H.filter((h) => h.a === u.pseudo || h.b === u.pseudo).slice(0, 10) };
      if (b.pl) { const names = await redis.smembers('users'), list = names.length ? await redis.mget(...names.map(key)) : []; extra.players = list.filter((v) => v && v.pseudo !== u.pseudo && rbTot(v) > 0 && !banOf(v)).map((v) => v.pseudo).sort(); }
    } else if (b.action === 'chnew') {
      if (!rbTot(u)) return fail('Les défis se débloquent à ta première renaissance');
      const mode = b.mode === 'fun' ? 'fun' : 'war', fmt = [1, 2, 3].includes(+b.fmt) ? +b.fmt : 3, st = int(b.stake, CH.max), di = dlInfo(u);
      if (st < 10) return fail('Mise minimale : 10');
      if (di.left <= 0) return fail('Limite du jour atteinte : ' + di.max + ' défis par jour. Reviens demain !');
      const L = (await redis.get('challenges')) || [];
      if (L.filter((x) => x.from === u.pseudo).length >= CH.sent) return fail(CH.sent + ' défis en attente au maximum : annule-en un ou attends une réponse');
      let to = null, tv = null;
      if (b.to) {
        tv = await redis.get(key(String(b.to)));
        if (!tv || tv.pseudo === u.pseudo) return fail('Joueur introuvable');
        if (!rbTot(tv)) return fail("Ce joueur n'a pas encore débloqué les défis");
        if (banOf(tv)) return fail('Ce joueur est banni');
        if ((di.o[tv.pseudo.toLowerCase()] || 0) >= CH.vs) return fail('Déjà ' + CH.vs + ' défis aujourd’hui contre ' + tv.pseudo);
        to = tv.pseudo;
      }
      if (mode === 'war' && u.coins < st) return fail('Pas assez de coins');
      const ids = [].concat(b.cards || []).map(String), er = pickCards(u, ids, fmt, st, mode, cat, cu); if (er) return fail(er);
      const c = lock(u, ids); if (mode === 'war') u.coins -= st;
      const now = Date.now(), xn = { id: crypto.randomBytes(6).toString('hex'), from: u.pseudo, to, mode, fmt, s: st, c, t: now, exp: now + CH.ttl }; L.push(xn);
      await redis.set('challenges', L);
      if (tv && tv.bot) { // un bot répond tout de suite : il accepte ou refuse
        const h = await botAccept(tv, xn, u, cat, cu);
        if (h) extra = { res: h }; else { await redis.set('challenges', ((await redis.get('challenges')) || []).filter((y) => y.id !== xn.id)); refundCh(u, xn, '❌ ' + tv.pseudo + ' a refusé ton défi : mise et cartes rendues'); extra = { refused: tv.pseudo }; }
        await redis.set(key(tv.pseudo), tv);
      } else if (tv) { note(tv, '⚔️ ' + u.pseudo + ' te défie en ' + fmt + 'v' + fmt + ' (' + (mode === 'war' ? 'Guerre, mise ' + st + ' 🪙' : 'Amical') + ') : Social → Défis'); await redis.set(key(tv.pseudo), tv); }
    } else if (b.action === 'chacc') {
      if (!rbTot(u)) return fail('Les défis se débloquent à ta première renaissance');
      const L = (await redis.get('challenges')) || [], x = L.find((y) => y.id === b.id);
      if (!x || x.exp <= Date.now()) return fail('Défi introuvable : il a été accepté, annulé ou a expiré');
      if (x.from === u.pseudo) return fail("C'est ton propre défi");
      if (x.to && x.to !== u.pseudo) return fail("Ce défi ne t'est pas destiné");
      const A = await redis.get(key(x.from));
      if (!A) { await redis.set('challenges', L.filter((y) => y !== x)); return fail("Ce joueur n'existe plus"); }
      const di = dlInfo(u), da = dlInfo(A);
      if (di.left <= 0) return fail('Limite du jour atteinte : ' + di.max + ' défis par jour. Reviens demain !');
      if (da.left <= 0) return fail('Ton adversaire a atteint sa limite de défis du jour');
      if ((di.o[A.pseudo.toLowerCase()] || 0) >= CH.vs || (da.o[u.pseudo.toLowerCase()] || 0) >= CH.vs) return fail('Déjà ' + CH.vs + ' défis aujourd’hui entre vous deux');
      const st = int(b.stake, CH.max);
      if (st < 10) return fail('Mise minimale : 10');
      if (x.mode === 'war' && u.coins < st) return fail('Pas assez de coins');
      const ids = [].concat(b.cards || []).map(String), er = pickCards(u, ids, x.fmt, st, x.mode, cat, cu); if (er) return fail(er);
      const cb = lock(u, ids); if (x.mode === 'war') u.coins -= st;
      await redis.set('challenges', L.filter((y) => y !== x));
      const h = await settle(A, u, x, st, cb, cat, cu);
      await redis.set(key(A.pseudo), A);
      extra = { res: h };
    } else if (b.action === 'chdec') {
      const L = (await redis.get('challenges')) || [], x = L.find((y) => y.id === b.id && y.to === u.pseudo);
      if (!x) return fail('Défi introuvable');
      await redis.set('challenges', L.filter((y) => y !== x));
      const A = await redis.get(key(x.from));
      if (A) { refundCh(A, x, '❌ ' + u.pseudo + ' a refusé ton défi : mise et cartes rendues'); await redis.set(key(A.pseudo), A); }
    } else if (b.action === 'chcancel') {
      const L = (await redis.get('challenges')) || [], x = L.find((y) => y.id === b.id && y.from === u.pseudo);
      if (!x) return fail('Défi introuvable (déjà accepté ou expiré)');
      await redis.set('challenges', L.filter((y) => y !== x));
      refundCh(u, x, '↩️ Défi annulé : mise et cartes rendues');
    } else if (b.action === 'svans') { // réponse à un questionnaire : une seule fois par joueur
      if (u.bot || u.pseudo === OP_NAME) return fail('Action inconnue');
      const sv = (await svList()).find((y) => y.id === b.id && y.open); if (!sv) return fail('Ce questionnaire est terminé');
      const v = Math.floor(Number(b.v));
      if (sv.type === 'stars' ? !(v >= 1 && v <= 5) : !(v >= 0 && v < sv.opts.length)) return fail('Réponse invalide');
      if ((await redis.get(svKey(sv.id, u.pseudo))) != null) return fail('Tu as déjà répondu à ce questionnaire');
      await redis.set(svKey(sv.id, u.pseudo), { v, t: Date.now() }); await redis.sadd('svr:' + sv.id, u.pseudo.toLowerCase());
    } else if (b.action !== 'me') return fail('Action inconnue');

    if (b.action === 'me') { extra = { notifs: u.notifs }; u.notifs = []; }
    await redis.set(key(u.pseudo), u);
    return ok({ ...extra, state: { ...view(u, visShop(u, shAll, cat), cat, cu, mk), maint: maintOn, maintinfo: maintOn ? await maintInfo() : null, sv: await svNext(u), ...(await skinState()) } });
  } catch (e) {
    console.error(e);
    return fail('Erreur serveur : ' + e.message, 500);
  }
};

module.exports = async (req, res) => {
  const j = res.json.bind(res);
  res.json = async (d) => { await flush(); return j(d); };
  try { return await handler(req, res); } // filet de sécurité : une erreur imprévue devient un message lisible au lieu d'un plantage de la fonction (FUNCTION_INVOCATION_FAILED)
  catch (e) { console.error('fatal', e); try { if (!res.headersSent) return res.status(500).setHeader && res.status(500).json({ error: 'Erreur serveur : ' + (e && e.message) }); } catch {} }
};
