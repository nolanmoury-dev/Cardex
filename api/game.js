const crypto = require('crypto');
const T0 = require('./cards');

let redis;
const W = { c: 60, r: 25, e: 11, l: 4 }, BASE = { c: 2, r: 8, e: 25, l: 80 }, R = 'crel';
const STEP = 10 * 60 * 1000, DAY = 864e5, MAXP = 10, PRICE = 100, PACK = 5;
const OP_ID = (process.env.OPERATOR_ID || 'operateur').toLowerCase();
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

function note(u, text) {
  (u.notifs ||= []).push(text);
  (u.inbox ||= []).unshift({ id: Date.now() + Math.random().toString(36).slice(2, 6), text, t: Date.now() });
  u.inbox = u.inbox.slice(0, 30);
}
function tick(u) {
  const now = Date.now();
  if (u.packs >= MAXP) { u.last = now; return; }
  const n = Math.floor((now - u.last) / STEP);
  if (n > 0) { u.packs = Math.min(MAXP, u.packs + n); u.last = u.packs >= MAXP ? now : u.last + n * STEP; }
}
const shopOf = async (cat) => {
  const s = (await redis.get('shop')) || {};
  return Object.fromEntries(Object.entries(cat).filter(([, o]) => live(o)).map(([t]) => [t, { discount: int(s[t] && s[t].discount, 90), blocked: !!(s[t] && s[t].blocked) }]));
};
const price = (sh) => Math.round((PRICE * (100 - sh.discount)) / 100);
const view = (u, sh, cat, cu, mk) => ({
  market: mk || [], inbox: u.inbox || [],
  pseudo: u.pseudo, coins: u.coins, packs: u.packs, bought: u.bought || {},
  next: u.packs >= MAXP ? null : u.last + STEP, cards: u.cards, fav: u.fav, theme: u.theme || null,
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

module.exports = async (req, res) => {
  const fail = (m, c = 400) => res.status(c).json({ error: m });
  const ok = (d) => res.status(200).json(d);
  if (req.method !== 'POST') return fail('POST uniquement', 405);
  const b = req.body || {};
  try {
    if (!redis) {
      const url = envFind(/(REST_API_URL|REDIS_REST_URL)$/), token = envFind(/(REST_API_TOKEN|REDIS_REST_TOKEN)$/);
      if (!url || !token) return fail('Base de données non reliée : dans Vercel, ajoute Upstash Redis au projet (Storage > Connect Project), puis fais Redeploy', 500);
      redis = new (require('@upstash/redis').Redis)({ url, token });
    }

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
      let u = await redis.get(key(pseudo));
      if (b.action === 'register') {
        if (u || pseudo.toLowerCase() === OP_ID) return fail('Ce pseudo est déjà pris');
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
      s = { p: OP_ID };
      if (!(await redis.get(key(OP_ID)))) {
        const salt = crypto.randomBytes(16).toString('hex'), nm = OP_ID[0].toUpperCase() + OP_ID.slice(1);
        await redis.set(key(nm), { pseudo: nm, salt, hash: hash(crypto.randomBytes(8).toString('hex'), salt), coins: 200, packs: 1, bought: {}, last: Date.now(), cards: {}, since: {}, fav: [], notifs: [] });
        await redis.sadd('users', nm);
      }
    }

    if (s.op) {
      if (b.action === 'users') {
        const names = (await redis.smembers('users')).sort();
        const list = names.length ? await redis.mget(...names.map(key)) : [];
        const users = list.filter(Boolean).map((u) => { tick(u); return { pseudo: u.pseudo, coins: u.coins, packs: u.packs, bought: u.bought || {}, cards: u.cards }; });
        return ok({ users, shop: await shopOf(cat), custom: cu, reports: (await redis.get('reports')) || [], themes: cat });
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
        const o = { key: 'x' + Date.now(), name, icon: String(b.icon || '').trim().slice(0, 4) || '⭐', color: '#0ea5e9', until: Date.now() + Math.max(1, int(b.days, 365) || 7) * DAY, c: [], r: [], e: [], l: [] };
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
    } else if (b.action === 'unlist') {
      const x = mk.find((y) => y.id === b.id && y.seller === u.pseudo);
      if (!x) return fail('Annonce introuvable');
      mk = mk.filter((y) => y !== x); add(u, x.card, 1);
      await redis.set('market', mk);
    } else if (b.action === 'buymk') {
      const x = mk.find((y) => y.id === b.id);
      if (!x) return fail('Annonce déjà vendue ou retirée');
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
    return ok({ ...extra, state: view(u, sh, cat, cu, mk) });
  } catch (e) {
    console.error(e);
    return fail('Erreur serveur : ' + e.message, 500);
  }
};
