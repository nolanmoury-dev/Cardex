// # À TOUS CEUX QUI TOUCHENT À CE CODE : à chaque mise à jour visible par les joueurs, ajoutez une entrée en haut de UPDATES dans index.html
// # (pop-up affiché une seule fois à chaque joueur pour expliquer la mise à jour). Règle de l'opérateur, valable à partir du 14/10/2026.
const crypto = require('crypto');
const T0 = require('../lib/cards');

let redis;
const W = { c: 60, r: 25, e: 11, l: 4 }, BASE = { c: 2, r: 8, e: 25, l: 80 }, R = 'crel';
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
const RACE_HOUR = 36e5, CAR_COST = 200; // pas de ligne d'arrivée : celui qui est le plus loin à la fin de la semaine gagne
const raceWeek = () => { const d = new Date(parisDay() + 'T12:00:00Z'); return new Date(d - ((d.getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10); }; // lundi (Paris) de la semaine en cours
const raceEnd = () => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date()).map((x) => [x.type, x.value])), dow = (new Date(parisDay() + 'T12:00:00Z').getUTCDay() + 6) % 7; return Date.now() + ((6 - dow) * 86400 + 86400 - ((+p.hour % 24) * 3600 + +p.minute * 60 + +p.second)) * 1000; };
const raceView = (u) => { if (u.bot) return null; const w = raceWeek(), r = u.rc && u.rc.w === w ? u.rc : null, next = (u.rcT || 0) + RACE_HOUR, x = u.rcX || 0; return { w, pos: r ? r.pos : 0, car: u.car || null, next, x, ready: x > 0 || Date.now() >= next, end: raceEnd(), cost: CAR_COST }; }; // x = packs offerts par le staff (en plus du pack gratuit de l'heure)
const racePrevWeek = () => new Date(Date.parse(raceWeek() + 'T12:00:00Z') - 7 * DAY).toISOString().slice(0, 10);
const PFP_COST = 500; // photo de profil : 1re gratuite, 2e payante, 3e et + vérifiées par l'opérateur
const FK_DAYS = 7, FK_MAX = 5;
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
const full = (cu) => {
  const t = { ...T0 };
  cu.cols.forEach((c) => (t[c.key] = c));
  const o = { name: 'Objets', icon: '🎁', color: '#db2777', hidden: true, c: [], r: [], e: [], l: [] };
  cu.objs.forEach((x) => o[x.r].push(x.name));
  t.obj = o;
  return t;
};
const rarOf = (cat, id) => { const i = id.indexOf(':'), o = cat[id.slice(0, i)], n = id.slice(i + 1); return o && [...R].find((r) => o[r].includes(n)); };
const defBase = (id, r, cu) => { const ob = id.startsWith('obj:') && cu.objs.find((x) => 'obj:' + x.name === id); return ob ? Math.max(1, Math.floor(ob.price * 0.6)) : BASE[r]; };
// Valeur de base d'une carte : réglable par l'opérateur (cu.vals), sinon selon la rareté ; l'ancienneté s'ajoute par-dessus (+1 %/jour, max ×2)
const val = (u, id, cat, cu) => {
  const r = rarOf(cat, id); if (!r) return 0;
  const b = (cu.vals && cu.vals[id]) || defBase(id, r, cu);
  const d = Math.min(100, Math.floor((Date.now() - ((u.since || {})[id] || Date.now())) / DAY));
  return Math.max(1, Math.round(b * (1 + d / 100) * fkMult(u, id)));
};
const add = (u, id, n) => { if (!u.cards[id]) u.since[id] = Date.now(); u.cards[id] = (u.cards[id] || 0) + n; };
const rm = (u, id, n) => { u.cards[id] -= n; if (u.cards[id] <= 0) { delete u.cards[id]; delete u.since[id]; if (u.fk) delete u.fk[id]; u.fav = u.fav.filter((x) => x !== id); } };

// =================== DÉFIS ===================
// Cartes jouables : collections de niveau II à V, ou n'importe quelle collection dont le joueur a déjà fait une renaissance ; objets seulement si l'opérateur leur a donné des stats.
const CH = { fee: 5, max: 5000, ttl: 48 * 36e5, day: 10, vs: 3, sent: 5 };
const HP0 = { c: [20, 5], r: [30, 8], e: [45, 12], l: [70, 18] }, LVM = [1, 1.2, 1.4, 1.6, 1.8], COST = { c: 1, r: 3, e: 8, l: 20 };
const csFrom = (H, p) => H.reduce((c, h) => { if (h.a === p || h.b === p) { const m = h.w * (h.a === p ? 1 : -1); if (m > 0) c.w++; else if (m < 0) c.l++; else c.d++; } return c; }, { w: 0, l: 0, d: 0 }); // victoires / défaites / égalités en défi
const rbTot = (u) => Object.values((u && u.rb) || {}).reduce((a, x) => a + x, 0);
const statsOf = (id, cat, cu, raw) => {
  const o = !raw && (cu.stats || {})[id];
  if (o) return { hp: o.hp, atk: o.atk, custom: true };
  if (id.startsWith('obj:')) return null;
  const r = rarOf(cat, id); if (!r) return null;
  const t = id.slice(0, id.indexOf(':')), lv = Math.min(5, Math.max(1, (cat[t] && cat[t].lv) || 1));
  const h = parseInt(crypto.createHash('md5').update(id).digest('hex').slice(0, 6), 16) / 0xffffff, k = LVM[lv - 1] * (0.9 + 0.2 * h); // écart propre à chaque carte : -10 % à +10 %
  return { hp: Math.max(1, Math.round(HP0[r][0] * k)), atk: Math.max(1, Math.round(HP0[r][1] * k)) };
};
const playable = (u, id, cat, cu) => {
  if (!statsOf(id, cat, cu)) return false;
  if (id.startsWith('obj:')) return true;
  const t = id.slice(0, id.indexOf(':'));
  return ((cat[t] && cat[t].lv) || 1) >= 2 || ((u.rb || {})[t] || 0) >= 1;
};
const dlInfo = (u) => { const d = u.dl && u.dl.d === parisDay() ? u.dl : { n: 0, o: {} }, max = u.dlMax != null ? u.dlMax : CH.day; return { left: Math.max(0, max - d.n), max, o: d.o || {} }; };
const dlUse = (u, opp) => { if (!u.dl || u.dl.d !== parisDay()) u.dl = { d: parisDay(), n: 0, o: {} }; u.dl.n++; const k = opp.toLowerCase(); u.dl.o[k] = (u.dl.o[k] || 0) + 1; };
// Cartes engagées : sorties de la collection du joueur (donc bloquées partout) puis rendues ou transférées au résultat
const lock = (u, ids) => ids.map((id) => { const x = { id, since: (u.since || {})[id] || Date.now(), fav: u.fav.includes(id), fk: (u.fk || {})[id] }; rm(u, id, 1); return x; });
const unlock = (u, xs) => xs.forEach((x) => { const had = u.cards[x.id]; add(u, x.id, 1); if (!had) { u.since[x.id] = x.since; if (x.fav && !u.fav.includes(x.id)) u.fav.push(x.id); if (x.fk) (u.fk ||= {})[x.id] = x.fk; } });
const refundCh = (A, x, text) => { if (x.mode === 'war') A.coins += x.s; unlock(A, x.c); note(A, text); };
function pickCards(u, ids, fmt, stake, mode, cat, cu) {
  if (!Array.isArray(ids) || ids.length !== fmt) return 'Choisis exactement ' + fmt + ' carte' + (fmt > 1 ? 's' : '');
  const cnt = {}; let pts = 0;
  for (const id of ids) {
    const r = rarOf(cat, id);
    if (!r) return 'Carte inconnue';
    if (!playable(u, id, cat, cu)) return cn(id) + " n'est pas jouable en défi";
    cnt[id] = (cnt[id] || 0) + 1;
    if (cnt[id] > (u.cards[id] || 0)) return "Tu n'as pas assez d'exemplaires de " + cn(id);
    if (mode === 'war' && u.fav.includes(id)) return cn(id) + ' est en favori ⭐ : retire-la des favoris pour la jouer en mode Guerre';
    pts += COST[r];
  }
  if (pts > Math.floor(stake / 10)) return 'Trop de force : ' + pts + ' points pour ' + Math.floor(stake / 10) + ' autorisés (mise ' + stake + ' ÷ 10). Augmente la mise ou prends des cartes plus faibles.';
}
function duel(ia, ib, sa, sb) {
  let ha = sa.hp, hb = sb.hp; const r = [], roll = (a) => Math.max(1, Math.round(a * (0.8 + crypto.randomInt(0, 401) / 1000)));
  for (let i = 0; i < 60 && ha > 0 && hb > 0; i++) { const da = roll(sa.atk), db = roll(sb.atk); hb -= da; ha -= db; r.push([da, db]); }
  const ea = Math.max(0, ha), eb = Math.max(0, hb);
  return { a: ia, b: ib, ha: sa.hp, aa: sa.atk, hb: sb.hp, ab: sb.atk, r, ea, eb, w: Math.sign(ea - eb) };
}
// A = celui qui a lancé le défi (x), B = celui qui accepte. Retourne le combat enregistré (replay).
async function settle(A, B, x, sb, cb, cat, cu) {
  const sa = x.s, ca = x.c, war = x.mode === 'war', duels = [];
  for (let i = 0; i < x.fmt; i++) duels.push(duel(ca[i].id, cb[i].id, statsOf(ca[i].id, cat, cu), statsOf(cb[i].id, cat, cu)));
  const wa = duels.filter((d) => d.w === 1).length, wb = duels.filter((d) => d.w === -1).length;
  const w = wa !== wb ? Math.sign(wa - wb) : Math.sign(duels.reduce((a, d) => a + d.ea - d.eb, 0)); // plus de duels gagnés, sinon plus de points de vie restants
  const h = { id: crypto.randomBytes(6).toString('hex'), t: Date.now(), a: A.pseudo, b: B.pseudo, mode: x.mode, fmt: x.fmt, sa, sb, w, d: duels, pot: 0, fee: 0, got: null };
  if (w === 0 || !war) { if (war) { A.coins += sa; B.coins += sb; } unlock(A, ca); unlock(B, cb); }
  else {
    const [W, Lo, cw, cl] = w > 0 ? [A, B, ca, cb] : [B, A, cb, ca], tot = sa + sb;
    h.pot = tot - Math.floor((tot * CH.fee) / 100); h.fee = tot - h.pot;
    W.coins += h.pot; unlock(W, cw);
    const k = crypto.randomInt(cl.length); h.got = cl[k].id;
    cl.forEach((c, i) => { if (i === k) add(W, c.id, 1); else unlock(Lo, [c]); });
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
function tick(u) {
  const now = Date.now();
  if (u.packs >= MAXP) { u.last = now; return; }
  let s;
  while (u.packs < MAXP && now - u.last >= (s = stepOf(u.packs))) { u.last += s; u.packs++; }
  if (u.packs >= MAXP) u.last = now;
}
const shopOf = async (cat) => {
  const s = (await redis.get('shop')) || {};
  return Object.fromEntries(Object.entries(cat).filter(([, o]) => live(o)).map(([t]) => [t, { discount: int(s[(cat[t] && cat[t].base) || t] && s[(cat[t] && cat[t].base) || t].discount, 90), blocked: !!(s[(cat[t] && cat[t].base) || t] && s[(cat[t] && cat[t].base) || t].blocked) }]));
};
// Niveaux : chaque collection de base (foot…) a 5 niveaux = 5 collections différentes (foot, foot2…foot5).
// Niveau d'un joueur sur une ligne = 1 + son nombre total de renaissances sur cette ligne (5 max). Le prix du sachet double à chaque niveau : 100, 200, 400, 800, 1600.
const LVMAX = 5, LINES = Object.keys(T0).filter((t) => Object.values(T0).some((o) => o.base === t));
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
  dms: Object.values(u.dm || {}).sort((a, b) => b.t - a.t), pseudo: u.pseudo, ban: banOf(u), ch: { ok: rbTot(u) > 0, left: dlInfo(u).left, max: dlInfo(u).max }, st: Object.fromEntries(Object.keys(u.cards).map((id) => { const s = statsOf(id, cat, cu); return [id, s ? [s.hp, s.atk, playable(u, id, cat, cu) ? 1 : 0] : null]; })), rl: rlInfo(u), mg: mgInfo(u), dn: u.dn || null, renames: u.renames || 0, rb: u.rb || {}, dy: dyInfo(u), rc: raceView(u), fk: u.fk || {}, pf: u.pf || null, pfn: u.pfpN || 0, pfq: !!u.pfpReq, coins: u.coins, packs: u.packs, bought: u.bought || {},
  next: u.packs >= MAXP ? null : u.last + stepOf(u.packs), cards: u.cards, fav: u.fav, theme: u.theme || null,
  vals: Object.fromEntries(Object.keys(u.cards).map((id) => [id, val(u, id, cat, cu)])),
  shop: Object.fromEntries(Object.entries(sh).map(([t, s]) => [t, { ...s, price: price(s, t, cat), full: PRICE * 2 ** (lvOf(cat, t) - 1), lvl: lvOf(cat, t) }])), lv: Object.fromEntries(LINES.map((b) => [b, lineLv(u, b)])), lvn: Object.fromEntries(LINES.map((b) => [b, (cat[b + (lineLv(u, b) + 1)] || {}).name || null])),
  objs: cu.objs.filter((x) => !x.gone), themes: Object.fromEntries(Object.entries(cat).filter(([t]) => known(u, cat, t))),
});
// Plus le niveau du sachet est haut, plus les légendaires (et un peu les épiques) sont rares ; la différence revient aux communes.
const LEG = [4, 2.5, 1.5, 0.9, 0.5], EPI = [11, 10, 9, 8, 7];
function draw(o, t, lv = 1) {
  const w = { ...W, l: LEG[lv - 1] ?? LEG[0], e: EPI[lv - 1] ?? EPI[0] };
  w.c = 100 - w.r - w.e - w.l;
  let x = Math.random() * 100, r = 'c';
  for (const k of R) { if ((x -= w[k]) < 0) { r = k; break; } }
  if (!o[r].length) r = 'c';
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
  fort: { s: [1.1, 1.35], b: 0.85, bm: 1.05, rb: 1, tm: 1.0, ct: 1, off: 2 },
  mf: { s: [0.95, 1.5], b: 0.95, bm: 1.1, rb: 0.8, tm: 0.9, ct: 0.7, off: 1 },
  moy: { s: [0.7, 1.9], b: 1.2, bm: 1.2, rb: 0.4, tm: 0.75, ct: 0.3, off: 0 },
  nul: { s: [0.3, 3], b: 99, bm: 99, rb: 0.25, tm: 99, ct: 0, off: 0 },
};
async function botTurn(u, cat, cu, sh, mk) {
  const P = LV[u.bot], rnd = (a, c) => a + Math.random() * (c - a), V = (id) => val(u, id, cat, cu), pick = (a) => a[Math.floor(Math.random() * a.length)];
  const save = async (v) => redis.set(key(v.pseudo), v);
  tick(u); sh = visShop(u, sh, cat);
  // 1. sachets : le fort n'en achète que s'ils sont rentables (valeur moyenne d'un sachet ~46 coins)
  const themes = Object.keys(sh).filter((t) => !sh[t].blocked && t !== 'obj');
  if (themes.length) {
    const t = pick(themes), p = price(sh[t], t, cat);
    if (u.coins >= p + 50 && (P.rb < 0.5 || u.bot === 'nul' ? Math.random() < 0.3 : p <= 45)) { u.coins -= p; u.bought[t] = (u.bought[t] || 0) + 1; }
  }
  for (let i = 0; i < 12 && (u.packs > 0 || Object.values(u.bought).some((n) => n > 0)); i++) {
    let t = Object.keys(u.bought).find((k) => u.bought[k] > 0 && sh[k] && !sh[k].blocked);
    if (t) u.bought[t]--; else {
      if (!themes.length) break;
      const miss = (k) => [...R].flatMap((r) => cat[k][r].map((n) => k + ':' + n)).filter((id) => !u.cards[id]).length;
      t = u.bot === 'fort' || u.bot === 'mf' ? themes.sort((a, c) => miss(c) - miss(a))[0] : pick(themes);
      u.packs--;
    }
    Array.from({ length: PACK }, () => draw(cat[t], t)).forEach((id) => add(u, id, 1));
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
      mk = mk.filter((y) => y !== x); u.coins -= x.price; add(u, x.card, 1); bought++;
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
  if (req.method !== 'POST' && !cron) return fail('POST uniquement', 405);
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
    if (cron) return ok(await dailyPush());
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
        const users = list.filter(Boolean).map((u) => { tick(u); return { pseudo: u.pseudo, bot: u.bot || null, coins: u.coins, packs: u.packs, bought: u.bought || {}, cards: u.cards, seen: u.bot ? u.lastAct || 0 : u.seen || 0, banned: !!banOf(u), pf: !!u.pf }; });
        return ok({ ...(await skinState()), skinc: await skinList(), maint: !!(await redis.get('maint')), maintinfo: (await redis.get('maintinfo')) || { presets: [], msg: '' }, maintPresets: Object.entries(MAINT_PRESETS).map(([k, v]) => ({ k, label: v[0] })), users, shop: await shopOf(cat), custom: cu, reports: (await redis.get('reports')) || [], pfpq: await pfpList(), market: (await redis.get('market')) || [], themes: cat });
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
        const ids = [].concat(b.cards || (b.card ? [b.card] : [])).map(String);
        for (const id of ids) {
          if (!rarOf(cat, id)) return fail('Carte inconnue');
          if (sg < 0 && !u.cards[id]) return fail("Ce joueur n'a pas la carte " + id.slice(id.indexOf(':') + 1));
        }
        for (const id of ids) {
          if (sg > 0) add(u, id, 1); else rm(u, id, 1);
          parts.push('la carte ' + id.slice(id.indexOf(':') + 1));
        }
        if (parts.length) note(u, (sg > 0 ? "🎁 L'opérateur t'a donné : " : "⚠️ L'opérateur t'a retiré : ") + parts.join(', '));
        await redis.set(key(u.pseudo), u);
        return ok({ done: true });
      }
      if (b.action === 'addcol') {
        const name = String(b.name || '').trim().slice(0, 30);
        if (name.length < 2) return fail('Nom trop court');
        const now0 = Date.now(), un0 = Number(b.until);
        if (b.until != null && !(un0 > now0)) return fail('La date de fin doit être dans le futur');
        const endAt = b.until != null ? Math.min(un0, now0 + 366 * DAY) : now0 + Math.max(1, int(b.days, 365) || 7) * DAY;
        const o = { key: 'x' + Date.now(), name, icon: String(b.icon || '').trim().slice(0, 4) || '⭐', color: /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : '#0ea5e9', until: endAt, c: [], r: [], e: [], l: [] };
        String(b.cards || '').split('\n').slice(0, 200).forEach((ln) => {
          const m = ln.trim().match(/^([crel]):(.+)$/i), r = m ? m[1].toLowerCase() : 'c', n = (m ? m[2] : ln).trim();
          if (n && !o[r].includes(n)) o[r].push(n);
        });
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
        cu.objs.push({ name, r, price: pr, stock: st > 0 ? Math.min(st, 1e6) : null });
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
        return ok({ p: { seen: u.bot ? u.lastAct || 0 : u.seen || 0, ban: banOf(u), same, pseudo: u.pseudo, bot: u.bot || null, coins: u.coins, packs: u.packs, bought: u.bought || {}, cards: u.cards || {}, rb: u.rb || {}, rl: rlInfo(u).left, dl: { left: dlInfo(u).left, max: dlInfo(u).max }, mg: mgInfo(u), renames: u.renames || 0, race: !!raceView(u), rx: u.rcX || 0 }, max: { rl: RL_MAX, mg: MG_MAX } });
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
        const id = String(b.card || ''), pr = int(b.price, 1e6), q = Math.max(1, Math.min(20, int(b.qty, 20) || 1));
        if (!rarOf(cat, id)) return fail('Carte inconnue');
        if (pr < 1) return fail('Prix invalide');
        const mk0 = (await redis.get('market')) || [];
        for (let i = 0; i < q; i++) mk0.push({ id: crypto.randomBytes(6).toString('hex'), seller: OP_NAME, card: id, price: pr, t: Date.now(), staff: true });
        await redis.set('market', mk0);
        if (b.notify) await bcast('🏷️ Nouvelle carte au Marché : ' + cn(id) + ' (' + pr + ' 🪙)', OP_NAME);
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
    tick(u);
    u.seen = Date.now();
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
      const have = (u.bought[b.theme] || 0) + u.packs;
      if (have < 1) return fail('Aucun sachet disponible');
      const n = Math.min(have, OPEN_MAX, b.all ? OPEN_MAX : Math.max(1, int(b.n, OPEN_MAX) || 1)); // plusieurs sachets de la même collection d'un coup
      for (let i = 0; i < n; i++) { if (u.bought[b.theme] > 0) u.bought[b.theme] -= 1; else u.packs -= 1; }
      const drawn = Array.from({ length: PACK * n }, () => draw(cat[b.theme], b.theme, lvOf(cat, b.theme)));
      drawn.forEach((id) => add(u, id, 1));
      extra = { drawn, n };
    } else if (b.action === 'buyobj') {
      const x = cu.objs.find((o) => !o.gone && 'obj:' + o.name === b.id);
      if (!x) return fail('Objet indisponible');
      if (x.stock != null && x.stock <= 0) return fail('Objet épuisé');
      if (u.coins < x.price) return fail('Pas assez de coins');
      u.coins -= x.price; add(u, b.id, 1);
      if (x.stock != null) { x.stock -= 1; await redis.set('custom', cu); }
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
        gain += val(u, id, cat, cu) * k; cnt += k; rm(u, id, k);
      }
      if (!cnt) return fail('Rien à vendre (les favoris ⭐' + (b.mode === 'dupes' ? ' et le 1er exemplaire' : '') + ' sont gardés)');
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
      const rk = (id) => 'crel'.indexOf(rarOf(cat, id)), rounds = []; let res = 0;
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
      const names = await redis.smembers('users'), list = names.length ? await redis.mget(...names.map(key)) : [], w = raceWeek();
      const pw = racePrevWeek(), real = list.filter((v) => v && !v.bot && !banOf(v));
      const all = real.map((v) => { const r = v.rc && v.rc.w === w ? v.rc : null; return { pseudo: v.pseudo, pos: r ? r.pos : 0, tt: (r && r.tt) || 0, car: v.car || null, pf: v.pf || null }; })
        .sort((a, c) => c.pos - a.pos || (a.tt || 9e15) - (c.tt || 9e15) || a.pseudo.localeCompare(c.pseudo)) // le plus loin devant ; à égalité, celui qui y est arrivé le premier
        .map((x, i) => ({ ...x, rank: i + 1 }));
      const last = real.map((v) => { const r = v.rc && v.rc.w === pw ? v.rc : v.rcPrev && v.rcPrev.w === pw ? v.rcPrev : null; return r && r.pos > 0 ? { pseudo: v.pseudo, pos: r.pos, tt: r.tt || 9e15 } : null; }).filter(Boolean).sort((a, c) => c.pos - a.pos || a.tt - c.tt)[0] || null;
      const n = [5, 10].includes(+b.n) ? +b.n : 200, rows = all.slice(0, n), me = all.find((x) => x.pseudo === u.pseudo);
      if (me && !rows.includes(me)) rows.push(me);
      extra = { race: { rows: rows.map((x, i) => (i < 10 || x === me ? x : { ...x, pf: null })), total: all.length, end: raceEnd(), last: last && { pseudo: last.pseudo, pos: last.pos } } };
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
      const t = String(b.t || ''), o = cat[t];
      if (!o || t === 'obj') return fail('Collection inconnue');
      const ids = [...R].flatMap((r) => o[r].map((n) => t + ':' + n));
      if (o.until != null && !o.base && ((u.rb || {})[t] || 0) >= 1) return fail('Cette collection provisoire a déjà fait sa renaissance (une seule fois)');
      if (!ids.length || ids.some((id) => !u.cards[id])) return fail('Collection incomplète');
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
      extra = { chUnlock: rb0 === 0, gain, lv: L1, kept, unlocked: nt && cat[nt] ? cat[nt].name : null };
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
          if (u.packs < 1) return fail("Tu n'as aucun sachet gratuit");
          tick(v); u.packs -= 1; v.packs += 1; what = 'un sachet gratuit';
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
      u.coins -= x.price; add(u, x.card, 1);
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
      if (b.pl) { const names = await redis.smembers('users'), list = names.length ? await redis.mget(...names.map(key)) : []; extra.players = list.filter((v) => v && !v.bot && v.pseudo !== u.pseudo && rbTot(v) > 0 && !banOf(v)).map((v) => v.pseudo).sort(); }
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
        if (tv.bot) return fail('Les bots ne jouent pas aux défis');
        if (!rbTot(tv)) return fail("Ce joueur n'a pas encore débloqué les défis");
        if (banOf(tv)) return fail('Ce joueur est banni');
        if ((di.o[tv.pseudo.toLowerCase()] || 0) >= CH.vs) return fail('Déjà ' + CH.vs + ' défis aujourd’hui contre ' + tv.pseudo);
        to = tv.pseudo;
      }
      if (mode === 'war' && u.coins < st) return fail('Pas assez de coins');
      const ids = [].concat(b.cards || []).map(String), er = pickCards(u, ids, fmt, st, mode, cat, cu); if (er) return fail(er);
      const c = lock(u, ids); if (mode === 'war') u.coins -= st;
      const now = Date.now(); L.push({ id: crypto.randomBytes(6).toString('hex'), from: u.pseudo, to, mode, fmt, s: st, c, t: now, exp: now + CH.ttl });
      await redis.set('challenges', L);
      if (tv) { note(tv, '⚔️ ' + u.pseudo + ' te défie en ' + fmt + 'v' + fmt + ' (' + (mode === 'war' ? 'Guerre, mise ' + st + ' 🪙' : 'Amical') + ') : Social → Défis'); await redis.set(key(tv.pseudo), tv); }
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
    } else if (b.action !== 'me') return fail('Action inconnue');

    if (b.action === 'me') { extra = { notifs: u.notifs }; u.notifs = []; }
    await redis.set(key(u.pseudo), u);
    return ok({ ...extra, state: { ...view(u, visShop(u, shAll, cat), cat, cu, mk), maint: maintOn, maintinfo: maintOn ? await maintInfo() : null, ...(await skinState()) } });
  } catch (e) {
    console.error(e);
    return fail('Erreur serveur : ' + e.message, 500);
  }
};

module.exports = (req, res) => {
  const j = res.json.bind(res);
  res.json = async (d) => { await flush(); return j(d); };
  return handler(req, res);
};
