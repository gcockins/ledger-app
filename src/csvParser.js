/**
 * csvParser.js — Universal Bank CSV Parser
 * Built from actual CSV files:
 *   Capital One (Checking & Savings): Account,Description,Date,Type,Amount,Balance
 *   Chase (Southwest CC):             Transaction Date,Post Date,Description,Category,Type,Amount,Memo
 *   Citi:                             Status,Date,Description,Debit,Credit,Member Name
 *   Discover:                         Trans. Date,Post Date,Description,Amount,Category
 *   Wells Fargo (Checking & Credit):  NO HEADERS — "Date","Amount","*","","Description"
 */

// ─── MONEY PARSER ─────────────────────────────────────────────────────────────
function parseMoney(s) {
  if (!s) return 0;
  s = String(s).trim().replace(/[$£€\s"]/g, '');
  if (!s || s === '-' || s === '*') return 0;
  const negative = s.startsWith('(') && s.endsWith(')');
  s = s.replace(/[()]/g, '').replace(/,/g, '');
  const val = parseFloat(s);
  return isNaN(val) ? 0 : (negative ? -val : val);
}

// ─── DATE PARSER ─────────────────────────────────────────────────────────────
function parseDate(s) {
  if (!s) return null;
  s = String(s).trim().replace(/"/g, '');
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const [m, d, y] = s.split('/');
    return new Date(+y, +m - 1, +d);
  }
  if (/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(s)) {
    const [m, d, y] = s.split('/');
    const fullYear = +y < 50 ? 2000 + +y : 1900 + +y;
    return new Date(fullYear, +m - 1, +d);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00');
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// ─── CSV LINE SPLITTER ────────────────────────────────────────────────────────
function splitCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// ─── PER-BANK ROW PARSERS ─────────────────────────────────────────────────────
function parseCapitalOne(headers, cols) {
  const desc    = cols[headers.indexOf('transaction description')] || '';
  const dateStr = cols[headers.indexOf('transaction date')] || '';
  const type    = (cols[headers.indexOf('transaction type')] || '').trim().toLowerCase();
  const amt     = parseMoney(cols[headers.indexOf('transaction amount')]);
  const amount  = type === 'debit' ? -Math.abs(amt) : Math.abs(amt);
  return { desc, dateStr, amount };
}

function parseChase(headers, cols) {
  const desc    = cols[headers.indexOf('description')] || '';
  const dateStr = cols[headers.indexOf('transaction date')] || '';
  const amount  = parseMoney(cols[headers.indexOf('amount')]);
  return { desc, dateStr, amount };
}

function parseCiti(headers, cols) {
  const desc    = cols[headers.indexOf('description')] || '';
  const dateStr = cols[headers.indexOf('date')] || '';
  const debit   = parseMoney(cols[headers.indexOf('debit')]);
  const credit  = parseMoney(cols[headers.indexOf('credit')]);
  const amount  = credit > 0 ? credit : -debit;
  return { desc, dateStr, amount };
}

function parseDiscover(headers, cols) {
  const dateIdx = headers.findIndex(h => h.includes('trans'));
  const desc    = cols[headers.indexOf('description')] || '';
  const dateStr = cols[dateIdx >= 0 ? dateIdx : 0] || '';
  const rawAmt  = parseMoney(cols[headers.indexOf('amount')]);
  // Discover: positive=charge (expense), negative=payment/credit
  const amount  = rawAmt > 0 ? -rawAmt : Math.abs(rawAmt);
  return { desc, dateStr, amount };
}

function parseWellsFargo(cols) {
  const dateStr = (cols[0] || '').replace(/"/g, '').trim();
  const amount  = parseMoney(cols[1]);
  const desc    = (cols[4] || cols[2] || '').replace(/"/g, '').trim();
  return { desc, dateStr, amount };
}

function parseGeneric(headers, cols) {
  const dateIdx  = headers.findIndex(h => h.includes('date'));
  const descIdx  = headers.findIndex(h => h.includes('desc') || h.includes('memo') || h.includes('name') || h.includes('payee'));
  const amtIdx   = headers.findIndex(h => h === 'amount' || h === 'transaction amount');
  const debitIdx = headers.findIndex(h => h.includes('debit') || h.includes('withdrawal'));
  const creditIdx= headers.findIndex(h => h.includes('credit') || h.includes('deposit'));

  let amount = 0;
  if (amtIdx >= 0) {
    amount = parseMoney(cols[amtIdx]);
  } else if (debitIdx >= 0 || creditIdx >= 0) {
    const d = debitIdx >= 0 ? parseMoney(cols[debitIdx]) : 0;
    const c = creditIdx >= 0 ? parseMoney(cols[creditIdx]) : 0;
    amount = c > 0 ? c : -d;
  }
  return {
    dateStr: dateIdx >= 0 ? cols[dateIdx] : '',
    desc:    descIdx >= 0 ? cols[descIdx] : cols[1] || '',
    amount,
  };
}

// ─── BANK DETECTION ───────────────────────────────────────────────────────────
function detectBank(headers) {
  const h = headers.join(',');
  if (h.includes('transaction description') && h.includes('transaction type') && h.includes('transaction amount'))
    return 'capital_one';
  if (h.includes('transaction date') && h.includes('post date') && h.includes('memo'))
    return 'chase';
  if (h.includes('status') && h.includes('debit') && h.includes('credit') && h.includes('member name'))
    return 'citi';
  if (h.includes('trans. date') || (h.includes('trans') && h.includes('post date') && h.includes('category')))
    return 'discover';
  return 'generic';
}

// ─── HARD-CODED MERCHANT MAP ──────────────────────────────────────────────────
// Derived from actual transaction history. Checked first before keyword rules.
// Keys are lowercased substrings — first match wins.
const MERCHANT_MAP = {
  // Coffee / Tea
  'nespresso usa':           'Coffee / Tea',
  'tea be honest':           'Coffee / Tea',
  'buena matcha':            'Coffee / Tea',
  'dutch bros':              'Coffee / Tea',
  'koffi':                   'Coffee / Tea',
  // Landscape
  'cortez landscape':        'Landscape',
  // Utilities
  'nexgen air conditioning': 'Utilities',
  'scgc':                    'Utilities',
  'so cal edison':           'Utilities',
  'coachella valley water':  'Utilities',
  'coachella valley billpay':'Utilities',
  // Food — local merchants
  'aldi ':                   'Food',
  'staterbros':              'Food',
  'alkobar quick stop':      'Food',
  'otori japanese':          'Food',
  'pier 88':                 'Food',
  'rubios':                  'Food',
  'baskin':                  'Food',
  'nayax vending':           'Food',
  'hamachi cathedral':       'Food',
  'el pollo loco':           'Food',
  'habit cathedral':         'Food',
  'beach house yogurt':      'Food',
  'brandini toffee':         'Food',
  'thrive market':           'Food',
  'thrivemarke':             'Food',
  'p.f. chang':              'Food',
  'pf chang':                'Food',
  'wm supercenter':          'Food',
  'longhorn stk':            'Food',
  'da andrea':               'Food',
  'chick-fil-a':             'Food',
  'in-n-out':                'Food',
  // Entertainment
  'cinemark':                'Entertainment',
  'spo cacsports':           'Entertainment',
  'palm spring lanes':       'Entertainment',
  'desertcrossing':          'Entertainment',
  'tiqets':                  'Entertainment',
  'nintendo':                'Entertainment',
  'big league dreams':       'Entertainment',
  // Shopping
  'homegoods':               'Shopping',
  'hobby-lobby':             'Shopping',
  'hobby lobby':             'Shopping',
  'ulta ':                   'Shopping',
  'sephora':                 'Shopping',
  'anthropologie':           'Shopping',
  'thursday boot':           'Shopping',
  'pypl payin4':             'Shopping',
  'sheinusserv':             'Shopping',
  'oldnavy.com':             'Shopping',
  "children's place":        'Shopping',
  'world market':            'Shopping',
  'kiehls':                  'Shopping',
  "kiehl's":                 'Shopping',
  'www.boxlunchgives':       'Shopping',
  'etsy ':                   'Shopping',
  'marshalls':               'Shopping',
  'teamfanshop':             'Shopping',
  'untuckit':                'Shopping',
  'mathis home':             'Shopping',
  'calvin klein':            'Shopping',
  'daiso':                   'Shopping',
  'sp *casely':              'Shopping',
  'sp+aff brighton':         'Shopping',
  'sp+aff mattel':           'Shopping',
  // Transport
  'tmna subscription':       'Transport',
  'mohica towing':           'Transport',
  'the toll roads':          'Transport',
  // Giving
  'tithe.ly':                'Giving',
  'reveal churc':            'Giving',
  'thegardenfellowship':     'Giving',
  "nbs*king's":              'Giving',
  '99pledg':                 'Giving',
  // CC Payment
  'payment thank you':       'CC Payment',
  'returned payment':        'CC Payment',
  'automatic payment':       'CC Payment',
  'target card srvc':        'CC Payment',
  'target card payment':     'CC Payment',
  'target card services':    'CC Payment',
  'discover e-payment':      'CC Payment',
  'wf credit card':          'CC Payment',
  'chase credit card':       'CC Payment',
  'citi autopay':            'CC Payment',
  // Side Income
  'atm cash deposit':        'Side Income',
};

// ─── CATEGORIZER ─────────────────────────────────────────────────────────────
// Income subcategory rules — checked FIRST, only when amount > 0
const INCOME_RULES = [
  { category: 'W2 Payroll', keywords: [
    'payroll','direct deposit','kings sch','best western','1-hr service','1-hr serv',
    'ach credit payroll','salary','wage','dir dep',
  ]},
  { category: 'Interest/Dividends', keywords: [
    'interest paid','interest earned','dividend','rewards credit',
  ]},
  { category: 'Transfer Received', keywords: [
    'zelle money received','paypal from','venmo from',
  ]},
  { category: 'Side Income', keywords: [
    'check deposit','mobile deposit','cash deposit',
  ]},
];

// Transfers that look like income (positive) but are NOT — exclude from income
const SAVINGS_TRANSFER_KEYWORDS = [
  'deposit from 360','withdrawal from 360','from 360 performance',
  'car charger investment','property tax','final yard payment',
  'deposit from capital one savings','transfer from savings',
  'zelle money received from alexa',  // self-transfer
];

const EXPENSE_RULES = [
  { category: 'Housing', keywords: [
    'newrez','shellpoint','mortgage','coachella valley billpay','le campanile col',
    'socalgaS','scgc','so cal edison','sce ','edison co','pg&e','water bill','sewer',
    'trash','waste','rent','hoa ','home insurance','renters',
  ]},
  { category: 'Transport', keywords: [
    'toyota ach','car payment','auto loan','shell','chevron','bp ','exxon','mobil',
    'arco','circle k','wawa','speedway','fuel','gas station','ca dmv','dmv',
    'uber','lyft','parking','toll','autozone','jiffy lube','firestone','goodyear',
    'mohica towing','towing','airline','southwest air','delta','united air','american air',
  ]},
  { category: 'Food', keywords: [
    'mcdonald','starbucks','cardenas','doordash','ubereats','grubhub','pizza',
    'koffi','castaneda','vienna donut','bakery','deli','firehouse','taco bell',
    'del taco','chipotle','panera','subway','chick-fil','in-n-out','jack in the box',
    'sonic','applebee','olive garden','ihop','denny','waffle house','wendys',
    'burger king','five guys','shake shack','panda','da andrea','restaurant',
    'dining','cafe ','coffee','costco','trader joe','sprouts farmers','safeway',
    'kroger','whole foods','vons','ralphs','albertson','food 4 less','smart final',
    'grocery','groceries',
  ]},
  { category: 'Healthcare', keywords: [
    'fit in 42','kp scal','kaiser','doctor','hospital','pharmacy','cvs','walgreens',
    'rite aid','dental','vision','optometrist','medical','urgent care','clinic',
    'labcorp','therapist','counseling','chiropractor','physical therapy',
  ]},
  { category: 'Shopping', keywords: [
    'amazon','walmart','wal-mart','target','best buy','apple store','apple.com',
    'nordstrom','macy','gap','old navy','h&m','zara','forever 21','urban outfitter',
    'marshalls','tj maxx','ross dress','five below','michaels','hobby lobby',
    'home depot','lowes','ikea','wayfair','ebay','etsy','chewy','petco','petsmart',
    'calvin klein','columbia','estee lauder','untuckit','teamfanshop','mathis home',
  ]},
  { category: 'Entertainment', keywords: [
    'netflix','spotify','hulu','disney+','hbo','max','peacock','paramount',
    'apple tv','youtube premium','amazon prime','gaming','steam','playstation',
    'xbox','nintendo','movie','theater','amc','regal','concert','ticketmaster',
    'tiqets','desertcrossing','wf*desert',
  ]},
  { category: 'Phone/Internet', keywords: [
    'verizon','at&t','t-mobile','spectrum mobile','cricket','metro pcs',
  ]},
  { category: 'Insurance', keywords: [
    'drive ins','ins prem','insurance prem','geico','state farm','allstate','progressive',
  ]},
  { category: 'Education', keywords: [
    'scholarshare','kings school','le campanile','king\'s schools facts',
  ]},
  { category: 'Giving', keywords: [
    'tithe.ly','reveal churc','church','charity','donation',
  ]},
  { category: 'Savings Transfer', keywords: [
    '360 performance savings','withdrawal to 360','transfer to savings',
  ]},
  { category: 'CC Payment', keywords: [
    'wf credit card auto pay','chase credit crd','discover e-payment','citi card online',
    'target card srvc','applecard gsbank','online transfer ref','payment - thank you',
    'automatic payment','internet payment - thank you','directpay full balance',
  ]},
];

export function categorizeTransaction(description, amount) {
  const desc = (description || '').toLowerCase();

  // 1. Check MERCHANT_MAP first — exact merchant matches take priority
  for (const [key, category] of Object.entries(MERCHANT_MAP)) {
    if (desc.includes(key)) return category;
  }

  // 2. Check income — only for positive amounts
  if (amount > 0) {
    // Exclude savings transfers that come in positive
    if (SAVINGS_TRANSFER_KEYWORDS.some(kw => desc.includes(kw))) {
      return 'Savings Transfer';
    }
    // Check income subcategories
    for (const rule of INCOME_RULES) {
      if (rule.keywords.some(kw => desc.includes(kw))) return rule.category;
    }
  }

  // 3. Expense keyword rules
  for (const rule of EXPENSE_RULES) {
    if (rule.keywords.some(kw => desc.includes(kw))) return rule.category;
  }

  return 'Other';
}

// All category IDs that count as income — used to set isIncome flag
const INCOME_CATEGORY_IDS = new Set([
  'W2 Payroll', 'Side Income', 'Transfer Received', 'Interest/Dividends', 'Income'
]);

export function categorizeAll(transactions) {
  return transactions.map(t => {
    const category = categorizeTransaction(t.description, t.amount);
    return { ...t, category, isIncome: INCOME_CATEGORY_IDS.has(category) };
  });
}

// Re-categorizes old "Income" generic transactions into proper subcategories.
// Run this once on load to fix data saved before subcategory support was added.
export function migrateIncomeCategories(transactions) {
  return transactions.map(t => {
    // Only touch transactions still sitting on the old generic "Income" category
    if (t.category !== 'Income') return t;
    const desc = (t.description || '').toLowerCase();
    // Try to match a specific income subcategory
    for (const rule of INCOME_RULES) {
      if (rule.keywords.some(kw => desc.includes(kw))) {
        return { ...t, category: rule.category, isIncome: true };
      }
    }
    // No specific match — upgrade to W2 Payroll as the most common income type
    // (can always be corrected via the edit modal)
    return { ...t, category: 'W2 Payroll', isIncome: true };
  });
}

// ─── DUPLICATE DETECTION ──────────────────────────────────────────────────────
export function deduplicateTransactions(newTxns, existingTxns) {
  const existingKeys = new Set(
    existingTxns.map(t =>
      `${t.date.toISOString().slice(0,10)}|${(t.description||'').slice(0,40)}|${Number(t.amount).toFixed(2)}`
    )
  );
  return newTxns.filter(t => {
    const key = `${t.date.toISOString().slice(0,10)}|${(t.description||'').slice(0,40)}|${Number(t.amount).toFixed(2)}`;
    return !existingKeys.has(key);
  });
}

// ─── MAIN PARSE FUNCTION ──────────────────────────────────────────────────────
export function parseCSV(text, accountLabel) {
  const rawLines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (rawLines.length < 1) return { transactions: [], bankDetected: 'Unknown', errors: [] };

  const firstCols = splitCSVLine(rawLines[0]);
  const firstCell = (firstCols[0] || '').replace(/"/g, '').trim();
  const isWellsFargo = /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(firstCell);

  let bankDetected, headers, dataStartIdx;

  if (isWellsFargo) {
    bankDetected = 'Wells Fargo';
    headers = [];
    dataStartIdx = 0;
  } else {
    dataStartIdx = 1;
    for (let i = 0; i < Math.min(10, rawLines.length); i++) {
      if (/date/i.test(rawLines[i])) {
        headers = splitCSVLine(rawLines[i]).map(h => h.replace(/"/g,'').trim().toLowerCase());
        dataStartIdx = i + 1;
        break;
      }
    }
    if (!headers) headers = splitCSVLine(rawLines[0]).map(h => h.replace(/"/g,'').trim().toLowerCase());
    bankDetected = detectBank(headers);
  }

  const transactions = [];
  const errors = [];

  for (let i = dataStartIdx; i < rawLines.length; i++) {
    const line = rawLines[i].trim();
    if (!line) continue;
    const cols = splitCSVLine(line);
    if (cols.length < 2) continue;

    try {
      let parsed;
      switch (bankDetected) {
        case 'capital_one': parsed = parseCapitalOne(headers, cols); break;
        case 'chase':       parsed = parseChase(headers, cols); break;
        case 'citi':        parsed = parseCiti(headers, cols); break;
        case 'discover':    parsed = parseDiscover(headers, cols); break;
        case 'Wells Fargo': parsed = parseWellsFargo(cols); break;
        default:            parsed = parseGeneric(headers, cols); break;
      }

      const date = parseDate(parsed.dateStr);
      if (!date || isNaN(date.getTime())) continue;
      if (isNaN(parsed.amount) || parsed.amount === 0) continue;

      transactions.push({
        id: `${accountLabel}-${i}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        date,
        month: `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`,
        description: (parsed.desc || '').trim(),
        amount: parsed.amount,
        category: 'Uncategorized',
        account: accountLabel,
        bankSource: bankDetected,
      });
    } catch (err) {
      errors.push(`Row ${i + 1}: ${err.message}`);
    }
  }

  return { transactions, bankDetected: bankDetected === 'capital_one' ? 'Capital One' : bankDetected === 'chase' ? 'Chase' : bankDetected === 'citi' ? 'Citi' : bankDetected === 'discover' ? 'Discover' : bankDetected, errors };
}
