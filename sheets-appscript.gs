/**
 * Recebe uma venda do servidor de tracking (server.js → webhook Kiwify) e grava
 * na aba VENDAS do Painel_Infoprodutos. Preenche SÓ as colunas de dados brutos;
 * as colunas de fórmula (Valor Bruto R$, Origem, Tipo, Mês, _bump...) são preservadas
 * (copia a fórmula da linha de cima quando a linha ainda não tem — passa de 500 vendas).
 *
 * DEPLOY:
 * 1. Planilha → Extensões → Apps Script → cola este código (substitui tudo).
 * 2. Ajuste SECRET abaixo (mesmo valor da env SHEETS_SECRET no servidor).
 * 3. Implantar → Nova implantação → App da Web → Executar como: Eu | Acesso: Qualquer pessoa.
 * 4. Autorize e copie a URL /exec → vai na env SHEETS_URL do servidor.
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
    lock.waitLock(20000); // evita 2 vendas simultâneas escreverem na mesma linha
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if(SECRET && body.secret !== SECRET) return json({ok:false, error:'unauthorized'});

    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if(!sh) return json({ok:false, error:'sheet_not_found', looked_for:SHEET_NAME});

    var lastCol = sh.getLastColumn();
    var headers = sh.getRange(1,1,1,lastCol).getValues()[0];

    // próxima linha = após a última com order_id preenchido (col 1)
    var maxRows = sh.getMaxRows();
    var colA = sh.getRange(2,1,maxRows-1,1).getValues();
    var count = 0;
    for(var i=0;i<colA.length;i++){ if(String(colA[i][0]).trim() !== '') count++; }
    var targetRow = 2 + count;
    if(targetRow > maxRows){ sh.insertRowAfter(maxRows); }

    for(var c=1;c<=lastCol;c++){
      var key = HEADER_TO_KEY[norm(headers[c-1])];
      var cell = sh.getRange(targetRow, c);
      if(key){
        var v = (body[key] !== undefined && body[key] !== null) ? body[key] : '';
        cell.setValue(v);
      } else if(!cell.getFormula() && targetRow > 2){
        // coluna de fórmula sem fórmula nesta linha → replica a de cima (ajusta refs)
        sh.getRange(targetRow-1, c).copyTo(cell, {contentsOnly:false});
      }
    }
    return json({ok:true, appended:true, row:targetRow});
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
