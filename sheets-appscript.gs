/**
 * Recebe uma venda OU um reembolso do servidor de tracking (server.js → webhook Kiwify)
 * e grava na aba VENDAS do Painel_Infoprodutos.
 *
 * UPSERT por order_id:
 *  - order_id NOVO  → APPEND (nova linha) e replica as fórmulas da linha de cima.
 *  - order_id EXISTE → UPDATE da linha original (reembolso, mudança de status pix→paid,
 *    funds_status, etc.) — sobrescreve só os campos que vieram preenchidos no webhook,
 *    NÃO cria linha duplicada e NÃO toca nas colunas de fórmula.
 *
 * Preenche SÓ as colunas de dados brutos; as colunas de fórmula (Valor Bruto R$, Origem,
 * Tipo, Mês, _bump...) são preservadas.
 *
 * DEPLOY:
 * 1. Planilha → Extensões → Apps Script → cola este código (substitui tudo) → salvar.
 * 2. Ajuste SECRET abaixo (mesmo valor da env SHEETS_SECRET no servidor).
 * 3. Implantar → Gerenciar implantações → (editar a implantação atual) → Versão: Nova versão
 *    → Implantar.  Isso MANTÉM a mesma URL /exec (não precisa mexer no server).
 */

const SHEET_NAME = '📥 VENDAS';               // nome exato da aba (confirmado)
const SECRET     = 'TROQUE_POR_UM_SEGREDO';   // <-- mesmo valor da env SHEETS_SECRET

// cabeçalho da planilha (normalizado) -> chave que o servidor envia.
// Só estas colunas são preenchidas; qualquer outra é fórmula e fica intocada.
const HEADER_TO_KEY = {
  'order id':          'order_id',
  'order ref':         'order_ref',
  'approved date':     'approved_date',
  'order status':      'order_status',
  'payment method':    'payment_method',
  'product name':      'product_name',
  'product id':        'product_id',
  'charge amount':     'charge_amount_cents',   // "charge_amount (¢)" — CENTAVOS
  'kiwify fee':        'kiwify_fee_cents',      // "kiwify_fee (¢)"   — CENTAVOS
  'my commission':     'my_commission_cents',   // "my_commission (¢)"— CENTAVOS
  'funds status':      'funds_status',
  'cliente nome':      'cliente_nome',
  'cliente email':     'cliente_email',
  'cliente telefone':  'cliente_telefone',
  'cliente cpf':       'cliente_cpf',
  'cliente pais':      'cliente_pais',
  'sck':               'sck',
  'utm source':        'utm_source',
  'utm medium':        'utm_medium',
  'utm campaign':      'utm_campaign',
  'utm content':       'utm_content',
  'utm term':          'utm_term',
  'fbclid':            'fbclid'
};

function norm(s){
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g,'')
    .toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}

function doPost(e){
  var lock = LockService.getScriptLock();
  try{
    lock.waitLock(20000); // evita 2 webhooks simultâneos na mesma linha
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if(SECRET && body.secret !== SECRET) return json({ok:false, error:'unauthorized'});

    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if(!sh) return json({ok:false, error:'sheet_not_found', looked_for:SHEET_NAME});

    var lastCol = sh.getLastColumn();
    var headers = sh.getRange(1,1,1,lastCol).getValues()[0];

    // mapeia cada coluna -> key (uma vez) e acha a coluna do order_id
    var colKey = [];
    var orderIdCol = 0;
    for(var c=1;c<=lastCol;c++){
      var k = HEADER_TO_KEY[norm(headers[c-1])];
      colKey[c-1] = k;
      if(k === 'order_id') orderIdCol = c;
    }

    // varre a coluna order_id: conta linhas preenchidas e procura o order_id deste webhook
    var maxRows = sh.getMaxRows();
    var idVals = orderIdCol ? sh.getRange(2, orderIdCol, maxRows-1, 1).getValues() : [];
    var wantId = String(body.order_id || '').trim();
    var count = 0, foundRow = 0;
    for(var i=0;i<idVals.length;i++){
      var v = String(idVals[i][0]).trim();
      if(v !== ''){
        count++;
        if(wantId !== '' && foundRow === 0 && v === wantId) foundRow = 2 + i;
      }
    }

    var isUpdate  = foundRow > 0;                 // order_id já existe → atualiza
    var targetRow = isUpdate ? foundRow : (2 + count);
    if(!isUpdate && targetRow > maxRows){ sh.insertRowAfter(maxRows); }

    for(var c=1;c<=lastCol;c++){
      var key = colKey[c-1];
      var cell = sh.getRange(targetRow, c);
      if(key){
        if(isUpdate){
          // update: só sobrescreve o que veio preenchido (não apaga dado com "")
          if(body[key] !== undefined && body[key] !== null && body[key] !== '') cell.setValue(body[key]);
        } else {
          var v = (body[key] !== undefined && body[key] !== null) ? body[key] : '';
          cell.setValue(v);
        }
      } else if(!isUpdate && !cell.getFormula() && targetRow > 2){
        // append em coluna de fórmula sem fórmula nesta linha → replica a de cima
        sh.getRange(targetRow-1, c).copyTo(cell, {contentsOnly:false});
      }
    }
    return json({ok:true, mode: isUpdate ? 'updated' : 'appended', row:targetRow});
  }catch(err){
    return json({ok:false, error:String(err)});
  }finally{
    try{ lock.releaseLock(); }catch(e){}
  }
}

function json(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
