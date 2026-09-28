function rng(s){return function(){s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const DIRS=[[0,-1],[1,0],[0,1],[-1,0]];
function snakeFood(g){let x,y;do{x=Math.floor(g.r()*g.n);y=Math.floor(g.r()*g.n)}while(g.s.some(c=>c[0]===x&&c[1]===y));return[x,y]}
function snakeNew(seed){const g={n:20,r:rng(seed),s:[[10,10],[9,10],[8,10]],d:[1,0],a:0,over:false};g.f=snakeFood(g);return g}
function snakeStep(g,d){if(d&&(d[0]+g.d[0]||d[1]+g.d[1]))g.d=d;const h=[g.s[0][0]+g.d[0],g.s[0][1]+g.d[1]];if(h[0]<0||h[1]<0||h[0]>=g.n||h[1]>=g.n||g.s.slice(0,-1).some(c=>c[0]===h[0]&&c[1]===h[1])){g.over=true;return}g.s.unshift(h);if(h[0]===g.f[0]&&h[1]===g.f[1]){g.a++;g.f=snakeFood(g)}else g.s.pop()}
function snakeRun(seed,moves,ticks){const m={};for(const e of moves||[])if(Array.isArray(e)&&Number.isInteger(e[0])&&e[1]>=0&&e[1]<4)m[e[0]]=e[1];const g=snakeNew(seed);for(let t=0;t<ticks&&!g.over;t++)snakeStep(g,m[t]===undefined?null:DIRS[m[t]]);return g.a}
module.exports = { snakeRun };
