const { Redis } = require('@upstash/redis');
const crypto = require('crypto');
const T = require('./cards');

const redis = Redis.fromEnv();
const W = { c: 60, r: 25, e: 11, l: 4 };
const STEP = 10 * 60 * 1000, MAXP = 10, PRICE = 100, PACK = 5;
const OP_ID = (process.env.OPERATOR_ID || '').toLowerCase();
const OP_CODE = process.env.OPERATOR_CODE || '';
const key = (p) => 'u:' + p.toLowerCase();
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const allIds = () => Object.entries(T).flatMap(([t, o]) => 'crel'.split('').flatMap((r) => o[r].map((n) => t + ':' + n)));
const int = (v, max = 1e6) => Math.max(0, Math.min(max, parseInt(v, 10) || 0));

function tick(u) {
  const now = Date.now();
  if (u.packs >= MAXP) { u.last = now; return; }
  const n = Math.floor((now - u.last) / STEP);
  if (n > 0) {
    u.packs = Math.min(MAXP, u.packs + n);
    u.last = u.packs >= MAXP ? now : u.last + n * STEP;
  }
}
const view = (u) => ({ pseudo: u.pseudo, coins: u.coins, packs: u.packs, next: u.packs >= MAXP ? null : u.last + STEP, cards: u.cards });

function draw(theme) {
  const pool = T[theme];
  let x = Math.random() * 100, r = 'c';
  for (const k of 'crel') { if ((x -= W[k]) < 0) { r = k; break; } }
  const list = pool[r];
  return theme + ':' + list[Math.floor(Math.random() * list.length)];
}

module.exports = async (req, res) => {
  const fail = (m, c = 400) => res.status(c).json({ error: m });
  const ok = (d) => res.status(200).json(d);
  if (req.method !== 'POST') return fail('POST uniquement', 405);
  const b = req.body || {};
  try {
    if (b.action === 'catalog') return ok({ themes: T });

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
      if (pw.length < 4) return fail('Mot de passe : 4 caractères minimum');
      let u = await redis.get(key(pseudo));
      if (b.action === 'register') {
        if (u || pseudo.toLowerCase() === OP_ID) return fail('Ce pseudo est déjà pris');
        const salt = crypto.randomBytes(16).toString('hex');
        u = { pseudo, salt, hash: hash(pw, salt), coins: 200, packs: 1, last: Date.now(), cards: {} };
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
        return ok({ users: names });
      }
      if (b.action === 'give') {
        const u = await redis.get(key(String(b.pseudo || '')));
        if (!u) return fail('Joueur introuvable');
        tick(u);
        u.coins += int(b.coins);
        u.packs += int(b.packs, 1000);
        if (b.card) {
          if (!allIds().includes(b.card)) return fail('Carte inconnue');
          u.cards[b.card] = (u.cards[b.card] || 0) + 1;
        }
        await redis.set(key(u.pseudo), u);
        return ok({ done: true });
      }
      return fail('Action inconnue');
    }

    const u = await redis.get(key(s.p));
    if (!u) return fail('Session expirée, reconnecte-toi', 401);
    tick(u);

    if (b.action === 'buy') {
      if (u.coins < PRICE) return fail('Pas assez de coins');
      u.coins -= PRICE;
      u.packs += 1;
    } else if (b.action === 'open') {
      if (!T[b.theme]) return fail('Thème inconnu');
      if (u.packs < 1) return fail('Aucun sachet disponible');
      if (u.packs >= MAXP) u.last = Date.now();
      u.packs -= 1;
      const drawn = Array.from({ length: PACK }, () => draw(b.theme));
      drawn.forEach((id) => { u.cards[id] = (u.cards[id] || 0) + 1; });
      await redis.set(key(u.pseudo), u);
      return ok({ drawn, state: view(u) });
    } else if (b.action !== 'me') return fail('Action inconnue');

    await redis.set(key(u.pseudo), u);
    return ok({ state: view(u) });
  } catch (e) {
    console.error(e);
    return fail('Erreur serveur : ' + e.message, 500);
  }
};
