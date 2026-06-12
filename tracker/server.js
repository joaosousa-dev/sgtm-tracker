const http = require('http');
const crypto = require('crypto');
const { createClient } = require('redis');

const PORT = 3000;
const TTL = 45 * 24 * 60 * 60;
const PIXEL_ID = process.env.PIXEL_ID || '';
const CAPI_TOKEN = process.env.CAPI_TOKEN || '';
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const GRAPH = 'https://graph.facebook.com/v21.0/' + PIXEL_ID + '/events';

const redis = createClient({ url: REDIS_URL });
redis.on('error', function(e){ console.error('[redis]', e.message); });
redis.connect().then(function(){ console.log('[redis] connected'); }).catch(function(e){ console.error('[redis] connect fail', e.message); });

function sha256(v){ if(!v) return undefined; return crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex'); }
function digits(v){ return v ? String(v).replace(/[^0-9]/g,'') : undefined; }
function clean(o){ var r={}; for(var k in o){ var x=o[k]; if(x!==undefined && x!==null && x!=='') r[k]=x; } return r; }
function validSck(s){ return typeof s==='string' && /^[A-Za-z0-9_-]{8,64}$/.test(s); }

function send(res, code, body){
  res.writeHead(code, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'POST, GET, OPTIONS'});
  res.end(JSON.stringify(body));
}
function readBody(req){
  return new Promise(function(resolve){ var d=''; req.on('data',function(c){ d+=c; if(d.length>1000000) req.destroy(); }); req.on('end',function(){ try{ resolve(JSON.parse(d||'{}')); }catch(e){ resolve({raw:d}); } }); });
}

const server = http.createServer(async function(req,res){
  var url; try{ url = new URL(req.url,'http://x'); }catch(e){ return send(res,400,{error:'bad_url'}); }
  var path = url.pathname;
  var ip = String(req.headers['x-forwarded-for']||'').split(',')[0].trim() || (req.socket.remoteAddress||'');
  var ua = req.headers['user-agent']||'';

  if(req.method==='OPTIONS') return send(res,204,{});
  if(path==='/tracker-health') return send(res,200,{ok:true, pixel: PIXEL_ID?'set':'missing', token: CAPI_TOKEN?'set':'missing'});

  if(path==='/sck' && req.method==='POST'){
    var b = await readBody(req);
    var sck = validSck(b.sck) ? b.sck : crypto.randomBytes(9).toString('base64url');
    var rec = clean({ fbc:b.fbc, fbp:b.fbp, fbclid:b.fbclid, utm_source:b.utm_source, utm_medium:b.utm_medium, utm_campaign:b.utm_campaign, utm_term:b.utm_term, utm_content:b.utm_content, ip:ip, ua:ua, ts: Math.floor(Date.now()/1000) });
    try{ await redis.set('sck:'+sck, JSON.stringify(rec), {EX:TTL}); return send(res,200,{sck:sck}); }
    catch(e){ console.error('[sck] store fail', e.message); return send(res,500,{error:'store_failed'}); }
  }

  if(path==='/webhook/kiwify' && req.method==='POST'){
    var b = await readBody(req);
    try{ await redis.set('last_webhook', JSON.stringify(b), {EX: 604800}); }catch(e){}
    console.log('[webhook] payload', JSON.stringify(b).slice(0,3000));

    var tp = b.TrackingParameters || b.tracking_parameters || b.tracking || {};
    var sck = tp.sck || tp.src || b.sck || b.src;
    var cust = b.Customer || b.customer || {};
    var order = b.order || {};
    var order_id = b.order_id || b.order_ref || order.id || b.id;
    var email = cust.email || b.email;
    var phone = cust.mobile || cust.phone || cust.phone_number;
    var fullName = cust.full_name || cust.name || ((cust.first_name||'')+' '+(cust.last_name||'')).trim();
    var parts = String(fullName||'').trim().split(/\s+/).filter(Boolean);
    var firstName = cust.first_name || parts[0]; var lastName = parts.length>1 ? parts.slice(1).join(' ') : undefined;
    var custIp = cust.ip;
    var prod = b.Product || b.product || {};
    var productId = prod.product_id || prod.id;
    var productName = prod.product_name || prod.name;
    var comm = b.Commissions || b.commissions || {};
    var amount = comm.charge_amount || comm.product_base_price || order.amount || b.charge_amount;
    var value = amount!=null ? Number(amount)/100 : undefined;

    var rec = {};
    if(sck){ try{ var r = await redis.get('sck:'+sck); if(r) rec = JSON.parse(r); }catch(e){} }

    var user_data = clean({
      em: email? [sha256(email)] : undefined,
      ph: phone? [sha256(digits(phone))] : undefined,
      fn: firstName? [sha256(firstName)] : undefined,
      ln: lastName? [sha256(lastName)] : undefined,
      client_ip_address: rec.ip || custIp,
      client_user_agent: rec.ua,
      fbc: rec.fbc,
      fbp: rec.fbp
    });

    var event = {
      event_name: 'Purchase',
      event_time: Math.floor(Date.now()/1000),
      event_id: order_id || sck,
      action_source: 'website',
      user_data: user_data,
      custom_data: clean({ currency:'BRL', value:value, content_ids: productId?[productId]:undefined, content_name: productName, content_type:'product', order_id:order_id, product_id: productId })
    };

    if(!CAPI_TOKEN || !PIXEL_ID){ console.error('[webhook] missing pixel/token'); return send(res,200,{received:true, capi:'skipped_no_token', event:event}); }
    try{
      var resp = await fetch(GRAPH + '?access_token=' + encodeURIComponent(CAPI_TOKEN), { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({data:[event]}) });
      var out = await resp.json();
      console.log('[webhook] capi', resp.status, JSON.stringify(out).slice(0,800));
      return send(res,200,{received:true, capi: out});
    }catch(e){ console.error('[webhook] capi fail', e.message); return send(res,200,{received:true, capi:'error', msg:e.message}); }
  }

  return send(res,404,{error:'not_found'});
});
server.listen(PORT, function(){ console.log('[tracker] listening on '+PORT); });
