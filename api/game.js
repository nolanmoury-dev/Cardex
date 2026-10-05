const crypto = require('crypto');
const T0 = require('../lib/cards');

let redis;
const W = { c: 60, r: 25, e: 11, l: 4 }, BASE = { c: 2, r: 8, e: 25, l: 80 }, R = 'crel';
const DAY = 864e5, MAXP = 10, PRICE = 100, PACK = 5;
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
const OP_ID = (process.env.OPERATOR_ID || 'operateur').toLowerCase();
const OP_NAME = 'Noln_mry';
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
  if (mk.some((x) => x.seller === old || x.to === old)) await redis.set('market', mk.map((x) => ({ ...x, seller: x.seller === old ? nn : x.seller, ...(x.to === old ? { to: nn } : {}) })));
}
const OP_CODE = process.env.OPERATOR_CODE || '100823';
const key = (p) => 'u:' + p.toLowerCase();
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const int = (v, max = 1e6) => Math.max(0, Math.min(max, parseInt(v, 10) || 0));
const envFind = (re) => { const k = Object.keys(process.env).find((x) => re.test(x) && process.env[x]); return k && process.env[k]; };
const live = (o) => !o.hidden && (!o.until || o.until > Date.now());
const loadCu = async () => ({ cols: [], objs: [], ...((await redis.get('custom')) || {}) });
const full = (cu) => {
  const t = { ...T0 };
  cu.cols.forEach((c) => (t[c.key] = c));
  const o = { name: 'Objets', icon: '🎁', color: '#db2777', hidden: true, c: [], r: [], e: [], l: [] };
  cu.objs.forEach((x) => o[x.r].push(x.name));
  t.obj = o;
  return t;
};
const rarOf = (cat, id) => { const i = id.indexOf(':'), o = cat[id.slice(0, i)], n = id.slice(i + 1); return o && [...R].find((r) => o[r].includes(n)); };
const val = (u, id, cat, cu) => {
  const r = rarOf(cat, id); if (!r) return 0;
  const ob = id.startsWith('obj:') && cu.objs.find((x) => 'obj:' + x.name === id);
  const b = ob ? Math.max(1, Math.floor(ob.price * 0.6)) : BASE[r];
  const d = Math.min(100, Math.floor((Date.now() - ((u.since || {})[id] || Date.now())) / DAY));
  return Math.max(1, Math.round(b * (1 + d / 100)));
};
const add = (u, id, n) => { if (!u.cards[id]) u.since[id] = Date.now(); u.cards[id] = (u.cards[id] || 0) + n; };
const rm = (u, id, n) => { u.cards[id] -= n; if (u.cards[id] <= 0) { delete u.cards[id]; delete u.since[id]; u.fav = u.fav.filter((x) => x !== id); } };

function note(u, text, quiet) {
  if (!quiet) {
    (u.notifs ||= []).push(text);
    (u.inbox ||= []).unshift({ id: Date.now() + Math.random().toString(36).slice(2, 6), text, t: Date.now() });
    u.inbox = u.inbox.slice(0, 30);
  }
  if ((u.subs || []).length) pend.push([u.subs, text]);
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
  return Object.fromEntries(Object.entries(cat).filter(([, o]) => live(o)).map(([t]) => [t, { discount: int(s[t] && s[t].discount, 90), blocked: !!(s[t] && s[t].blocked) }]));
};
const price = (sh) => Math.round((PRICE * (100 - sh.discount)) / 100);
const view = (u, sh, cat, cu, mk) => ({
  market: (mk || []).filter((x) => !x.to || x.to === u.pseudo || x.seller === u.pseudo), inbox: u.inbox || [],
  pseudo: u.pseudo, renames: u.renames || 0, rb: u.rb || {}, coins: u.coins, packs: u.packs, bought: u.bought || {},
  next: u.packs >= MAXP ? null : u.last + stepOf(u.packs), cards: u.cards, fav: u.fav, theme: u.theme || null,
  vals: Object.fromEntries(Object.keys(u.cards).map((id) => [id, val(u, id, cat, cu)])),
  shop: Object.fromEntries(Object.entries(sh).map(([t, s]) => [t, { ...s, price: price(s) }])),
  objs: cu.objs.filter((x) => !x.gone), themes: cat,
});
function draw(o, t) {
  let x = Math.random() * 100, r = 'c';
  for (const k of R) { if ((x -= W[k]) < 0) { r = k; break; } }
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
  tick(u);
  // 1. sachets : le fort n'en achète que s'ils sont rentables (valeur moyenne d'un sachet ~46 coins)
  const themes = Object.keys(sh).filter((t) => !sh[t].blocked && t !== 'obj');
  if (themes.length) {
    const t = pick(themes), p = price(sh[t]);
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
      if (v) { add(v, x.want, 1); note(v, '🔁 ' + u.pseudo + ' a accepté ton échange : tu reçois ' + cn(x.want)); await save(v); }
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
    const r = d && rarOf(cat, d), m = r && pick(Object.keys(cat).filter((t) => t !== 'obj' && live(cat[t])).flatMap((t) => cat[t][r].map((n) => t + ':' + n)).filter((id) => !u.cards[id]).concat([null]));
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
      if (b.action === 'register') {
        if (u || pseudo.toLowerCase() === OP_ID || pseudo.toLowerCase() === OP_NAME.toLowerCase() || isBotName(pseudo)) return fail('Ce pseudo est déjà pris');
        const salt = crypto.randomBytes(16).toString('hex');
        u = { pseudo, salt, hash: hash(pw, salt), coins: 200, packs: 1, bought: {}, last: Date.now(), cards: {}, since: {}, fav: [], notifs: [] };
        await redis.set(key(pseudo), u);
        await redis.sadd('users', pseudo);
      } else if (!u || hash(pw, u.salt) !== u.hash) return fail('Pseudo ou mot de passe incorrect', 401);
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
        const users = list.filter(Boolean).map((u) => { tick(u); return { pseudo: u.pseudo, bot: u.bot || null, coins: u.coins, packs: u.packs, bought: u.bought || {}, cards: u.cards }; });
        return ok({ maint: !!(await redis.get('maint')), users, shop: await shopOf(cat), custom: cu, reports: (await redis.get('reports')) || [], themes: cat });
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
        const o = { key: 'x' + Date.now(), name, icon: String(b.icon || '').trim().slice(0, 4) || '⭐', color: /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : '#0ea5e9', until: Date.now() + Math.max(1, int(b.days, 365) || 7) * DAY, c: [], r: [], e: [], l: [] };
        String(b.cards || '').split('\n').slice(0, 200).forEach((ln) => {
          const m = ln.trim().match(/^([crel]):(.+)$/i), r = m ? m[1].toLowerCase() : 'c', n = (m ? m[2] : ln).trim();
          if (n && !o[r].includes(n)) o[r].push(n);
        });
        if (!o.c.length) return fail('Mets au moins une carte commune (ligne sans préfixe)');
        cu.cols.push(o);
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
      if (b.action === 'maint') { await redis.set('maint', !!b.on); return ok({ done: true }); }
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
        await redis.del(key(u.pseudo)); await redis.srem('users', u.pseudo);
        await redis.set('market', ((await redis.get('market')) || []).filter((x) => x.seller !== u.pseudo));
        return ok({ done: true });
      }
      if (b.action === 'delreport') {
        await redis.set('reports', ((await redis.get('reports')) || []).filter((x) => x.id !== b.id));
        return ok({ done: true });
      }
      return fail('Action inconnue');
    }

    const u = await redis.get(key(s.p));
    if (!u) return fail('Session expirée, reconnecte-toi', 401);
    u.bought ||= {}; u.since ||= {}; u.fav ||= []; u.notifs ||= []; u.inbox ||= [];
    tick(u);
    const maintOn = !!(await redis.get('maint')) && u.pseudo !== OP_NAME;
    if (maintOn && b.action !== 'me') return fail('🔧 Maintenance : une mise à jour arrive bientôt');
    const sh = await shopOf(cat);
    let mk = (await redis.get('market')) || [];
    let extra = {};
    const pack = () => {
      if (!sh[b.theme]) return 'Ce sachet n\'existe pas ou n\'est plus disponible';
      if (sh[b.theme].blocked) return 'Ce sachet est bloqué pour le moment';
    };

    if (b.action === 'buy') {
      const e = pack(); if (e) return fail(e);
      const p = price(sh[b.theme]);
      if (u.coins < p) return fail('Pas assez de coins');
      u.coins -= p;
      u.bought[b.theme] = (u.bought[b.theme] || 0) + 1;
    } else if (b.action === 'open') {
      const e = pack(); if (e) return fail(e);
      if (u.bought[b.theme] > 0) u.bought[b.theme] -= 1;
      else if (u.packs > 0) u.packs -= 1;
      else return fail('Aucun sachet disponible');
      const drawn = Array.from({ length: PACK }, () => draw(cat[b.theme], b.theme));
      drawn.forEach((id) => add(u, id, 1));
      extra = { drawn };
    } else if (b.action === 'buyobj') {
      const x = cu.objs.find((o) => !o.gone && 'obj:' + o.name === b.id);
      if (!x) return fail('Objet indisponible');
      if (x.stock != null && x.stock <= 0) return fail('Objet épuisé');
      if (u.coins < x.price) return fail('Pas assez de coins');
      u.coins -= x.price; add(u, b.id, 1);
      if (x.stock != null) { x.stock -= 1; await redis.set('custom', cu); }
    } else if (b.action === 'sell') {
      const list = b.mode === 'dupes'
        ? Object.entries(u.cards).filter(([id, n]) => n > 1 && !u.fav.includes(id) && (!b.theme || id.startsWith(b.theme + ':'))).map(([id, n]) => [id, n - 1])
        : [[String(b.card), 1]];
      let gain = 0, cnt = 0;
      for (const [id, n] of list) {
        const k = Math.min(n, u.cards[id] || 0); if (k < 1) continue;
        gain += val(u, id, cat, cu) * k; cnt += k; rm(u, id, k);
      }
      if (!cnt) return fail('Rien à vendre (les favoris et le 1er exemplaire sont gardés)');
      u.coins += gain; extra = { gain, cnt };
    } else if (b.action === 'fav') {
      if (!u.cards[b.card]) return fail('Carte non possédée');
      u.fav = u.fav.includes(b.card) ? u.fav.filter((x) => x !== b.card) : [...u.fav, b.card];
    } else if (b.action === 'report') {
      const text = String(b.text || '').trim().slice(0, 500);
      if (text.length < 5) return fail('Décris le problème (5 caractères minimum)');
      const r = (await redis.get('reports')) || [];
      r.unshift({ id: Date.now(), pseudo: u.pseudo, text, t: Date.now() });
      await redis.set('reports', r.slice(0, 100));
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
      let win, mult;
      if (k === 'red') { win = red; mult = 2.5; } else if (k === 'black') { win = n > 0 && !red; mult = 2.5; }
      else if (k === 'even') { win = n > 0 && n % 2 === 0; mult = 2.5; } else if (k === 'odd') { win = n % 2 === 1; mult = 2.5; }
      else if (k === 'dozen' && v <= 2) { win = n > 0 && Math.floor((n - 1) / 12) === v; mult = 3.7; }
      else if (k === 'num') { win = n === v; mult = 43; } else return fail('Pari inconnu');
      const gain = win ? Math.floor(a * mult) : 0;
      u.coins += gain - a; extra = { n, red, win, gain, bet: a };
    } else if (b.action === 'betend') {
      const g = await redis.get('g:' + b.gid);
      if (!g || g.p !== u.pseudo) return fail('Partie introuvable');
      await redis.del('g:' + b.gid);
      const el = (Date.now() - g.t) / 1000, sn = g.game === 'snake';
      const sc = Math.min(int(b.score, 10000), sn ? Math.floor(el / 0.8) : Math.floor(el / 2.5));
      const m = sn ? Math.min(4, Math.max(0, (sc - 5) / 10)) : Math.min(4, Math.max(0, (sc - 3) / 6));
      const gain = Math.floor(g.bet * m);
      u.coins += gain; extra = { gain, score: sc };
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
      if (!ids.length || ids.some((id) => !u.cards[id])) return fail('Collection incomplète');
      const gain = Math.floor(ids.reduce((a, id) => a + val(u, id, cat, cu), 0) / 5);
      for (const id of Object.keys(u.cards)) if (id.startsWith(t + ':')) rm(u, id, u.cards[id]);
      (u.rb ||= {})[t] = (u.rb[t] || 0) + 1; u.coins += gain; extra = { gain };
    } else if (b.action === 'rank') {
      const names = await redis.smembers('users'), list = names.length ? await redis.mget(...names.map(key)) : [];
      extra = { rank: list.filter(Boolean).map((v) => {
        const n = { l: 0, e: 0, r: 0, c: 0 };
        for (const id of Object.keys(v.cards || {})) { const r = rarOf(cat, id); if (n[r] != null && !id.startsWith('obj:')) n[r]++; }
        return { pseudo: v.pseudo, ...n, rb: Object.values(v.rb || {}).reduce((a, x) => a + x, 0), coins: v.coins };
      }).sort((a, b) => b.rb - a.rb || b.l - a.l || b.e - a.e || b.r - a.r || b.c - a.c || b.coins - a.coins).slice(0, [5, 10].includes(+b.n) ? +b.n : 10000) };
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
      extra = { peek: { pseudo: v.pseudo, cards: v.cards || {} } };
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
          if (t === 'obj' || !sh[t]) return fail("Ce sachet n'existe pas");
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
      note(v, '🎁 ' + u.pseudo + " t'a offert " + what + (txt ? ' — « ' + txt + ' »' : ''));
      await redis.set(key(v.pseudo), v);
      extra = { gifted: what, to: v.pseudo };
    } else if (b.action === 'tradeoffer') {
      const gv = b.give, w = String(b.want || '');
      if (!u.cards[gv]) return fail('Carte non possédée');
      if (!rarOf(cat, w) || w.startsWith('obj:') || gv === w) return fail('Carte demandée invalide');
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
      if (tv) { note(tv, '🔁 ' + u.pseudo + ' te propose : ' + cn(gv) + ' contre ' + cn(w)); await redis.set(key(tv.pseudo), tv); }
      else await bcast('🔁 Nouvel échange : ' + cn(gv) + ' contre ' + cn(w), u.pseudo);
    } else if (b.action === 'tradeaccept') {
      const x = mk.find((y) => y.id === b.id && y.want);
      if (!x) return fail('Offre déjà acceptée ou retirée');
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
      if (v) { note(v, '💬 ' + u.pseudo + ' demande +' + ask + ' 🪙 en plus pour ' + cn(x.card) + ' contre ' + cn(x.want)); await redis.set(key(v.pseudo), v); }
    } else if (b.action === 'tradeconfirm') {
      const x = mk.find((y) => y.id === b.id && y.want && y.seller === u.pseudo && y.ask);
      if (!x) return fail('Contre-offre introuvable');
      if (u.coins < x.ask) return fail('Pas assez de coins');
      const v = await redis.get(key(x.to));
      if (!v || !v.cards[x.want]) return fail("Ce joueur n'a plus la carte demandée : retire l'offre");
      mk = mk.filter((y) => y !== x); await redis.set('market', mk);
      u.coins -= x.ask; rm(v, x.want, 1); add(u, x.want, 1); add(v, x.card, 1); v.coins += x.ask;
      note(v, '✅ ' + u.pseudo + ' a accepté ta contre-offre (+' + x.ask + ' 🪙) : tu reçois ' + cn(x.card)); await redis.set(key(v.pseudo), v);
    } else if (b.action === 'tradedecline') {
      const x = mk.find((y) => y.id === b.id && y.want && y.to === u.pseudo);
      if (!x) return fail('Offre introuvable');
      mk = mk.filter((y) => y !== x); await redis.set('market', mk);
      const v = await redis.get(key(x.seller));
      if (v) { add(v, x.card, 1); note(v, '❌ ' + u.pseudo + ' a refusé ton échange : ta carte t\'est rendue'); await redis.set(key(v.pseudo), v); }
    } else if (b.action === 'unlist') {
      const x = mk.find((y) => y.id === b.id && y.seller === u.pseudo);
      if (!x) return fail('Annonce introuvable');
      mk = mk.filter((y) => y !== x); add(u, x.card, 1);
      await redis.set('market', mk);
    } else if (b.action === 'buymk') {
      const x = mk.find((y) => y.id === b.id);
      if (!x) return fail('Annonce déjà vendue ou retirée');
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
    } else if (b.action !== 'me') return fail('Action inconnue');

    if (b.action === 'me') { extra = { notifs: u.notifs }; u.notifs = []; }
    await redis.set(key(u.pseudo), u);
    return ok({ ...extra, state: { ...view(u, sh, cat, cu, mk), maint: maintOn } });
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
