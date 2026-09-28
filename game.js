const crypto = require('crypto');
const T = require('./cards');

let redis;
const W = { c: 60, r: 25, e: 11, l: 4 };
const STEP = 10 * 60 * 1000, MAXP = 10, PRICE = 100, PACK = 5;
const OP_ID = (process.env.OPERATOR_ID || '').toLowerCase();
const OP_CODE = process.env.OPERATOR_CODE || '';
const themes = Object.keys(T);
const key = (p) => 'u:' + p.toLowerCase();
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const allIds = () => Object.entries(T).flatMap(([t, o]) => 'crel'.split('').flatMap((r) => o[r].map((n) => t + ':' + n)));
const int = (v, max = 1e6) => Math.max(0, Math.min(max, parseInt(v, 10) || 0));
const envFind = (re) => { const k = Object.keys(process.env).find((x) => re.test(x) && process.env[x]); return k && process.env[k]; };

function tick(u) {
  const now = Date.now();
  if (u.packs >= MAXP) { u.last = now; return; }
  const n = Math.floor((now - u.last) / STEP);
  if (n > 0) {
    u.packs = Math.min(MAXP, u.packs + n);
    u.last = u.packs >= MAXP ? now : u.last + n * STEP;
  }
}
const shopOf = async () => {
  const s = (await redis.get('shop')) || {};
  return Object.fromEntries(themes.map((t) => [t, { discount: int(s[t] && s[t].discount, 90), blocked: !!(s[t] && s[t].blocked) }]));
};
const price = (sh) => Math.round((PRICE * (100 - sh.discount)) / 100);
const view = (u, sh) => ({
  pseudo: u.pseudo, coins: u.coins, packs: u.packs, bought: u.bought || {},
  next: u.packs >= MAXP ? null : u.last + STEP, cards: u.cards,
  shop: Object.fromEntries(themes.map((t) => [t, { ...sh[t], price: price(sh[t]) }])),
});
function draw(theme) {
  let x = Math.random() * 100, r = 'c';
  for (const k of 'crel') { if ((x -= W[k]) < 0) { r = k; break; } }
  const list = T[theme][r];
  return theme + ':' + list[Math.floor(Math.random() * list.length)];
}

module.exports = async (req, res) => {
  const fail = (m, c = 400) => res.status(c).json({ error: m });
  const ok = (d) => res.status(200).json(d);
  if (req.method !== 'POST') return fail('POST uniquement', 405);
  const b = req.body || {};
  try {
    if (b.action === 'catalog') return ok({ themes: T });
    if (!redis) {
      const url = envFind(/(REST_API_URL|REDIS_REST_URL)$/), token = envFind(/(REST_API_TOKEN|REDIS_REST_TOKEN)$/);
      if (!url || !token) return fail("Base de données non reliée : dans Vercel, ajoute Upstash Redis au projet (Storage > Connect Project), puis fais Redeploy", 500);
      redis = new (require('@upstash/redis').Redis)({ url, token });
    }

    if (b.action === 'register' || b.action === 'login') {
      const pseudo = String(b.pseudo || '').trim();
      const pw = String(b.password || '');
      if (b.action === 'login' && OP_ID && pseudo.toLowerCase() === OP_ID) {
        if (pw !== OP_CODE) return fail('Identifiant ou code incorrect', 401);
        const token = crypto.randomBytes(24).toString('hex');
        await redis.set('s:' + token, { op: true }, { ex: 86400 * 7 });
        return ok({ token, op: true });
      }
      if (!/^[A-Za-z0-9_]{3,20}$/.test(pseudo)) return fail('Pseudo : 3 à 20 lettres, chiffres ou _');
      if (!pw) return fail('Entre un mot de passe');
      let u = await redis.get(key(pseudo));
      if (b.action === 'register') {
        if (u || pseudo.toLowerCase() === OP_ID) return fail('Ce pseudo est déjà pris');
        const salt = crypto.randomBytes(16).toString('hex');
        u = { pseudo, salt, hash: hash(pw, salt), coins: 200, packs: 1, bought: {}, last: Date.now(), cards: {} };
        await redis.set(key(pseudo), u);
        await redis.sadd('users', pseudo);
      } else if (!u || hash(pw, u.salt) !== u.hash) return fail('Pseudo ou mot de passe incorrect', 401);
      const token = crypto.randomBytes(24).toString('hex');
      await redis.set('s:' + token, { p: u.pseudo }, { ex: 86400 * 30 });
      return ok({ token });
    }

    const s = b.token && (await redis.get('s:' + b.token));
    if (!s) return fail('Session expirée, reconnecte-toi', 401);

    if (s.op) {
      if (b.action === 'users') {
        const names = (await redis.smembers('users')).sort();
        const list = names.length ? await redis.mget(...names.map(key)) : [];
        const users = list.filter(Boolean).map((u) => { tick(u); return { pseudo: u.pseudo, coins: u.coins, packs: u.packs, bought: u.bought || {}, cards: u.cards }; });
        return ok({ users, shop: await shopOf() });
      }
      if (b.action === 'shop') {
        if (!T[b.theme]) return fail('Thème inconnu');
        const cur = (await redis.get('shop')) || {};
        cur[b.theme] = { discount: int(b.discount, 90), blocked: !!b.blocked };
        await redis.set('shop', cur);
        return ok({ done: true });
      }
      if (b.action === 'give') {
        const u = await redis.get(key(String(b.pseudo || '')));
        if (!u) return fail('Joueur introuvable');
        tick(u);
        const sg = b.mode === 'take' ? -1 : 1;
        u.coins = Math.max(0, u.coins + sg * int(b.coins));
        u.packs = Math.max(0, u.packs + sg * int(b.packs, 1000));
        if (b.card) {
          if (!allIds().includes(b.card)) return fail('Carte inconnue');
          const n = (u.cards[b.card] || 0) + sg;
          if (n > 0) u.cards[b.card] = n; else delete u.cards[b.card];
        }
        await redis.set(key(u.pseudo), u);
        return ok({ done: true });
      }
      return fail('Action inconnue');
    }

    const u = await redis.get(key(s.p));
    if (!u) return fail('Session expirée, reconnecte-toi', 401);
    tick(u);
    u.bought ||= {};
    const sh = await shopOf();

    if (b.action === 'buy') {
      if (!T[b.theme]) return fail('Thème inconnu');
      if (sh[b.theme].blocked) return fail('Ce sachet est bloqué pour le moment');
      const p = price(sh[b.theme]);
      if (u.coins < p) return fail('Pas assez de coins');
      u.coins -= p;
      u.bought[b.theme] = (u.bought[b.theme] || 0) + 1;
    } else if (b.action === 'open') {
      if (!T[b.theme]) return fail('Thème inconnu');
      if (sh[b.theme].blocked) return fail('Ce sachet est bloqué pour le moment');
      if (u.bought[b.theme] > 0) u.bought[b.theme] -= 1;
      else if (u.packs > 0) u.packs -= 1;
      else return fail('Aucun sachet disponible');
      const drawn = Array.from({ length: PACK }, () => draw(b.theme));
      drawn.forEach((id) => { u.cards[id] = (u.cards[id] || 0) + 1; });
      await redis.set(key(u.pseudo), u);
      return ok({ drawn, state: view(u, sh) });
    } else if (b.action !== 'me') return fail('Action inconnue');

    await redis.set(key(u.pseudo), u);
    return ok({ state: view(u, sh) });
  } catch (e) {
    console.error(e);
    return fail('Erreur serveur : ' + e.message, 500);
  }
};
