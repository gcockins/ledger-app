import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import {
  saveTransactions, loadTransactions, saveBudget, loadBudget,
  saveProfile, loadProfile, saveAccounts, loadAccounts,
  saveCategories, loadCategories, saveMerchantRules, loadMerchantRules,
  clearAllData, exportDataBackup, importDataBackup, LEGACY_CATEGORY_ALIASES,
  DEFAULT_CATEGORIES,
} from "./storage";
import { parseCSV, deduplicateTransactions, categorizeAll, migrateIncomeCategories } from "./csvParser";
import { parseWalmartCSV, summarizeWalmartItems } from "./walmartParser";
import { parseAmazonCSV, summarizeAmazonItems } from "./amazonParser";

// ─── BLS BENCHMARKS ───────────────────────────────────────────────────────────
const BLS = {
  1: { Housing:1800,Food:450,Transport:600,Healthcare:250,Shopping:150,Entertainment:120 },
  2: { Housing:2100,Food:700,Transport:800,Healthcare:350,Shopping:250,Entertainment:180 },
  3: { Housing:2400,Food:950,Transport:950,Healthcare:420,Shopping:320,Entertainment:200 },
  4: { Housing:2700,Food:1150,Transport:1100,Healthcare:500,Shopping:380,Entertainment:240 },
  5: { Housing:3000,Food:1350,Transport:1200,Healthcare:580,Shopping:430,Entertainment:260 },
};

// ─── FORMATTERS ───────────────────────────────────────────────────────────────
const fmt = n => `$${Math.abs(n).toLocaleString("en-US",{maximumFractionDigits:0})}`;
const fmtS = n => (n>=0?"+":"-")+fmt(n);
const fmtMonth = m => { const [y,mo]=m.split("-"); return new Date(y,mo-1).toLocaleString("default",{month:"short",year:"2-digit"}); };

const ACCOUNT_TYPES = ["Chase Checking","Chase Savings","Bank of America","Wells Fargo Checking",
  "Wells Fargo Credit","Capital One Checking","Capital One Savings","Citi Card","American Express",
  "Discover","Other Bank","Other Credit Card"];

const PALETTE = ["#e8c547","#f4845f","#5f9cf4","#7ed9a8","#c47ef4","#f47eb4","#4ecdc4",
  "#fb923c","#60a5fa","#a78bfa","#f472b6","#34d399","#94a3b8","#2dd4a7","#10b981"];

// ─── SMALL COMPONENTS ─────────────────────────────────────────────────────────
function Toast({ message, type }) {
  return (
    <div style={{ position:"fixed",bottom:24,right:24,background:type==="success"?"#0f2a1a":"#2a0f0f",
      border:`1px solid ${type==="success"?"#2dd4a7":"#f4845f"}`,color:type==="success"?"#2dd4a7":"#f4845f",
      padding:"12px 20px",borderRadius:8,fontSize:13,fontWeight:600,zIndex:9999,
      boxShadow:"0 4px 20px rgba(0,0,0,0.4)",maxWidth:400 }}>
      {type==="success"?"✓":"✕"} {message}
    </div>
  );
}

function HealthScore({ score }) {
  const color = score>=75?"#2dd4a7":score>=50?"#e8c547":"#f4845f";
  const label = score>=75?"Excellent":score>=50?"Fair":"Needs Attention";
  const r=54, circ=2*Math.PI*r, offset=circ-(score/100)*circ;
  return (
    <div style={{textAlign:"center"}}>
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r={r} fill="none" stroke="#1e293b" strokeWidth="12"/>
        <circle cx="70" cy="70" r={r} fill="none" stroke={color} strokeWidth="12"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          transform="rotate(-90 70 70)" style={{transition:"stroke-dashoffset 1s ease"}}/>
        <text x="70" y="65" textAnchor="middle" fill={color} fontSize="26" fontWeight="800" fontFamily="'DM Serif Display',serif">{score}</text>
        <text x="70" y="82" textAnchor="middle" fill="#64748b" fontSize="11" fontFamily="'DM Sans',sans-serif">/100</text>
      </svg>
      <div style={{color,fontWeight:700,fontSize:14,marginTop:-4}}>{label}</div>
    </div>
  );
}

// ─── CATEGORY MANAGER MODAL ───────────────────────────────────────────────────
function CategoryManager({ categories, onSave, onClose }) {
  const [cats, setCats] = useState(categories.map(c=>({...c})));
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PALETTE[0]);
  const [newExclude, setNewExclude] = useState(false);
  const [newIsIncome, setNewIsIncome] = useState(false);

  const addCat = () => {
    if (!newName.trim()) return;
    const id = newName.trim().replace(/\s+/g,"-")+"-"+Date.now();
    setCats(prev=>[...prev,{id,name:newName.trim(),color:newColor,excludeFromBudget:newExclude,isIncome:newIsIncome,builtIn:false}]);
    setNewName(""); setNewColor(PALETTE[Math.floor(Math.random()*PALETTE.length)]);
  };

  const removeCat = id => setCats(prev=>prev.filter(c=>c.id!==id));
  const updateCat = (id, field, val) => setCats(prev=>prev.map(c=>c.id===id?{...c,[field]:val}:c));

  const S = {
    overlay:{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"},
    modal:{background:"#0f1929",border:"1px solid #1e293b",borderRadius:12,width:"min(720px,95vw)",maxHeight:"85vh",overflow:"hidden",display:"flex",flexDirection:"column"},
    header:{padding:"20px 24px",borderBottom:"1px solid #1e293b",display:"flex",justifyContent:"space-between",alignItems:"center"},
    body:{padding:24,overflowY:"auto",flex:1},
    input:{background:"#0a0f1a",border:"1px solid #1e293b",borderRadius:6,color:"#e2e8f0",padding:"8px 12px",fontSize:13,fontFamily:"'DM Sans',sans-serif",outline:"none"},
    btn:(v="primary")=>({background:v==="primary"?"#e8c547":v==="danger"?"#7f1d1d":"transparent",color:v==="primary"?"#0a0f1a":v==="danger"?"#f87171":"#e2e8f0",border:v==="ghost"?"1px solid #334155":"none",borderRadius:6,padding:"8px 16px",fontWeight:700,cursor:"pointer",fontSize:12,fontFamily:"'DM Sans',sans-serif"}),
  };

  return (
    <div style={S.overlay} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={S.modal}>
        <div style={S.header}>
          <span style={{fontFamily:"'DM Serif Display',serif",fontSize:20,color:"#f1f5f9"}}>Manage Categories</span>
          <button style={S.btn("ghost")} onClick={onClose}>✕ Close</button>
        </div>
        <div style={S.body}>
          {/* Add new */}
          <div style={{background:"#0a1628",borderRadius:8,padding:16,marginBottom:20,border:"1px solid #1e293b"}}>
            <div style={{fontSize:12,color:"#475569",fontWeight:700,letterSpacing:2,textTransform:"uppercase",marginBottom:12}}>Create New Category</div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
              <input style={{...S.input,flex:2,minWidth:140}} placeholder="Category name" value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addCat()} />
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                <span style={{color:"#475569",fontSize:12}}>Color:</span>
                {PALETTE.map(c=>(
                  <div key={c} onClick={()=>setNewColor(c)} style={{width:20,height:20,borderRadius:"50%",background:c,cursor:"pointer",border:newColor===c?"2px solid #fff":"2px solid transparent"}}/>
                ))}
              </div>
              <label style={{display:"flex",alignItems:"center",gap:6,fontSize:13,color:"#94a3b8",cursor:"pointer"}}>
                <input type="checkbox" checked={newExclude} onChange={e=>setNewExclude(e.target.checked)}/> Exclude from budget
              </label>
              <label style={{display:"flex",alignItems:"center",gap:6,fontSize:13,color:"#94a3b8",cursor:"pointer"}}>
                <input type="checkbox" checked={newIsIncome} onChange={e=>setNewIsIncome(e.target.checked)}/> Is income
              </label>
              <button style={S.btn()} onClick={addCat}>+ Add</button>
            </div>
          </div>

          {/* Existing categories */}
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {cats.map(cat=>(
              <div key={cat.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:"#0a0f1a",borderRadius:8,border:"1px solid #1e293b"}}>
                <input type="color" value={cat.color} onChange={e=>updateCat(cat.id,"color",e.target.value)}
                  style={{width:28,height:28,borderRadius:"50%",border:"none",background:"none",cursor:"pointer",padding:0}}/>
                <input style={{...S.input,flex:1}} value={cat.name} onChange={e=>updateCat(cat.id,"name",e.target.value)}/>
                <label style={{display:"flex",alignItems:"center",gap:5,fontSize:12,color:"#64748b",whiteSpace:"nowrap",cursor:"pointer"}}>
                  <input type="checkbox" checked={cat.excludeFromBudget} onChange={e=>updateCat(cat.id,"excludeFromBudget",e.target.checked)}/> Excl. budget
                </label>
                <label style={{display:"flex",alignItems:"center",gap:5,fontSize:12,color:"#64748b",whiteSpace:"nowrap",cursor:"pointer"}}>
                  <input type="checkbox" checked={cat.isIncome} onChange={e=>updateCat(cat.id,"isIncome",e.target.checked)}/> Income
                </label>
                {cat.builtIn
                  ? <span style={{fontSize:11,color:"#334155",minWidth:40,textAlign:"center"}}>built-in</span>
                  : <button style={{...S.btn("danger"),padding:"6px 10px"}} onClick={()=>removeCat(cat.id)}>✕</button>
                }
              </div>
            ))}
          </div>
        </div>
        <div style={{padding:"16px 24px",borderTop:"1px solid #1e293b",display:"flex",justifyContent:"flex-end",gap:10}}>
          <button style={S.btn("ghost")} onClick={onClose}>Cancel</button>
          <button style={S.btn()} onClick={()=>onSave(cats)}>Save Categories</button>
        </div>
      </div>
    </div>
  );
}

// ─── MERCHANT KEY EXTRACTOR ───────────────────────────────────────────────────
// Pulls the first 2-3 meaningful words from a description as the merchant key
export function merchantKey(description) {
  if (!description) return "";
  // Strip common bank noise: numbers, ref codes, dates, state abbreviations at end
  let s = description
    .replace(/\b\d{4,}\b/g, "")          // long numbers
    .replace(/\b[A-Z]{2}\b$/g, "")       // trailing state abbreviation
    .replace(/\*+/g, " ")                // asterisks
    .replace(/[#@]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Take first 3 words
  const words = s.split(" ").filter(w => w.length > 1).slice(0, 3);
  return words.join(" ").toLowerCase();
}

// ─── TRANSACTION NOTE/EXCLUDE MODAL ──────────────────────────────────────────
function TxnEditModal({ txn, categories, allTransactions, onSave, onClose }) {
  const [category, setCategory]   = useState(txn.category);
  const [note, setNote]           = useState(txn.note || "");
  const [excluded, setExcluded]   = useState(txn.excluded || false);
  const [applyToAll, setApplyToAll] = useState(false);

  // Count how many other transactions share the same merchant key
  const mKey = merchantKey(txn.description);
  const matchCount = allTransactions.filter(t =>
    t.id !== txn.id && merchantKey(t.description) === mKey
  ).length;

  const categoryChanged = category !== txn.category;

  const S = {
    overlay:{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"},
    modal:{background:"#0f1929",border:"1px solid #1e293b",borderRadius:12,width:"min(520px,95vw)",padding:24},
    input:{background:"#0a0f1a",border:"1px solid #1e293b",borderRadius:6,color:"#e2e8f0",padding:"9px 12px",fontSize:13,fontFamily:"'DM Sans',sans-serif",outline:"none",width:"100%",boxSizing:"border-box"},
    label:{fontSize:11,color:"#475569",letterSpacing:2,textTransform:"uppercase",marginBottom:6,fontWeight:600,display:"block"},
    btn:(v="primary")=>({background:v==="primary"?"#e8c547":"transparent",color:v==="primary"?"#0a0f1a":"#e2e8f0",border:v==="ghost"?"1px solid #334155":"none",borderRadius:6,padding:"10px 20px",fontWeight:700,cursor:"pointer",fontSize:13,fontFamily:"'DM Sans',sans-serif"}),
  };

  return (
    <div style={S.overlay} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={S.modal}>
        <div style={{fontFamily:"'DM Serif Display',serif",fontSize:18,color:"#f1f5f9",marginBottom:4}}>Edit Transaction</div>
        <div style={{color:"#475569",fontSize:12,marginBottom:20,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={txn.description}>{txn.description}</div>

        <div style={{marginBottom:16}}>
          <label style={S.label}>Category</label>
          <select value={category} onChange={e=>setCategory(e.target.value)} style={{...S.input}}>
            {categories.map(c=><option key={c.id} value={c.id} style={{background:"#0f1929"}}>{c.name}{c.excludeFromBudget?" (excluded)":""}{c.isIncome?" (income)":""}</option>)}
          </select>
        </div>

        {/* Apply to all matching — only show if category changed and there are matches */}
        {categoryChanged && matchCount > 0 && (
          <div style={{marginBottom:16,background:"#0a1628",borderRadius:8,padding:"12px 14px",border:"1px solid #1e3a5f"}}>
            <label style={{display:"flex",alignItems:"flex-start",gap:10,cursor:"pointer"}}>
              <div onClick={()=>setApplyToAll(p=>!p)}
                style={{width:44,height:24,borderRadius:12,background:applyToAll?"#e8c547":"#1e293b",position:"relative",transition:"background 0.2s",cursor:"pointer",flexShrink:0,marginTop:1}}>
                <div style={{position:"absolute",top:2,left:applyToAll?20:2,width:20,height:20,borderRadius:"50%",background:"#fff",transition:"left 0.2s"}}/>
              </div>
              <div>
                <div style={{fontSize:13,color:applyToAll?"#e8c547":"#94a3b8",fontWeight:600}}>
                  Apply to all {matchCount} matching transactions
                </div>
                <div style={{fontSize:11,color:"#475569",marginTop:3}}>
                  Recategorize every transaction from "{mKey}…" to {categories.find(c=>c.id===category)?.name||category}. Also saves as a rule for future uploads.
                </div>
              </div>
            </label>
          </div>
        )}

        <div style={{marginBottom:16}}>
          <label style={S.label}>Note</label>
          <input style={S.input} placeholder="e.g. reimbursed by work, one-time expense, shared with partner..." value={note} onChange={e=>setNote(e.target.value)}/>
        </div>

        <div style={{marginBottom:24}}>
          <label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
            <div onClick={()=>setExcluded(p=>!p)} style={{width:44,height:24,borderRadius:12,background:excluded?"#f4845f":"#1e293b",position:"relative",transition:"background 0.2s",cursor:"pointer",flexShrink:0}}>
              <div style={{position:"absolute",top:2,left:excluded?20:2,width:20,height:20,borderRadius:"50%",background:"#fff",transition:"left 0.2s"}}/>
            </div>
            <span style={{fontSize:13,color:excluded?"#f4845f":"#64748b"}}>
              {excluded?"Excluded from all calculations":"Exclude this transaction"}
            </span>
          </label>
        </div>

        <div style={{display:"flex",justifyContent:"flex-end",gap:10}}>
          <button style={S.btn("ghost")} onClick={onClose}>Cancel</button>
          <button style={S.btn()} onClick={()=>onSave({category, note, excluded, applyToAll, merchantKey: mKey})}>
            Save {applyToAll && matchCount > 0 ? `(updates ${matchCount+1} transactions)` : "Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [transactions, setTransactions] = useState(()=> {
    const loaded = loadTransactions();
    // Migrate any old "Income" generic transactions to proper subcategories
    const migrated = migrateIncomeCategories(loaded);
    // If anything changed, save the migrated data back immediately
    if (migrated.some((t,i) => t.category !== loaded[i].category)) {
      saveTransactions(migrated);
    }
    return migrated;
  });
  const [budget, setBudget]             = useState(()=>loadBudget());
  const [profile, setProfile]           = useState(()=>loadProfile());
  const [accounts, setAccounts]         = useState(()=>loadAccounts());
  const [categories, setCategories]     = useState(()=>loadCategories());
  const [newMonthTxns, setNewMonthTxns] = useState([]);
  const [walmartItems, setWalmartItems] = useState(() => {
    try { const r = localStorage.getItem("ledger_walmart"); return r ? JSON.parse(r) : []; } catch(e) { return []; }
  });
  const [walmartTab, setWalmartTab]       = useState("summary");
  const [amazonItems, setAmazonItems]     = useState(() => {
    try { const r = localStorage.getItem("ledger_amazon"); return r ? JSON.parse(r) : []; } catch(e) { return []; }
  });
  const [amazonTab, setAmazonTab]         = useState("summary");
  const [txnPage, setTxnPage]             = useState(0);
  const TXN_PAGE_SIZE = 100;
  const [merchantRules, setMerchantRules] = useState(()=>loadMerchantRules());
  const [activeTab, setActiveTab]         = useState("overview");
  const [editBudget, setEditBudget]       = useState({});
  const [toast, setToast]                 = useState(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showCatManager, setShowCatManager]     = useState(false);
  const [catFilter, setCatFilter]         = useState("All");
  const [searchTerm, setSearchTerm]       = useState("");
  const [showExcluded, setShowExcluded]   = useState(false);
  const [editingTxn, setEditingTxn]       = useState(null);
  const [sortBy, setSortBy]               = useState("date");
  const [dateRange, setDateRange]         = useState(12);       // months to include in analysis (999 = all)
  const [largeTxnThreshold, setLargeTxnThreshold] = useState(500);
  const [showBackupReminder, setShowBackupReminder] = useState(() => {
    // Show reminder once per browser session (resets when page reloads = new version install)
    if (sessionStorage.getItem("ledger_backup_dismissed")) return false;
    return true; // show on first load each session
  });

  const hasData = transactions.length > 0;

  // Auto-save
  useEffect(()=>{ if(transactions.length>0) saveTransactions(transactions); },[transactions]);
  useEffect(()=>{ if(budget) saveBudget(budget); },[budget]);
  useEffect(()=>{ saveProfile(profile); },[profile]);
  useEffect(()=>{ saveAccounts(accounts); },[accounts]);
  useEffect(()=>{ saveCategories(categories); },[categories]);
  useEffect(()=>{ saveMerchantRules(merchantRules); },[merchantRules]);

  const showToast = (message, type="success") => {
    setToast({message,type});
    setTimeout(()=>setToast(null),3500);
  };

  // ── Category helpers ──────────────────────────────────────────────────────
  const catMap = useMemo(() => {
    const map = {};
    LEGACY_CATEGORY_ALIASES.forEach(c => { map[c.id] = c; }); // legacy first
    categories.forEach(c => { map[c.id] = c; });               // active overrides
    return map;
  }, [categories]);
  const getCat  = id => catMap[id] || { color:"#94a3b8", name: id, excludeFromBudget:false, isIncome:false };
  const budgetCats = categories.filter(c => !c.excludeFromBudget && !c.isIncome);
  const incomeCats = categories.filter(c => c.isIncome);

  // ── File upload ───────────────────────────────────────────────────────────
  const handleFile = useCallback((file, account) => {
    const reader = new FileReader();
    reader.onload = e => {
      const { transactions: parsed, bankDetected, errors } = parseCSV(e.target.result, account);
      const categorized = categorizeAll(parsed);
      if (categorized.length === 0) { showToast("No transactions found. Check the CSV format.", "error"); return; }

      // Apply any saved merchant rules on top of auto-categorization
      const rules = loadMerchantRules();
      const withRules = categorized.map(t => {
        const mKey = merchantKey(t.description);
        if (rules[mKey]) {
          return { ...t, category: rules[mKey] };
        }
        return t;
      });
      const ruleHits = withRules.filter((t,i) => t.category !== categorized[i].category).length;

      setTransactions(prev => {
        const unique = deduplicateTransactions(withRules, prev);
        const skipped = withRules.length - unique.length;
        showToast(`${bankDetected} · ${unique.length} added${skipped>0?` · ${skipped} dupes skipped`:""}${ruleHits>0?` · ${ruleHits} auto-categorized`:""}${errors.length>0?` · ${errors.length} rows skipped`:""}`);
        return [...prev, ...unique];
      });
    };
    reader.readAsText(file);
  },[]);

  const handleNewMonth = file => {
    const reader = new FileReader();
    reader.onload = e => {
      const { transactions: parsed, bankDetected } = parseCSV(e.target.result, "New Month");
      const categorized = categorizeAll(parsed);
      if (categorized.length === 0) { showToast("No transactions found.", "error"); return; }
      setNewMonthTxns(categorized);
      setActiveTab("compare");
      showToast(`${bankDetected} · ${categorized.length} transactions loaded`);
    };
    reader.readAsText(file);
  };

  const handleWalmartFile = file => {
    const reader = new FileReader();
    reader.onload = e => {
      const items = parseWalmartCSV(e.target.result);
      if (items.length === 0) { showToast("No Walmart orders found — check the CSV format.", "error"); return; }
      setWalmartItems(items);
      try { localStorage.setItem("ledger_walmart", JSON.stringify(items)); } catch(e) {}
      setActiveTab("walmart");
      setWalmartTab("summary");
      const active = items.filter(i => i.isActive);
      showToast(`Walmart orders loaded · ${active.length} items · ${fmt(active.reduce((s,i)=>s+i.total,0))}`);
    };
    reader.readAsText(file);
  };

  const handleAmazonFile = file => {
    const reader = new FileReader();
    reader.onload = e => {
      const items = parseAmazonCSV(e.target.result);
      if (items.length === 0) { showToast("No Amazon orders found — download an 'Items' report from Amazon Order History Reports.", "error"); return; }
      setAmazonItems(items);
      try { localStorage.setItem("ledger_amazon", JSON.stringify(items)); } catch(e) {}
      setActiveTab("amazon");
      setAmazonTab("summary");
      const totalSpend = items.reduce((s,i) => s + i.total, 0);
      showToast(`Amazon orders loaded · ${items.length} items · ${fmt(totalSpend)}`);
    };
    reader.readAsText(file);
  };

  // ── Export category rules for hard-coding ─────────────────────────────────
  // Downloads two files:
  // 1. A CSV of every transaction with its current category (for sharing/review)
  // 2. A JSON of merchant rules for pasting into csvParser.js
  const exportCategoryRules = () => {
    // ── CSV: all transactions with their final categories ──
    const csvRows = [
      ["Date","Description","Account","Category","Amount","Note"].join(","),
      ...transactions.map(t => [
        t.date.toLocaleDateString(),
        `"${(t.description||"").replace(/"/g,'""')}"`,
        `"${(t.account||"").replace(/"/g,'""')}"`,
        `"${(t.category||"").replace(/"/g,'""')}"`,
        t.amount.toFixed(2),
        `"${(t.note||"").replace(/"/g,'""')}"`
      ].join(","))
    ];
    const csvBlob = new Blob([csvRows.join("\n")], { type:"text/csv" });
    const csvUrl = URL.createObjectURL(csvBlob);
    const csvA = document.createElement("a");
    csvA.href = csvUrl;
    csvA.download = `ledger-categorized-transactions-${new Date().toISOString().slice(0,10)}.csv`;
    csvA.click();
    URL.revokeObjectURL(csvUrl);

    // ── JSON: merchant rules + custom categories ──
    const customCats = categories.filter(c => !c.builtIn);
    const rulesObj = {
      exportDate: new Date().toISOString(),
      note: "Paste merchantRules into loadMerchantRules default in storage.js, and customCategories into DEFAULT_CATEGORIES in storage.js",
      merchantRules,
      customCategories: customCats.map(c => ({
        id: c.id, name: c.name, color: c.color,
        excludeFromBudget: c.excludeFromBudget,
        isIncome: c.isIncome,
        builtIn: true   // set to true so it becomes permanent in next version
      })),
      // Also build a keyword-frequency map from manually categorized transactions
      // to help inform future csvParser rules
      categoryKeywords: (() => {
        const kw = {};
        transactions.forEach(t => {
          const cat = t.category;
          if (!cat || cat === "Other" || cat === "Uncategorized") return;
          const words = (t.description||"").toLowerCase()
            .replace(/[^a-z0-9\s]/g,"").split(/\s+/)
            .filter(w => w.length > 3 && !/^\d+$/.test(w));
          words.forEach(w => {
            if (!kw[cat]) kw[cat] = {};
            kw[cat][w] = (kw[cat][w] || 0) + 1;
          });
        });
        // Return top 10 words per category sorted by frequency
        const result = {};
        Object.entries(kw).forEach(([cat, words]) => {
          result[cat] = Object.entries(words)
            .sort((a,b)=>b[1]-a[1]).slice(0,10)
            .map(([word, count]) => ({ word, count }));
        });
        return result;
      })()
    };
    const jsonBlob = new Blob([JSON.stringify(rulesObj, null, 2)], { type:"application/json" });
    const jsonUrl = URL.createObjectURL(jsonBlob);
    const jsonA = document.createElement("a");
    jsonA.href = jsonUrl;
    jsonA.download = `ledger-category-rules-${new Date().toISOString().slice(0,10)}.json`;
    jsonA.click();
    URL.revokeObjectURL(jsonUrl);

    showToast("Exported: categorized transactions CSV + category rules JSON");
  };
  // Finds bank charges from Walmart/Target and updates their category
  // to match the dominant Walmart order category for that period.
  const reconcileWalmart = () => {
    if (!walmartSummary) return;
    const { byCategory, totalSpend } = walmartSummary;

    // Build a % breakdown of Walmart spend by Ledger category
    const ledgerSplit = {};
    Object.values(byCategory).forEach(cat => {
      const key = cat.ledgerCat;
      ledgerSplit[key] = (ledgerSplit[key] || 0) + cat.total;
    });
    // Find the dominant category (excluding Fuel since that maps cleanly already)
    const dominantNonFuel = Object.entries(ledgerSplit)
      .filter(([cat]) => cat !== 'Transport')
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'Food';

    // Find all bank transactions that are Walmart/Target charges currently in Food or Shopping
    const walmartBankTxns = transactions.filter(t => {
      const d = (t.description || '').toLowerCase();
      return (d.includes('wal-mart') || d.includes('walmart') || d.includes('target')) && !t.excluded;
    });

    if (walmartBankTxns.length === 0) {
      showToast("No Walmart bank charges found — make sure bank CSVs are uploaded", "error");
      return;
    }

    let updated = 0;
    setTransactions(prev => prev.map(t => {
      const d = (t.description || '').toLowerCase();
      const isWalmartCharge = (d.includes('wal-mart') || d.includes('walmart') || d.includes('target')) && !t.excluded;
      if (!isWalmartCharge) return t;

      // Gas purchases at Walmart (large round-dollar amounts) → Transport
      if (d.includes('walmart') && Math.abs(t.amount) > 20 && Math.abs(t.amount) % 1 !== 0) {
        updated++;
        return { ...t, category: 'Transport', note: (t.note ? t.note + ' · ' : '') + 'Walmart gas (auto-reconciled)' };
      }
      // Everything else → Shopping (Walmart is general merchandise, not just Food)
      updated++;
      return { ...t, category: dominantNonFuel, note: (t.note ? t.note + ' · ' : '') + 'Walmart order reconciled' };
    }));

    showToast(`Reconciled ${updated} Walmart bank charge${updated !== 1 ? 's' : ''} → ${dominantNonFuel}`);
  };

  // ── Transaction editing ───────────────────────────────────────────────────
  const saveTxnEdit = (id, { category, note, excluded, applyToAll, merchantKey: mKey }) => {
    const isInc = getCat(category).isIncome;

    if (applyToAll && mKey) {
      // Update all transactions whose merchant key matches
      setTransactions(prev => prev.map(t => {
        const tKey = merchantKey(t.description);
        if (t.id === id || tKey === mKey) {
          return { ...t, category, isIncome: isInc, ...(t.id === id ? { note, excluded } : {}) };
        }
        return t;
      }));
      // Save merchant rule for future uploads
      setMerchantRules(prev => ({ ...prev, [mKey]: category }));
      const matchCount = transactions.filter(t => t.id !== id && merchantKey(t.description) === mKey).length;
      showToast(`Updated ${matchCount + 1} transactions · Rule saved for "${mKey}"`);
    } else {
      setTransactions(prev => prev.map(t =>
        t.id === id ? { ...t, category, note, excluded, isIncome: isInc } : t
      ));
      showToast("Transaction updated");
    }
    setEditingTxn(null);
  };

  // ── Category management ───────────────────────────────────────────────────
  const saveNewCategories = newCats => {
    setCategories(newCats);
    setShowCatManager(false);
    showToast("Categories saved");
  };

  // ── Derived data ──────────────────────────────────────────────────────────
  // Active = not excluded
  const activeTxns = transactions.filter(t => !t.excluded);

  const allMonths    = [...new Set(activeTxns.map(t=>t.month))].sort();
  const recentMonths = allMonths.slice(dateRange === 999 ? 0 : -dateRange);

  const monthlyData = recentMonths.map(month => {
    const mt = activeTxns.filter(t=>t.month===month);
    // isIncome: check category definition first, fall back to stored flag
    const isIncomeTxn = t => getCat(t.category).isIncome || t.isIncome === true;
    const income   = mt.filter(isIncomeTxn).reduce((s,t)=>s+Math.abs(t.amount),0);
    const expenses = mt.filter(t=>!isIncomeTxn(t) && !getCat(t.category).excludeFromBudget && t.amount<0).reduce((s,t)=>s+Math.abs(t.amount),0);
    const catBreak = {};
    categories.forEach(c=>{ catBreak[c.id]=mt.filter(t=>t.category===c.id&&!c.isIncome&&t.amount<0).reduce((s,t)=>s+Math.abs(t.amount),0); });
    return { month, label:fmtMonth(month), income, expenses, cashflow:income-expenses, ...catBreak };
  });

  const avgIncome   = monthlyData.reduce((s,m)=>s+m.income,0)  /(monthlyData.length||1);
  const avgExpenses = monthlyData.reduce((s,m)=>s+m.expenses,0)/(monthlyData.length||1);
  const avgCashflow = avgIncome - avgExpenses;

  // recentTxns = transactions within the selected window
  const recentTxns = activeTxns.filter(t => recentMonths.includes(t.month));

  // categoryTotals = avg/month (for budget planning — what to expect each month)
  // categoryPeriodTotals = total spent in period (for "what did I actually spend" view)
  const categoryTotals = {};
  const categoryPeriodTotals = {};   // total in the selected window — NOT divided
  const categoryActiveMonths = {};   // how many months had activity
  categories.forEach(cat => {
    if (cat.isIncome || cat.excludeFromBudget) {
      categoryTotals[cat.id] = 0;
      categoryPeriodTotals[cat.id] = 0;
      categoryActiveMonths[cat.id] = 0;
      return;
    }
    const catTxns = recentTxns.filter(t => t.category === cat.id && t.amount < 0);
    if (catTxns.length === 0) {
      categoryTotals[cat.id] = 0;
      categoryPeriodTotals[cat.id] = 0;
      categoryActiveMonths[cat.id] = 0;
      return;
    }
    const total = catTxns.reduce((s,t)=>s+Math.abs(t.amount),0);
    const activeMonthCount = new Set(catTxns.map(t=>t.month)).size;
    categoryPeriodTotals[cat.id] = total;
    categoryActiveMonths[cat.id] = activeMonthCount;
    categoryTotals[cat.id] = total / Math.max(activeMonthCount, 1);
  });

  const healthScore = Math.min(100,Math.max(0,
    (avgCashflow>0?40:Math.max(0,40+avgCashflow/(avgIncome||1)*40))+
    (categoryTotals["Savings Transfer"]/(avgIncome||1)>0.2?30:(categoryTotals["Savings Transfer"]/(avgIncome||1))*150)+
    (avgExpenses/(avgIncome||1)<0.7?30:Math.max(0,30-(avgExpenses/(avgIncome||1)-0.7)*100))
  ));

  const benchmark = BLS[Math.min(Math.max(profile.familySize,1),5)];

  const buildBudget = () => {
    const b = {};
    budgetCats.forEach(cat => {
      b[cat.id] = Math.round(categoryTotals[cat.id] || benchmark[cat.id] || 0);
    });
    setBudget(b);
    setEditBudget({...b});
    setActiveTab("budget");
    showToast("Budget built from your spending history!");
  };

  // Pie shows TOTAL spent in the period (not avg/month — that confused with individual transactions)
  const pieData = categories
    .filter(c=>!c.isIncome && !c.excludeFromBudget && (categoryPeriodTotals[c.id]||0)>0)
    .map(c=>({ name:c.name, value:Math.round(categoryPeriodTotals[c.id]||0), avgPerMonth:Math.round(categoryTotals[c.id]||0), activeMonths:categoryActiveMonths[c.id]||0, color:c.color }))
    .sort((a,b)=>b.value-a.value);

  // New month data
  const newMonthCats = {};
  categories.forEach(cat=>{
    newMonthCats[cat.id]=newMonthTxns.filter(t=>t.category===cat.id&&!getCat(t.category).isIncome&&t.amount<0).reduce((s,t)=>s+Math.abs(t.amount),0);
  });
  const newMonthIncome   = newMonthTxns.filter(t=>getCat(t.category).isIncome).reduce((s,t)=>s+Math.abs(t.amount),0);
  const newMonthExpenses = Object.entries(newMonthCats).filter(([id])=>!getCat(id).excludeFromBudget).reduce((s,[,v])=>s+v,0);

  // Filtered transactions for list — reset page when filters change
  const displayTxns = useMemo(() => transactions
    .filter(t => {
      if (!showExcluded && t.excluded) return false;
      if (catFilter !== "All" && t.category !== catFilter) return false;
      if (searchTerm && !t.description.toLowerCase().includes(searchTerm.toLowerCase()) && !t.account.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      return true;
    })
    .sort((a,b) => sortBy==="date" ? b.date-a.date : sortBy==="amount" ? Math.abs(b.amount)-Math.abs(a.amount) : a.description.localeCompare(b.description)),
  [transactions, showExcluded, catFilter, searchTerm, sortBy]);

  // Reset to page 0 whenever filters change
  const prevFilterKey = useRef("");
  const filterKey = `${catFilter}|${searchTerm}|${sortBy}|${showExcluded}`;
  if (filterKey !== prevFilterKey.current) { prevFilterKey.current = filterKey; if (txnPage !== 0) setTxnPage(0); }

  const txnPageCount = Math.ceil(displayTxns.length / TXN_PAGE_SIZE);
  const txnPageItems = displayTxns.slice(txnPage * TXN_PAGE_SIZE, (txnPage + 1) * TXN_PAGE_SIZE);

  // Income breakdown — dual-check: category definition OR stored isIncome flag
  const isIncomeTxn = t => getCat(t.category).isIncome || t.isIncome === true;
  const incomeBreakdown = {};
  incomeCats.forEach(c=>{
    incomeBreakdown[c.id] = activeTxns.filter(t=>t.category===c.id).reduce((s,t)=>s+Math.abs(t.amount),0)/(recentMonths.length||1);
  });

  // Large transactions that may need review (high-value, not in excluded categories)
  const largeTxns = activeTxns
    .filter(t => {
      const cat = getCat(t.category);
      return Math.abs(t.amount) >= largeTxnThreshold
        && !cat.excludeFromBudget
        && !cat.isIncome
        && t.amount < 0;
    })
    .sort((a,b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 20);

  // ── Styles ────────────────────────────────────────────────────────────────
  const S = {
    app:    { minHeight:"100vh",background:"#0a0f1a",color:"#e2e8f0",fontFamily:"'DM Sans',sans-serif" },
    header: { background:"linear-gradient(135deg,#0f1929 0%,#0a0f1a 100%)",borderBottom:"1px solid #1e293b",padding:"14px 28px",display:"flex",alignItems:"center",gap:12 },
    logo:   { fontFamily:"'DM Serif Display',serif",fontSize:22,color:"#e8c547" },
    logoSub:{ fontSize:10,color:"#475569",letterSpacing:3,textTransform:"uppercase" },
    nav:    { display:"flex",gap:2,padding:"0 28px",borderBottom:"1px solid #1e293b",background:"#0d1525",alignItems:"center",overflowX:"auto" },
    navBtn: a=>({ padding:"12px 16px",border:"none",background:"none",color:a?"#e8c547":"#64748b",cursor:"pointer",fontSize:12,fontWeight:700,borderBottom:a?"2px solid #e8c547":"2px solid transparent",fontFamily:"'DM Sans',sans-serif",transition:"all 0.2s",whiteSpace:"nowrap" }),
    card:   { background:"#0f1929",border:"1px solid #1e293b",borderRadius:12,padding:20 },
    statCard:{ background:"#0f1929",border:"1px solid #1e293b",borderRadius:12,padding:18,flex:1,minWidth:140 },
    row:    { display:"flex",gap:14,flexWrap:"wrap" },
    label:  { fontSize:10,color:"#475569",letterSpacing:2,textTransform:"uppercase",marginBottom:5,fontWeight:700 },
    input:  { background:"#0a0f1a",border:"1px solid #1e293b",borderRadius:7,color:"#e2e8f0",padding:"9px 12px",fontSize:13,fontFamily:"'DM Sans',sans-serif",outline:"none" },
    btn:    (v="primary")=>({ background:v==="primary"?"#e8c547":v==="danger"?"rgba(127,29,29,0.5)":"transparent",color:v==="primary"?"#0a0f1a":v==="danger"?"#f87171":"#e2e8f0",border:v==="ghost"?"1px solid #334155":"none",borderRadius:7,padding:"9px 18px",fontWeight:700,cursor:"pointer",fontSize:12,fontFamily:"'DM Sans',sans-serif",transition:"all 0.2s",whiteSpace:"nowrap" }),
    section:{ padding:"24px 28px" },
    h2:     { fontFamily:"'DM Serif Display',serif",fontSize:24,color:"#f1f5f9",margin:"0 0 4px" },
    h3:     { fontFamily:"'DM Serif Display',serif",fontSize:16,color:"#f1f5f9",margin:"0 0 14px" },
    sub:    { color:"#475569",fontSize:12,margin:"0 0 18px" },
  };

  // Walmart summary
  const walmartSummary = walmartItems.length > 0 ? summarizeWalmartItems(walmartItems) : null;

  const tabs = ["overview","transactions","income",...(budget?["budget"]:[]),(newMonthTxns.length>0?"compare":null),(walmartItems.length>0?"walmart":null),(amazonItems.length>0?"amazon":null)].filter(Boolean);

  // ── SETUP SCREEN ──────────────────────────────────────────────────────────
  if (!hasData) {
    return (
      <div style={S.app}>
        <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/>
        <div style={S.header}>
          <div style={{flex:1}}><div style={S.logo}>Ledger</div><div style={S.logoSub}>Personal Finance</div></div>
          <label style={{...S.btn("ghost"),fontSize:12,cursor:"pointer"}}>
            Restore Backup
            <input type="file" accept=".json" style={{display:"none"}} onChange={e=>{
              if(e.target.files[0]) importDataBackup(e.target.files[0],
                ({transactions:t,budget:b,profile:p,categories:c,merchantRules:mr})=>{
                  setTransactions(t); setBudget(b);
                  if(p) setProfile(p);
                  if(c) setCategories(c);
                  if(mr) setMerchantRules(mr);
                  showToast(`Restored ${t.length} transactions + categories + rules`);
                }, err=>showToast(err,"error"));
            }}/>
          </label>
        </div>
        <div style={{maxWidth:680,margin:"48px auto",padding:"0 28px"}}>
          <h1 style={{...S.h2,fontSize:30,marginBottom:8}}>Your complete financial picture.</h1>
          <p style={{...S.sub,fontSize:13,marginBottom:28}}>Upload 6 months of bank & credit card statements. Your data stays on this device — never uploaded anywhere.</p>

          {/* ── Prominent restore card ── */}
          <div style={{...S.card,marginBottom:18,background:"#0a1628",borderColor:"#1e4080",borderWidth:2}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:14}}>
              <div style={{fontSize:28,lineHeight:1}}>💾</div>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,color:"#60a5fa",fontSize:14,marginBottom:4}}>Have a backup from a previous session?</div>
                <div style={{fontSize:12,color:"#475569",marginBottom:10,lineHeight:1.6}}>
                  If you clicked <strong style={{color:"#94a3b8"}}>💾 Backup</strong> before, you can restore all your transactions,
                  custom categories, reclassifications, and merchant rules in one click. You won&#39;t need to re-upload any CSVs.
                </div>
                <label style={{...S.btn(),fontSize:12,cursor:"pointer",display:"inline-block"}}>
                  📂 Restore from Backup (.json)
                  <input type="file" accept=".json" style={{display:"none"}} onChange={e=>{
                    if(e.target.files[0]) importDataBackup(e.target.files[0],
                      ({transactions:t,budget:b,profile:p,categories:c,merchantRules:mr})=>{
                        setTransactions(t); setBudget(b);
                        if(p) setProfile(p);
                        if(c) setCategories(c);
                        if(mr) setMerchantRules(mr);
                        showToast(`Restored ${t.length} transactions + all categories & rules`);
                      }, err=>showToast(err,"error"));
                  }}/>
                </label>
              </div>
            </div>
          </div>

          <div style={{...S.card,marginBottom:14}}>
            <div style={S.h3}>Household</div>
            <div style={S.row}>
              <div style={{flex:1}}>
                <div style={S.label}>Household Size</div>
                <select style={{...S.input,width:"100%"}} value={profile.familySize} onChange={e=>setProfile(p=>({...p,familySize:+e.target.value}))}>
                  {[1,2,3,4,5].map(n=><option key={n} value={n}>{n} {n===1?"person":"people"}</option>)}
                </select>
              </div>
              <div style={{flex:1}}>
                <div style={S.label}>ZIP Code</div>
                <input style={{...S.input,width:"100%",boxSizing:"border-box"}} placeholder="92262" value={profile.zipCode} onChange={e=>setProfile(p=>({...p,zipCode:e.target.value}))} maxLength={5}/>
              </div>
            </div>
          </div>

          <div style={{...S.card,marginBottom:14}}>
            <div style={S.h3}>Select Your Accounts</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
              {ACCOUNT_TYPES.map(type=>{
                const active=accounts.includes(type);
                return <button key={type} style={{...S.btn(active?"primary":"ghost"),padding:"7px 12px",fontSize:11}} onClick={()=>setAccounts(prev=>active?prev.filter(a=>a!==type):[...prev,type])}>{type}</button>;
              })}
            </div>
          </div>

          {accounts.length>0&&(
            <div style={{...S.card,marginBottom:20}}>
              <div style={S.h3}>Upload CSV Files</div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {accounts.map(acct=>{
                  const count=transactions.filter(t=>t.account===acct).length;
                  return (
                    <div key={acct} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:"#0a0f1a",borderRadius:7,border:`1px solid ${count>0?"#1a3a2a":"#1e293b"}`}}>
                      <div style={{flex:1,fontSize:13,fontWeight:600}}>{acct}</div>
                      <div style={{fontSize:11,color:count>0?"#2dd4a7":"#475569"}}>{count>0?`✓ ${count} transactions`:"No file yet"}</div>
                      <label style={{...S.btn("secondary"),padding:"7px 12px",fontSize:11,cursor:"pointer"}}>
                        Upload CSV<input type="file" accept=".csv" style={{display:"none"}} onChange={e=>e.target.files[0]&&handleFile(e.target.files[0],acct)}/>
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <button style={{...S.btn(),width:"100%",padding:13,fontSize:14,opacity:transactions.length>0?1:0.4}} disabled={transactions.length===0} onClick={()=>setActiveTab("overview")}>
            Analyze My Finances →
          </button>
          {transactions.length>0&&<p style={{textAlign:"center",color:"#475569",fontSize:11,marginTop:8}}>{transactions.length} transactions · {allMonths.length} months · saved to this device</p>}
        </div>
        {toast&&<Toast {...toast}/>}
      </div>
    );
  }

  // ── MAIN DASHBOARD ────────────────────────────────────────────────────────
  return (
    <div style={S.app}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/>

      <div style={S.header}>
        <div style={{flex:1}}><div style={S.logo}>Ledger</div><div style={S.logoSub}>Personal Finance</div></div>
        <div style={{display:"flex",gap:7,alignItems:"center",flexWrap:"wrap"}}>
          <span style={{fontSize:11,color:"#334155"}}>💾 {transactions.length} txns</span>
          <button style={{...S.btn("ghost"),fontSize:11}} onClick={()=>exportDataBackup(transactions,budget,profile,categories,merchantRules)}>💾 Backup</button>
          <button style={{...S.btn("ghost"),fontSize:11,borderColor:"#2dd4a7",color:"#2dd4a7"}} onClick={exportCategoryRules}>📋 Export Rules</button>
          <button style={{...S.btn("ghost"),fontSize:11}} onClick={()=>setShowCatManager(true)}>⚙ Categories</button>
          <label style={{...S.btn("ghost"),fontSize:11,cursor:"pointer",borderColor:"#f97316",color:"#f97316"}}>
            🛍 Walmart Orders<input type="file" accept=".csv" style={{display:"none"}} onChange={e=>e.target.files[0]&&handleWalmartFile(e.target.files[0])}/>
          </label>
          <label style={{...S.btn("ghost"),fontSize:11,cursor:"pointer",borderColor:"#f59e0b",color:"#f59e0b"}}>
            📦 Amazon Orders<input type="file" accept=".csv" style={{display:"none"}} onChange={e=>e.target.files[0]&&handleAmazonFile(e.target.files[0])}/>
          </label>
          <label style={{...S.btn("ghost"),fontSize:11,cursor:"pointer"}}>
            + Add Data<input type="file" accept=".csv" style={{display:"none"}} onChange={e=>{
              if(e.target.files[0]){const acct=prompt("Which account?")||"Unknown";handleFile(e.target.files[0],acct);}
            }}/>
          </label>
          {showClearConfirm
            ? <div style={{display:"flex",gap:5}}>
                <button style={{...S.btn("danger"),padding:"7px 12px",fontSize:11}} onClick={()=>{clearAllData();setTransactions([]);setBudget(null);setNewMonthTxns([]);setShowClearConfirm(false);}}>Yes, Reset</button>
                <button style={{...S.btn("ghost"),padding:"7px 12px",fontSize:11}} onClick={()=>setShowClearConfirm(false)}>Cancel</button>
              </div>
            : <button style={{...S.btn("ghost"),fontSize:11,color:"#334155"}} onClick={()=>setShowClearConfirm(true)}>Reset</button>
          }
        </div>
      </div>

      <div style={S.nav}>
        {tabs.map(tab=><button key={tab} style={S.navBtn(activeTab===tab)} onClick={()=>setActiveTab(tab)}>{tab.charAt(0).toUpperCase()+tab.slice(1)}</button>)}
        <div style={{marginLeft:"auto",display:"flex",gap:10,alignItems:"center",padding:"6px 0"}}>
          {/* Date range selector — shows what window all averages are based on */}
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{fontSize:10,color:"#475569",fontWeight:700,letterSpacing:1,textTransform:"uppercase",whiteSpace:"nowrap"}}>
              Analysis window:
            </span>
            {[3,6,12,allMonths.length].filter((v,i,a)=>a.indexOf(v)===i && v<=allMonths.length).map(n=>(
              <button key={n} onClick={()=>setDateRange(n)}
                style={{padding:"4px 10px",borderRadius:5,border:"none",fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",
                  background:dateRange===n?"#e8c547":"#1e293b",color:dateRange===n?"#0a0f1a":"#64748b",transition:"all 0.15s"}}>
                {n===allMonths.length?"All":n+"mo"}
              </button>
            ))}
          </div>
          <div style={{width:1,height:20,background:"#1e293b"}}/>
          {!budget&&<button style={{...S.btn(),padding:"7px 14px",fontSize:11}} onClick={buildBudget}>Build Budget →</button>}
          {budget&&<label style={{...S.btn("ghost"),fontSize:11,cursor:"pointer"}}>Upload New Month<input type="file" accept=".csv" style={{display:"none"}} onChange={e=>e.target.files[0]&&handleNewMonth(e.target.files[0])}/></label>}
        </div>
      </div>

      {/* ── Backup reminder banner ── */}
      {showBackupReminder && transactions.length > 0 && (
        <div style={{background:"#0a1628",borderBottom:"1px solid #1e4080",padding:"10px 24px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <span style={{fontSize:13,color:"#60a5fa",fontWeight:700}}>💾 Backup your progress</span>
          <span style={{fontSize:12,color:"#475569",flex:1}}>Save a backup before updating to a new version — restoring it takes 2 seconds and preserves all your categories and reclassifications.</span>
          <button style={{...S.btn(),fontSize:11,padding:"6px 14px"}} onClick={()=>{ exportDataBackup(transactions,budget,profile,categories,merchantRules); setShowBackupReminder(false); sessionStorage.setItem("ledger_backup_dismissed","1"); }}>Download Backup Now</button>
          <button style={{...S.btn("ghost"),fontSize:11,padding:"6px 10px"}} onClick={()=>{ setShowBackupReminder(false); sessionStorage.setItem("ledger_backup_dismissed","1"); }}>✕</button>
        </div>
      )}
      {activeTab==="overview"&&(
        <div style={S.section}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:12,marginBottom:4}}>
            <div>
              <h2 style={S.h2}>Financial Overview</h2>
              <p style={S.sub}>
                {fmtMonth(recentMonths[0]||"")} – {fmtMonth(recentMonths[recentMonths.length-1]||"")} &nbsp;·&nbsp; {recentMonths.length} months &nbsp;·&nbsp; {recentTxns.length} transactions
              </p>
            </div>
            <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
              <span style={{fontSize:11,color:"#475569"}}>Window:</span>
              {[{v:3,l:"3mo"},{v:6,l:"6mo"},{v:9,l:"9mo"},{v:12,l:"12mo"},{v:999,l:"All"}].map(({v,l})=>(
                <button key={v} onClick={()=>setDateRange(v)} style={{
                  padding:"5px 11px",border:"none",borderRadius:6,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",
                  background: dateRange===v ? "#e8c547" : "#1e293b",
                  color: dateRange===v ? "#0a0f1a" : "#64748b",
                }}>{l}</button>
              ))}
              <span style={{fontSize:10,color:"#334155"}}>{allMonths.length} months available</span>
            </div>
          </div>

          <div style={{...S.row,marginBottom:16,alignItems:"stretch"}}>
            <div style={{...S.statCard,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
              <div style={{...S.label,textAlign:"center"}}>Health Score</div>
              <HealthScore score={Math.round(healthScore)}/>
            </div>
            <div style={S.statCard}>
              <div style={S.label}>Monthly Cash Flow</div>
              <div style={{fontFamily:"'DM Serif Display',serif",fontSize:32,color:avgCashflow>=0?"#2dd4a7":"#f4845f",lineHeight:1}}>{fmtS(avgCashflow)}</div>
              <div style={{color:"#475569",fontSize:11,marginTop:6}}>{avgCashflow>=0?"Positive — spending less than earning":"Negative — expenses exceed income"}</div>
              <div style={{marginTop:12,display:"flex",gap:14}}>
                <div><div style={S.label}>Avg Income</div><div style={{color:"#2dd4a7",fontWeight:700,fontSize:15}}>{fmt(avgIncome)}</div></div>
                <div><div style={S.label}>Avg Expenses</div><div style={{color:"#f4845f",fontWeight:700,fontSize:15}}>{fmt(avgExpenses)}</div></div>
              </div>
            </div>
            <div style={S.statCard}>
              <div style={S.label}>vs. {profile.familySize}-Person Benchmark</div>
              <div style={{display:"flex",flexDirection:"column",gap:7,marginTop:6}}>
                {Object.entries(benchmark).slice(0,5).map(([cat,bVal])=>{
                  const actual=categoryTotals[cat]||0, over=actual>bVal, pct=Math.min(100,(actual/bVal)*100);
                  return (
                    <div key={cat}>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:2}}>
                        <span style={{color:"#94a3b8"}}>{cat}</span>
                        <span style={{color:over?"#f4845f":"#2dd4a7",fontWeight:600}}>{fmt(actual)} {over?"▲":"▼"} {fmt(bVal)}</span>
                      </div>
                      <div style={{height:4,background:"#1e293b",borderRadius:2}}>
                        <div style={{height:4,width:`${pct}%`,background:over?"#f4845f":"#2dd4a7",borderRadius:2,transition:"width 0.8s ease"}}/>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div style={{...S.card,marginBottom:14}}>
            <div style={S.h3}>Monthly Income vs. Expenses</div>
            <ResponsiveContainer width="100%" height={190}>
              <BarChart data={monthlyData} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
                <XAxis dataKey="label" tick={{fill:"#64748b",fontSize:11}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fill:"#64748b",fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>`$${(Math.abs(v)/1000).toFixed(0)}k`}/>
                <Tooltip formatter={v=>fmt(v)} contentStyle={{background:"#0f1929",border:"1px solid #1e293b",borderRadius:8,color:"#e2e8f0"}}/>
                <Bar dataKey="income" name="Income" fill="#2dd4a7" radius={[4,4,0,0]}/>
                <Bar dataKey="expenses" name="Expenses" fill="#f4845f" radius={[4,4,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={S.row}>
            <div style={{...S.card,flex:1}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:2}}>
                <div style={S.h3}>Spending by Category</div>
                <div style={{fontSize:10,color:"#334155"}}>{fmtMonth(recentMonths[0])} – {fmtMonth(recentMonths[recentMonths.length-1])}</div>
              </div>
              <div style={{display:"flex",gap:16,alignItems:"flex-start",flexWrap:"wrap"}}>
                <ResponsiveContainer width={200} height={200}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" outerRadius={85} innerRadius={40} dataKey="value" paddingAngle={2}>
                      {pieData.map((e,i)=><Cell key={i} fill={e.color}/>)}
                    </Pie>
                    <Tooltip formatter={(v,name,props)=>[
                      `${fmt(v)} total  ·  ${fmt(props.payload.avgPerMonth)}/mo avg`,
                      name
                    ]} contentStyle={{background:"#0f1929",border:"1px solid #1e293b",borderRadius:8,color:"#e2e8f0",fontSize:11}}/>
                  </PieChart>
                </ResponsiveContainer>
                <div style={{flex:1,minWidth:140,display:"flex",flexDirection:"column",gap:4,paddingTop:4}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#334155",fontWeight:700,letterSpacing:1,textTransform:"uppercase",paddingBottom:4,borderBottom:"1px solid #0d1525",marginBottom:2}}>
                    <span>CATEGORY</span>
                    <div style={{display:"flex",gap:16}}>
                      <span style={{minWidth:52,textAlign:"right"}}>TOTAL</span>
                      <span style={{minWidth:52,textAlign:"right"}}>AVG/MO</span>
                    </div>
                  </div>
                  {pieData.map(e=>(
                    <div key={e.name} style={{display:"flex",alignItems:"center",gap:7}}>
                      <div style={{width:8,height:8,borderRadius:2,background:e.color,flexShrink:0}}/>
                      <div style={{flex:1,fontSize:11,color:"#94a3b8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.name}</div>
                      <div style={{display:"flex",gap:16}}>
                        <div style={{fontSize:11,fontWeight:700,color:e.color,minWidth:52,textAlign:"right"}}>{fmt(e.value)}</div>
                        <div style={{fontSize:10,color:"#475569",minWidth:52,textAlign:"right"}}>{fmt(e.avgPerMonth)}</div>
                      </div>
                    </div>
                  ))}
                  <div style={{borderTop:"1px solid #0d1525",paddingTop:4,marginTop:2,display:"flex",justifyContent:"flex-end",gap:16}}>
                    <div style={{fontSize:11,fontWeight:700,color:"#e2e8f0",minWidth:52,textAlign:"right"}}>{fmt(pieData.reduce((s,e)=>s+e.value,0))}</div>
                    <div style={{fontSize:10,color:"#64748b",minWidth:52,textAlign:"right"}}>{fmt(pieData.reduce((s,e)=>s+e.avgPerMonth,0))}</div>
                  </div>
                </div>
              </div>
            </div>
            <div style={{...S.card,flex:1}}>
              <div style={S.h3}>Category Trends</div>
              <ResponsiveContainer width="100%" height={210}>
                <LineChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
                  <XAxis dataKey="label" tick={{fill:"#64748b",fontSize:10}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:"#64748b",fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`}/>
                  <Tooltip formatter={v=>fmt(v)} contentStyle={{background:"#0f1929",border:"1px solid #1e293b",borderRadius:8,color:"#e2e8f0"}}/>
                  {budgetCats.slice(0,6).map(c=><Line key={c.id} type="monotone" dataKey={c.id} stroke={c.color} strokeWidth={2} dot={false} name={c.name}/>)}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          {!budget&&<div style={{marginTop:16,textAlign:"center"}}><button style={{...S.btn(),padding:"12px 32px",fontSize:13}} onClick={buildBudget}>Build My Budget →</button></div>}

          {/* ── Large Transaction Review ── */}
          {largeTxns.length > 0 && (
            <div style={{...S.card,marginTop:14,borderColor:"#f97316"+"44"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
                <div>
                  <div style={{...S.h3,margin:0,color:"#fb923c"}}>⚠ Large Transaction Review</div>
                  <div style={{fontSize:11,color:"#475569",marginTop:4}}>Non-excluded transactions over threshold — verify these are real expenses, not miscategorized transfers</div>
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <span style={{fontSize:11,color:"#475569"}}>Flag over:</span>
                  {[200,500,1000,2000].map(n=>(
                    <button key={n} onClick={()=>setLargeTxnThreshold(n)} style={{padding:"4px 10px",border:"none",borderRadius:5,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",background:largeTxnThreshold===n?"#fb923c":"#1e293b",color:largeTxnThreshold===n?"#0a0f1a":"#64748b"}}>
                      ${n >= 1000 ? (n/1000)+"k" : n}
                    </button>
                  ))}
                </div>
              </div>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead>
                  <tr style={{borderBottom:"1px solid #1e293b"}}>
                    {["Date","Description","Category","Amount",""].map(h=>(
                      <th key={h} style={{textAlign:"left",padding:"7px 10px",color:"#475569",fontWeight:700,fontSize:10,letterSpacing:1,textTransform:"uppercase"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {largeTxns.map(t=>{
                    const cat = getCat(t.category);
                    return (
                      <tr key={t.id} style={{borderBottom:"1px solid #0d1525"}}
                        onMouseEnter={e=>e.currentTarget.style.background="#0f1929"}
                        onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                        <td style={{padding:"8px 10px",color:"#64748b",whiteSpace:"nowrap"}}>{t.date.toLocaleDateString()}</td>
                        <td style={{padding:"8px 10px",color:"#cbd5e1",maxWidth:280,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.description}</td>
                        <td style={{padding:"8px 10px"}}>
                          <span style={{background:cat.color+"22",color:cat.color,border:`1px solid ${cat.color}44`,borderRadius:4,padding:"2px 7px",fontSize:10,fontWeight:700}}>{cat.name}</span>
                        </td>
                        <td style={{padding:"8px 10px",fontWeight:700,color:"#fb923c",textAlign:"right",whiteSpace:"nowrap"}}>{fmt(t.amount)}</td>
                        <td style={{padding:"8px 10px",textAlign:"right"}}>
                          <button onClick={()=>setEditingTxn(t)} style={{background:"none",border:"1px solid #334155",borderRadius:5,color:"#64748b",padding:"3px 9px",fontSize:10,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:700}}>
                            Review →
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── TRANSACTIONS TAB ── */}
      {activeTab==="transactions"&&(
        <div style={S.section}>
          <h2 style={S.h2}>Transactions</h2>
          <p style={S.sub}>{displayTxns.length} transactions · page {txnPage+1} of {txnPageCount||1} · click any row to edit</p>

          {/* Filters */}
          <div style={{...S.card,marginBottom:14}}>
            <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
              <input style={{...S.input,flex:1,minWidth:180}} placeholder="Search descriptions..." value={searchTerm} onChange={e=>setSearchTerm(e.target.value)}/>
              <select style={S.input} value={sortBy} onChange={e=>setSortBy(e.target.value)}>
                <option value="date">Sort: Date</option>
                <option value="amount">Sort: Amount</option>
                <option value="desc">Sort: Description</option>
              </select>
              <label style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:"#64748b",cursor:"pointer",whiteSpace:"nowrap"}}>
                <input type="checkbox" checked={showExcluded} onChange={e=>setShowExcluded(e.target.checked)}/> Show excluded
              </label>
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:10}}>
              {["All",...categories.map(c=>c.id)].map(cat=>(
                <button key={cat} style={{...S.btn(catFilter===cat?"primary":"ghost"),padding:"5px 10px",fontSize:11,
                  ...(catFilter!==cat&&cat!=="All"?{borderColor:getCat(cat).color+"44",color:getCat(cat).color}:{})}}
                  onClick={()=>setCatFilter(cat)}>
                  {cat==="All"?"All":getCat(cat).name}
                </button>
              ))}
            </div>
          </div>

          <div style={{...S.card,overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead>
                <tr style={{borderBottom:"1px solid #1e293b"}}>
                  {["Date","Description","Account","Category","Amount","Note"].map(h=>(
                    <th key={h} style={{textAlign:"left",padding:"9px 10px",color:"#475569",fontWeight:700,fontSize:10,letterSpacing:1,textTransform:"uppercase"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {txnPageItems.map(t=>{
                  const cat=getCat(t.category);
                  return (
                    <tr key={t.id} onClick={()=>setEditingTxn(t)}
                      style={{borderBottom:"1px solid #0d1525",cursor:"pointer",opacity:t.excluded?0.4:1,transition:"background 0.1s"}}
                      onMouseEnter={e=>e.currentTarget.style.background="#0f1929"}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      <td style={{padding:"9px 10px",color:"#64748b",whiteSpace:"nowrap"}}>{t.date.toLocaleDateString()}</td>
                      <td style={{padding:"9px 10px",color:"#cbd5e1",maxWidth:260,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={t.description}>
                        {t.excluded&&<span style={{color:"#f4845f",marginRight:5,fontSize:10}}>EXCL</span>}
                        {t.description}
                      </td>
                      <td style={{padding:"9px 10px",color:"#475569",fontSize:11,whiteSpace:"nowrap"}}>{t.account}</td>
                      <td style={{padding:"9px 10px"}}>
                        <span style={{background:cat.color+"22",color:cat.color,border:`1px solid ${cat.color}44`,borderRadius:4,padding:"2px 7px",fontSize:10,fontWeight:700,whiteSpace:"nowrap"}}>{cat.name}</span>
                      </td>
                      <td style={{padding:"9px 10px",fontWeight:700,color:t.amount>0?"#2dd4a7":"#f4845f",textAlign:"right",whiteSpace:"nowrap"}}>
                        {t.amount>0?"+":""}{fmt(t.amount)}
                      </td>
                      <td style={{padding:"9px 10px",color:"#475569",fontSize:11,maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                        {t.note&&<span style={{color:"#94a3b8"}}>📝 {t.note}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Pagination controls */}
            {txnPageCount > 1 && (
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",borderTop:"1px solid #1e293b",flexWrap:"wrap",gap:8}}>
                <span style={{fontSize:11,color:"#475569"}}>
                  {txnPage*TXN_PAGE_SIZE+1}–{Math.min((txnPage+1)*TXN_PAGE_SIZE,displayTxns.length)} of {displayTxns.length}
                </span>
                <div style={{display:"flex",gap:5,alignItems:"center",flexWrap:"wrap"}}>
                  <button onClick={()=>setTxnPage(0)} disabled={txnPage===0}
                    style={{...S.btn("ghost"),padding:"5px 10px",fontSize:11,opacity:txnPage===0?0.3:1}}>«</button>
                  <button onClick={()=>setTxnPage(p=>Math.max(0,p-1))} disabled={txnPage===0}
                    style={{...S.btn("ghost"),padding:"5px 10px",fontSize:11,opacity:txnPage===0?0.3:1}}>‹ Prev</button>
                  {Array.from({length:Math.min(7,txnPageCount)},(_,i)=>{
                    // Show pages around current page
                    let p;
                    if (txnPageCount<=7) p=i;
                    else if (txnPage<4) p=i;
                    else if (txnPage>txnPageCount-5) p=txnPageCount-7+i;
                    else p=txnPage-3+i;
                    return (
                      <button key={p} onClick={()=>setTxnPage(p)}
                        style={{...S.btn(p===txnPage?"primary":"ghost"),padding:"5px 10px",fontSize:11,minWidth:32}}>
                        {p+1}
                      </button>
                    );
                  })}
                  <button onClick={()=>setTxnPage(p=>Math.min(txnPageCount-1,p+1))} disabled={txnPage===txnPageCount-1}
                    style={{...S.btn("ghost"),padding:"5px 10px",fontSize:11,opacity:txnPage===txnPageCount-1?0.3:1}}>Next ›</button>
                  <button onClick={()=>setTxnPage(txnPageCount-1)} disabled={txnPage===txnPageCount-1}
                    style={{...S.btn("ghost"),padding:"5px 10px",fontSize:11,opacity:txnPage===txnPageCount-1?0.3:1}}>»</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── INCOME TAB ── */}
      {activeTab==="income"&&(
        <div style={S.section}>
          <h2 style={S.h2}>Income Breakdown</h2>
          <p style={S.sub}>Income split by type · {recentMonths.length}-month average</p>

          <div style={{...S.row,marginBottom:16}}>
            <div style={S.statCard}>
              <div style={S.label}>Total Avg Monthly Income</div>
              <div style={{fontFamily:"'DM Serif Display',serif",fontSize:30,color:"#2dd4a7"}}>{fmt(avgIncome)}</div>
            </div>
            {incomeCats.filter(c=>(incomeBreakdown[c.id]||0)>0).map(c=>(
              <div key={c.id} style={S.statCard}>
                <div style={{...S.label,color:c.color}}>{c.name}</div>
                <div style={{fontFamily:"'DM Serif Display',serif",fontSize:24,color:c.color}}>{fmt(incomeBreakdown[c.id]||0)}</div>
                <div style={{color:"#475569",fontSize:11,marginTop:4}}>avg / month</div>
              </div>
            ))}
          </div>

          <div style={S.card}>
            <div style={S.h3}>Monthly Income by Source</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={recentMonths.map(month=>{
                const mt=activeTxns.filter(t=>t.month===month);
                const row={month,label:fmtMonth(month)};
                // Use Math.abs — some banks store income credits as negative numbers
                incomeCats.forEach(c=>{ row[c.id]=mt.filter(t=>t.category===c.id).reduce((s,t)=>s+Math.abs(t.amount),0); });
                // Also catch any "Income" legacy transactions that haven't been migrated yet
                const legacyIncome = mt.filter(t=>t.category==='Income' && !incomeCats.find(c=>c.id==='Income')).reduce((s,t)=>s+Math.abs(t.amount),0);
                if (legacyIncome > 0) row['W2 Payroll'] = (row['W2 Payroll']||0) + legacyIncome;
                return row;
              })}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
                <XAxis dataKey="label" tick={{fill:"#64748b",fontSize:11}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fill:"#64748b",fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`}/>
                <Tooltip formatter={v=>fmt(v)} contentStyle={{background:"#0f1929",border:"1px solid #1e293b",borderRadius:8,color:"#e2e8f0"}}/>
                {incomeCats.map(c=><Bar key={c.id} dataKey={c.id} name={c.name} fill={c.color} stackId="a" radius={[0,0,0,0]}/>)}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{...S.card,marginTop:14}}>
            <div style={S.h3}>Income Transactions</div>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead>
                <tr style={{borderBottom:"1px solid #1e293b"}}>
                  {["Date","Description","Account","Type","Amount"].map(h=>(
                    <th key={h} style={{textAlign:"left",padding:"8px 10px",color:"#475569",fontWeight:700,fontSize:10,letterSpacing:1,textTransform:"uppercase"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeTxns.filter(isIncomeTxn).sort((a,b)=>b.date-a.date).slice(0,100).map(t=>{
                  const cat=getCat(t.category);
                  return (
                    <tr key={t.id} onClick={()=>setEditingTxn(t)} style={{borderBottom:"1px solid #0d1525",cursor:"pointer"}}
                      onMouseEnter={e=>e.currentTarget.style.background="#0f1929"}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      <td style={{padding:"8px 10px",color:"#64748b",whiteSpace:"nowrap"}}>{t.date.toLocaleDateString()}</td>
                      <td style={{padding:"8px 10px",color:"#cbd5e1",maxWidth:280,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.description}</td>
                      <td style={{padding:"8px 10px",color:"#475569",fontSize:11}}>{t.account}</td>
                      <td style={{padding:"8px 10px"}}>
                        <span style={{background:cat.color+"22",color:cat.color,borderRadius:4,padding:"2px 7px",fontSize:10,fontWeight:700}}>{cat.name}</span>
                      </td>
                      <td style={{padding:"8px 10px",fontWeight:700,color:"#2dd4a7",textAlign:"right"}}>{fmt(Math.abs(t.amount))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── BUDGET TAB ── */}
      {activeTab==="budget"&&budget&&(
        <div style={S.section}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:12,marginBottom:16}}>
            <div>
              <h2 style={S.h2}>Budget &amp; Spending Plan</h2>
              <p style={S.sub}>Based on {recentMonths.length} months of actual history · adjust numbers to plan forward</p>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button style={{...S.btn(),fontSize:11,padding:"7px 14px"}} onClick={()=>{setBudget({...editBudget});showToast("Budget saved!");}}>Save Budget</button>
              <button style={{...S.btn("ghost"),fontSize:11,padding:"7px 14px"}} onClick={()=>{
                const b={};
                budgetCats.forEach(cat=>{b[cat.id]=Math.round(categoryTotals[cat.id]||benchmark[cat.id]||0);});
                setEditBudget(b);showToast("Reset to your actual spending averages");
              }}>Reset to Actuals</button>
            </div>
          </div>

          {/* ── Summary stat strip ── */}
          {(()=>{
            const totalBudgeted = Object.values(editBudget).reduce((a,b)=>a+b,0);
            const surplus = avgIncome - totalBudgeted;
            const totalActual = budgetCats.reduce((s,c)=>s+(categoryPeriodTotals[c.id]||0),0);
            return (
              <div style={{...S.row,marginBottom:16}}>
                {[
                  {label:"Avg Monthly Income",    val:fmt(avgIncome),          color:"#2dd4a7",  sub:`${recentMonths.length}-mo avg`},
                  {label:"Avg Monthly Spending",  val:fmt(avgExpenses),        color:"#f4845f",  sub:`${recentMonths.length}-mo avg`},
                  {label:"Avg Cash Flow",         val:fmtS(avgCashflow),       color:avgCashflow>=0?"#2dd4a7":"#f4845f", sub:"income − expenses"},
                  {label:"Monthly Budget",        val:fmt(totalBudgeted),      color:"#e8c547",  sub:"what you've planned"},
                  {label:"Projected Surplus",     val:fmtS(surplus),           color:surplus>=0?"#2dd4a7":"#f4845f", sub:`if you stick to budget`},
                  {label:`Total Spent (${recentMonths.length}mo)`,val:fmt(totalActual),color:"#94a3b8",sub:"actual period total"},
                ].map(s=>(
                  <div key={s.label} style={S.statCard}>
                    <div style={S.label}>{s.label}</div>
                    <div style={{fontFamily:"'DM Serif Display',serif",fontSize:22,color:s.color,lineHeight:1.1}}>{s.val}</div>
                    <div style={{fontSize:10,color:"#334155",marginTop:4}}>{s.sub}</div>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* ── Main budget table ── */}
          <div style={S.row}>
            <div style={{flex:2}}>
              <div style={S.card}>
                {/* Header */}
                <div style={{display:"flex",alignItems:"center",gap:10,padding:"0 0 10px",borderBottom:"2px solid #1e293b",marginBottom:6}}>
                  <div style={{width:10,flexShrink:0}}/>
                  <div style={{flex:1,fontSize:10,color:"#475569",fontWeight:700,letterSpacing:1,textTransform:"uppercase"}}>Category</div>
                  <div style={{width:75,textAlign:"right",fontSize:10,color:"#475569",fontWeight:700,letterSpacing:1,textTransform:"uppercase"}}>Period Total</div>
                  <div style={{width:75,textAlign:"right",fontSize:10,color:"#475569",fontWeight:700,letterSpacing:1,textTransform:"uppercase"}}>Avg/Mo</div>
                  <div style={{width:80,textAlign:"right",fontSize:10,color:"#475569",fontWeight:700,letterSpacing:1,textTransform:"uppercase"}}>BLS Bench</div>
                  <div style={{width:110,textAlign:"right",fontSize:10,color:"#e8c547",fontWeight:700,letterSpacing:1,textTransform:"uppercase"}}>Monthly Budget</div>
                  <div style={{width:70,textAlign:"right",fontSize:10,color:"#475569",fontWeight:700,letterSpacing:1,textTransform:"uppercase"}}>Diff</div>
                </div>

                {budgetCats.sort((a,b)=>(categoryPeriodTotals[b.id]||0)-(categoryPeriodTotals[a.id]||0)).map(cat=>{
                  const periodTotal = categoryPeriodTotals[cat.id]||0;
                  const avgMo       = Math.round(categoryTotals[cat.id]||0);
                  const budgeted    = editBudget[cat.id]||0;
                  const bench       = benchmark[cat.id];
                  const diff        = budgeted - avgMo;
                  const hasActivity = periodTotal > 0;
                  const activeMonths= categoryActiveMonths[cat.id]||0;
                  return (
                    <div key={cat.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:"1px solid #0d1525",opacity:hasActivity?1:0.45}}>
                      <div style={{width:10,height:10,borderRadius:"50%",background:cat.color,flexShrink:0}}/>
                      <div style={{flex:1}}>
                        <div style={{fontSize:13,fontWeight:600}}>{cat.name}</div>
                        {hasActivity&&<div style={{fontSize:10,color:"#334155",marginTop:1}}>
                          {activeMonths} of {recentMonths.length} months had spending
                        </div>}
                      </div>
                      {/* Period total — what you actually spent */}
                      <div style={{width:75,textAlign:"right"}}>
                        <div style={{fontSize:12,fontWeight:700,color:hasActivity?"#cbd5e1":"#334155"}}>{hasActivity?fmt(periodTotal):"—"}</div>
                      </div>
                      {/* Avg/month */}
                      <div style={{width:75,textAlign:"right"}}>
                        <div style={{fontSize:12,fontWeight:600,color:hasActivity?"#94a3b8":"#334155"}}>{hasActivity?fmt(avgMo):"—"}</div>
                      </div>
                      {/* BLS benchmark */}
                      <div style={{width:80,textAlign:"right",fontSize:11,color:"#475569"}}>{bench?fmt(bench):"—"}</div>
                      {/* Editable budget */}
                      <div style={{width:110,display:"flex",alignItems:"center",gap:4,justifyContent:"flex-end"}}>
                        <span style={{color:"#475569",fontSize:12}}>$</span>
                        <input type="number" value={budgeted} onChange={e=>setEditBudget(p=>({...p,[cat.id]:Math.max(0,+e.target.value)}))}
                          style={{...S.input,width:80,padding:"5px 7px",textAlign:"right",fontWeight:700,
                            color:"#e8c547",borderColor:"#2a3a1a"}}/>
                      </div>
                      {/* Diff: budget vs historical avg */}
                      <div style={{width:70,textAlign:"right",fontSize:11,fontWeight:600,
                        color:!hasActivity?"#334155":diff<-50?"#f4845f":diff>50?"#2dd4a7":"#64748b"}}>
                        {hasActivity?(diff>=0?"+":"")+fmt(diff):"—"}
                      </div>
                    </div>
                  );
                })}

                {/* Totals row */}
                {(()=>{
                  const totalBudgeted = budgetCats.reduce((s,c)=>s+(editBudget[c.id]||0),0);
                  const totalAvg      = budgetCats.reduce((s,c)=>s+(categoryTotals[c.id]||0),0);
                  const totalPeriod   = budgetCats.reduce((s,c)=>s+(categoryPeriodTotals[c.id]||0),0);
                  return (
                    <div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 0 0",borderTop:"2px solid #1e293b",marginTop:4}}>
                      <div style={{width:10}}/>
                      <div style={{flex:1,fontSize:13,fontWeight:700,color:"#e2e8f0"}}>TOTAL</div>
                      <div style={{width:75,textAlign:"right",fontSize:12,fontWeight:700,color:"#cbd5e1"}}>{fmt(totalPeriod)}</div>
                      <div style={{width:75,textAlign:"right",fontSize:12,fontWeight:700,color:"#94a3b8"}}>{fmt(totalAvg)}</div>
                      <div style={{width:80}}/>
                      <div style={{width:110,textAlign:"right",fontSize:14,fontWeight:800,color:"#e8c547",paddingRight:4}}>{fmt(totalBudgeted)}</div>
                      <div style={{width:70,textAlign:"right",fontSize:11,fontWeight:700,
                        color:(totalBudgeted-totalAvg)>0?"#2dd4a7":"#f4845f"}}>
                        {(totalBudgeted-totalAvg)>=0?"+":""}{fmt(totalBudgeted-totalAvg)}
                      </div>
                    </div>
                  );
                })()}

                {/* Excluded categories */}
                <div style={{marginTop:14,padding:"12px",background:"#0a1628",borderRadius:8,border:"1px solid #1e293b"}}>
                  <div style={{fontSize:10,color:"#475569",fontWeight:700,marginBottom:6,letterSpacing:1,textTransform:"uppercase"}}>Excluded from budget (pass-through)</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                    {categories.filter(c=>c.excludeFromBudget).map(c=>(
                      <span key={c.id} style={{background:c.color+"22",color:c.color,borderRadius:4,padding:"2px 8px",fontSize:11}}>{c.name}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Right column — charts + notes */}
            <div style={{flex:1,display:"flex",flexDirection:"column",gap:12}}>
              {/* Visual bar — budget vs income */}
              {(()=>{
                const totalBudgeted = budgetCats.reduce((s,c)=>s+(editBudget[c.id]||0),0);
                const surplus = avgIncome - totalBudgeted;
                const pct = Math.min(100,(totalBudgeted/avgIncome)*100);
                return (
                  <div style={S.card}>
                    <div style={S.label}>Budget vs. Income</div>
                    <div style={{marginTop:8}}>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:4}}>
                        <span style={{color:"#e8c547",fontWeight:700}}>{fmt(totalBudgeted)} budgeted</span>
                        <span style={{color:surplus>=0?"#2dd4a7":"#f4845f",fontWeight:700}}>{fmt(avgIncome)} avg income</span>
                      </div>
                      <div style={{height:10,background:"#1e293b",borderRadius:5,overflow:"hidden"}}>
                        <div style={{height:10,width:`${pct}%`,background:pct>100?"#f4845f":pct>85?"#e8c547":"#2dd4a7",borderRadius:5,transition:"width 0.5s ease"}}/>
                      </div>
                      <div style={{fontSize:11,color:surplus>=0?"#2dd4a7":"#f4845f",fontWeight:700,marginTop:6,textAlign:"right"}}>
                        {surplus>=0?"✓ ":"⚠ "}{fmt(Math.abs(surplus))} {surplus>=0?"surplus":"over budget"}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Top categories bar chart */}
              <div style={S.card}>
                <div style={S.h3}>Top Spending vs. Budget</div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart layout="vertical"
                    data={budgetCats.filter(c=>(categoryPeriodTotals[c.id]||0)>0)
                      .sort((a,b)=>(categoryPeriodTotals[b.id]||0)-(categoryPeriodTotals[a.id]||0)).slice(0,8)
                      .map(c=>({name:c.name,avg:Math.round(categoryTotals[c.id]||0),budget:editBudget[c.id]||0,color:c.color}))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false}/>
                    <XAxis type="number" tick={{fill:"#64748b",fontSize:9}} axisLine={false} tickLine={false} tickFormatter={v=>`$${v}`}/>
                    <YAxis type="category" dataKey="name" tick={{fill:"#94a3b8",fontSize:10}} axisLine={false} tickLine={false} width={80}/>
                    <Tooltip formatter={v=>fmt(v)} contentStyle={{background:"#0f1929",border:"1px solid #1e293b",borderRadius:8,color:"#e2e8f0",fontSize:11}}/>
                    <Bar dataKey="avg" name="Avg/Month" fill="#94a3b833" stroke="#94a3b8" strokeWidth={1} radius={[0,3,3,0]}/>
                    <Bar dataKey="budget" name="Budget" fill="#e8c547" radius={[0,3,3,0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Upload month to compare */}
              <div style={{...S.card,background:"#0a1a0f",borderColor:"#1a3a2a"}}>
                <div style={{fontSize:12,color:"#4ade80",fontWeight:700,marginBottom:6}}>📊 Track this month</div>
                <p style={{fontSize:12,color:"#64748b",margin:"0 0 10px",lineHeight:1.6}}>Upload a fresh CSV to compare this month's actual spending against your budget in real time.</p>
                <label style={{...S.btn("ghost"),display:"block",textAlign:"center",padding:"9px",fontSize:11,cursor:"pointer",borderColor:"#1a3a2a",color:"#4ade80"}}>
                  Upload New Month CSV<input type="file" accept=".csv" style={{display:"none"}} onChange={e=>e.target.files[0]&&handleNewMonth(e.target.files[0])}/>
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── COMPARE TAB ── */}
      {activeTab==="compare"&&budget&&(
        <div style={S.section}>
          <h2 style={S.h2}>Month vs. Budget</h2>
          <p style={S.sub}>{newMonthTxns.length} transactions · investments & transfers excluded</p>

          <div style={{...S.row,marginBottom:16}}>
            {[["New Month Income",fmt(newMonthIncome),"#2dd4a7"],["New Month Expenses",fmt(newMonthExpenses),"#f4845f"],
              ["Cash Flow",fmtS(newMonthIncome-newMonthExpenses),newMonthIncome-newMonthExpenses>=0?"#2dd4a7":"#f4845f"],
              ["vs. Historical Avg",fmtS((newMonthIncome-newMonthExpenses)-avgCashflow),"#e8c547"]
            ].map(([label,val,color])=>(
              <div key={label} style={S.statCard}>
                <div style={S.label}>{label}</div>
                <div style={{fontFamily:"'DM Serif Display',serif",fontSize:26,color}}>{val}</div>
              </div>
            ))}
          </div>

          <div style={{...S.card,marginBottom:14}}>
            <div style={S.h3}>Budget vs. Actual by Category</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={Object.entries(budget).map(([id,budgeted])=>({cat:getCat(id).name,budgeted,actual:Math.round(newMonthCats[id]||0)}))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
                <XAxis dataKey="cat" tick={{fill:"#64748b",fontSize:10}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fill:"#64748b",fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>`$${v}`}/>
                <Tooltip formatter={v=>fmt(v)} contentStyle={{background:"#0f1929",border:"1px solid #1e293b",borderRadius:8,color:"#e2e8f0"}}/>
                <Bar dataKey="budgeted" fill="#e8c54733" stroke="#e8c547" strokeWidth={1} name="Budget" radius={[4,4,0,0]}/>
                <Bar dataKey="actual" name="Actual" radius={[4,4,0,0]}>
                  {Object.entries(budget).map(([id,budgeted],i)=>(
                    <Cell key={i} fill={(newMonthCats[id]||0)>budgeted?"#f4845f":"#2dd4a7"}/>
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={S.card}>
            <div style={S.h3}>Category Detail</div>
            {Object.entries(budget).map(([id,budgeted])=>{
              const cat=getCat(id), actual=newMonthCats[id]||0, diff=actual-budgeted, over=diff>0;
              const pct=budgeted>0?Math.min(100,(actual/budgeted)*100):0;
              return (
                <div key={id} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 0",borderBottom:"1px solid #0d1525"}}>
                  <div style={{width:10,height:10,borderRadius:"50%",background:cat.color,flexShrink:0}}/>
                  <div style={{flex:1,fontSize:12,fontWeight:600}}>{cat.name}</div>
                  <div style={{fontSize:11,color:"#475569"}}>Hist: {fmt(categoryTotals[id]||0)}</div>
                  <div style={{width:120,textAlign:"right",fontSize:11}}>
                    <span style={{color:"#94a3b8"}}>{fmt(actual)}</span>
                    <span style={{color:"#475569"}}> / {fmt(budgeted)}</span>
                  </div>
                  <div style={{width:65,textAlign:"right",fontWeight:700,fontSize:12,color:over?"#f4845f":"#2dd4a7"}}>{over?"+":""}{fmtS(diff)}</div>
                  <div style={{width:80,height:5,background:"#1e293b",borderRadius:3,flexShrink:0}}>
                    <div style={{height:5,width:`${pct}%`,background:over?"#f4845f":"#2dd4a7",borderRadius:3}}/>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{marginTop:12,textAlign:"right"}}>
            <button style={{...S.btn("ghost"),fontSize:12}} onClick={()=>{setTransactions(prev=>[...prev,...newMonthTxns]);setNewMonthTxns([]);showToast("Month added to history!");}}>
              Add This Month to History →
            </button>
          </div>
        </div>
      )}

      {/* ── WALMART TAB ── */}
      {activeTab==="walmart"&&walmartSummary&&(
        <div style={S.section}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:12,marginBottom:4}}>
            <div>
              <h2 style={S.h2}>🛍 Walmart Order Analysis</h2>
              <p style={S.sub}>{walmartSummary.activeItems.length} items · {fmt(walmartSummary.totalSpend)} total · {fmt(walmartSummary.totalReturns)} in returns</p>
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <button style={{...S.btn("ghost"),fontSize:11,borderColor:"#e8c547",color:"#e8c547"}} onClick={reconcileWalmart}>
                ⟳ Reconcile Bank Charges
              </button>
              <label style={{...S.btn("ghost"),fontSize:11,cursor:"pointer",borderColor:"#f97316",color:"#f97316"}}>
                Replace Orders CSV<input type="file" accept=".csv" style={{display:"none"}} onChange={e=>e.target.files[0]&&handleWalmartFile(e.target.files[0])}/>
              </label>
            </div>
          </div>

          {/* Reconcile explanation */}
          <div style={{background:"#0d1b2e",border:"1px solid #1e3a5f",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#475569",lineHeight:1.6}}>
            <span style={{color:"#60a5fa",fontWeight:700}}>Reconcile</span> re-categorizes your bank's "WAL-MART" charges from generic Food/Shopping into the correct Ledger categories based on your order data. Run once after uploading both your bank CSV and your Walmart order CSV.
          </div>

          {/* Stat strip */}
          <div style={{...S.row,marginBottom:16}}>
            {[
              {label:"Total Spend",     val:fmt(walmartSummary.totalSpend),   color:"#f97316"},
              {label:"Returns",         val:fmt(walmartSummary.totalReturns), color:"#2dd4a7"},
              {label:"Net Spend",       val:fmt(walmartSummary.netSpend),     color:"#c47ef4"},
              {label:"Avg / Month",     val:fmt(walmartSummary.netSpend/3),   color:"#5f9cf4"},
              {label:"Unique Items",    val:walmartSummary.activeItems.length, color:"#e8c547"},
            ].map(s=>(
              <div key={s.label} style={S.statCard}>
                <div style={S.label}>{s.label}</div>
                <div style={{fontFamily:"'DM Serif Display',serif",fontSize:26,color:s.color}}>{s.val}</div>
              </div>
            ))}
          </div>

          {/* Sub-tabs */}
          <div style={{display:"flex",gap:2,marginBottom:16,borderBottom:"1px solid #1e293b"}}>
            {["summary","by category","all items","returns","reconcile"].map(t=>(
              <button key={t} style={{...S.navBtn(walmartTab===t),fontSize:11}} onClick={()=>setWalmartTab(t)}>{t.charAt(0).toUpperCase()+t.slice(1)}</button>
            ))}
          </div>

          {/* Summary sub-tab */}
          {walmartTab==="summary"&&(
            <div>
              <div style={{...S.row,marginBottom:14}}>
                <div style={{...S.card,flex:1,minWidth:280}}>
                  <div style={S.h3}>Spend by Sub-Category</div>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={Object.values(walmartSummary.byCategory).sort((a,b)=>b.total-a.total).slice(0,10)} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false}/>
                      <XAxis type="number" tick={{fill:"#64748b",fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>`$${v}`}/>
                      <YAxis type="category" dataKey="sub" tick={{fill:"#94a3b8",fontSize:10}} axisLine={false} tickLine={false} width={130}/>
                      <Tooltip formatter={v=>fmt(v)} contentStyle={{background:"#0f1929",border:"1px solid #1e293b",borderRadius:8,color:"#e2e8f0"}}/>
                      <Bar dataKey="total" fill="#f97316" radius={[0,4,4,0]}/>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div style={{...S.card,flex:1,minWidth:260}}>
                  <div style={S.h3}>Maps to Ledger Categories</div>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {Object.values(walmartSummary.byCategory).sort((a,b)=>b.total-a.total).map(cat=>{
                      const ledgerColor = getCat(cat.ledgerCat)?.color||"#94a3b8";
                      return (
                        <div key={cat.sub} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0",borderBottom:"1px solid #0d1525"}}>
                          <div style={{width:8,height:8,borderRadius:"50%",background:"#f97316",flexShrink:0}}/>
                          <div style={{flex:1,fontSize:12}}>{cat.sub}</div>
                          <div style={{fontSize:10,color:"#334155"}}>→</div>
                          <span style={{background:ledgerColor+"22",color:ledgerColor,borderRadius:4,padding:"2px 7px",fontSize:10,fontWeight:700}}>{cat.ledgerCat}</span>
                          <div style={{fontSize:12,fontWeight:700,color:"#f97316",minWidth:60,textAlign:"right"}}>{fmt(cat.total)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Key insight callouts */}
              <div style={{...S.row}}>
                {[
                  {icon:"⛽",title:"Gas: 53% of Walmart spend",body:`$${Math.round(walmartSummary.byCategory["Fuel"]?.total||0)} across ${walmartSummary.byCategory["Fuel"]?.count||0} fill-ups. ~$414/month just in Walmart gas. Largest single line item by far.`,color:"#f97316"},
                  {icon:"🛒",title:"Groceries: 30% of spend",body:`$${Math.round(walmartSummary.byCategory["Grocery"]?.total||0)} on food and fresh produce. Heavy on fresh items — bananas, avocados, salad kits, quality proteins.`,color:"#22c55e"},
                  {icon:"👗",title:"Kids clothing is recurring",body:`$${Math.round((walmartSummary.byCategory["Kids Clothing"]?.total||0)+(walmartSummary.byCategory["Clothing"]?.total||0))} on apparel. Multiple Justice ballet leotards — a budgetable recurring expense.`,color:"#f472b6"},
                ].map(ins=>(
                  <div key={ins.title} style={{...S.card,flex:1,minWidth:220,borderColor:ins.color+"33"}}>
                    <div style={{fontSize:22,marginBottom:8}}>{ins.icon}</div>
                    <div style={{fontSize:13,fontWeight:700,color:ins.color,marginBottom:6}}>{ins.title}</div>
                    <div style={{fontSize:12,color:"#64748b",lineHeight:1.6}}>{ins.body}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* By Category sub-tab */}
          {walmartTab==="by category"&&(
            <div style={{display:"flex",flexDirection:"column",gap:7}}>
              {Object.values(walmartSummary.byCategory).sort((a,b)=>b.total-a.total).map(cat=>{
                const ledgerColor = getCat(cat.ledgerCat)?.color||"#94a3b8";
                const pct = (cat.total/walmartSummary.totalSpend)*100;
                return (
                  <div key={cat.sub} style={{...S.card,padding:"14px 18px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:8}}>
                      <div style={{flex:1,fontWeight:700,fontSize:13}}>{cat.sub}</div>
                      <span style={{background:ledgerColor+"22",color:ledgerColor,borderRadius:4,padding:"2px 8px",fontSize:10,fontWeight:700}}>{cat.ledgerCat}</span>
                      <div style={{fontWeight:800,fontSize:16,color:"#f97316"}}>{fmt(cat.total)}</div>
                      <div style={{fontSize:11,color:"#475569"}}>{pct.toFixed(1)}% · {cat.count} items</div>
                    </div>
                    <div style={{height:5,background:"#1e293b",borderRadius:3}}>
                      <div style={{height:5,width:`${Math.min(100,pct)}%`,background:"#f97316",borderRadius:3}}/>
                    </div>
                    <div style={{marginTop:10,display:"flex",flexWrap:"wrap",gap:5}}>
                      {cat.items.slice(0,6).map((item,i)=>(
                        <span key={i} style={{background:"#0a0f1a",border:"1px solid #1e293b",borderRadius:5,padding:"3px 8px",fontSize:10,color:"#64748b"}}>
                          {item.name.slice(0,45)}{item.name.length>45?"…":""} ({fmt(item.total)})
                        </span>
                      ))}
                      {cat.items.length>6&&<span style={{fontSize:10,color:"#334155"}}>+{cat.items.length-6} more</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* All items sub-tab */}
          {walmartTab==="all items"&&(
            <div style={{...S.card,overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead>
                  <tr style={{borderBottom:"1px solid #1e293b"}}>
                    {["Product","Qty","Price","Category","Maps To","Status"].map(h=>(
                      <th key={h} style={{textAlign:"left",padding:"8px 10px",color:"#475569",fontWeight:700,fontSize:10,letterSpacing:1,textTransform:"uppercase"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {walmartSummary.activeItems.sort((a,b)=>b.total-a.total).map((item,i)=>{
                    const ledgerColor = getCat(item.ledgerCat)?.color||"#94a3b8";
                    return (
                      <tr key={i} style={{borderBottom:"1px solid #0d1525"}}
                        onMouseEnter={e=>e.currentTarget.style.background="#0f1929"}
                        onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                        <td style={{padding:"8px 10px",color:"#cbd5e1",maxWidth:300,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={item.name}>{item.name}</td>
                        <td style={{padding:"8px 10px",color:"#475569",textAlign:"center"}}>{item.qty}</td>
                        <td style={{padding:"8px 10px",color:"#f97316",fontWeight:700,textAlign:"right"}}>{fmt(item.total)}</td>
                        <td style={{padding:"8px 10px"}}>
                          <span style={{background:"#f9731622",color:"#f97316",borderRadius:4,padding:"2px 7px",fontSize:10,fontWeight:700}}>{item.sub}</span>
                        </td>
                        <td style={{padding:"8px 10px"}}>
                          <span style={{background:ledgerColor+"22",color:ledgerColor,borderRadius:4,padding:"2px 7px",fontSize:10,fontWeight:700}}>{item.ledgerCat}</span>
                        </td>
                        <td style={{padding:"8px 10px",color:"#475569",fontSize:11}}>{item.status}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Returns sub-tab */}
          {walmartTab==="returns"&&(
            <div>
              <div style={{background:"#0a1f0a",border:"1px solid #166534",borderRadius:10,padding:"14px 18px",marginBottom:14,display:"flex",gap:14,alignItems:"center"}}>
                <span style={{fontSize:24}}>✅</span>
                <div>
                  <div style={{fontWeight:700,color:"#22c55e",fontSize:13}}>{fmt(walmartSummary.totalReturns)} recovered in {walmartSummary.returnItems.length} returns</div>
                  <div style={{fontSize:11,color:"#4ade80",marginTop:2}}>Good return rate — {((walmartSummary.totalReturns/walmartSummary.totalSpend)*100).toFixed(1)}% of spend recovered</div>
                </div>
              </div>
              {walmartSummary.returnItems.map((item,i)=>(
                <div key={i} style={{...S.card,padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <div>
                    <div style={{fontSize:13,color:"#cbd5e1"}}>{item.name}</div>
                    <div style={{fontSize:11,color:"#475569",marginTop:2}}>{item.status}</div>
                  </div>
                  <div style={{fontWeight:700,color:"#22c55e",fontSize:14}}>{fmt(item.total)}</div>
                </div>
              ))}
            </div>
          )}

          {/* Reconcile sub-tab — match Walmart order data to bank transactions */}
          {walmartTab==="reconcile"&&(()=>{
            // Find all bank transactions that look like Walmart charges
            const walmartBankTxns = activeTxns.filter(t =>
              t.description.toLowerCase().includes("walmart") ||
              t.description.toLowerCase().includes("wal-mart")
            ).sort((a,b) => b.date - a.date);

            // Build monthly breakdown from walmart orders
            const walmartOrdersByLedgerCat = {};
            walmartSummary.activeItems.forEach(item => {
              const cat = item.ledgerCat;
              walmartOrdersByLedgerCat[cat] = (walmartOrdersByLedgerCat[cat]||0) + item.total;
            });

            const bankWalmartTotal = walmartBankTxns.reduce((s,t)=>s+Math.abs(t.amount),0);

            return (
              <div>
                <div style={{...S.card,marginBottom:14,background:"#0a1a2e",borderColor:"#1e4080"}}>
                  <div style={{fontWeight:700,color:"#60a5fa",fontSize:13,marginBottom:8}}>How Reconciliation Works</div>
                  <div style={{fontSize:12,color:"#475569",lineHeight:1.7}}>
                    Your bank statements show Walmart charges as a single line (e.g. "WAL-MART SUPERCENTER $312"). 
                    Your order history breaks those same charges into actual items. This tab shows the gap — and lets you 
                    recategorize your bank's Walmart charges to match what you actually bought.
                  </div>
                </div>

                <div style={{...S.row,marginBottom:14}}>
                  <div style={S.statCard}>
                    <div style={S.label}>Bank: Walmart Charges</div>
                    <div style={{fontFamily:"'DM Serif Display',serif",fontSize:26,color:"#f97316"}}>{fmt(bankWalmartTotal)}</div>
                    <div style={{fontSize:11,color:"#475569",marginTop:4}}>{walmartBankTxns.length} transactions</div>
                  </div>
                  <div style={S.statCard}>
                    <div style={S.label}>Orders: Active Spend</div>
                    <div style={{fontFamily:"'DM Serif Display',serif",fontSize:26,color:"#f97316"}}>{fmt(walmartSummary.totalSpend)}</div>
                    <div style={{fontSize:11,color:"#475569",marginTop:4}}>{walmartSummary.activeItems.length} items</div>
                  </div>
                  <div style={S.statCard}>
                    <div style={S.label}>Gap</div>
                    <div style={{fontFamily:"'DM Serif Display',serif",fontSize:26,color:Math.abs(bankWalmartTotal-walmartSummary.totalSpend)<50?"#2dd4a7":"#e8c547"}}>
                      {fmt(Math.abs(bankWalmartTotal-walmartSummary.totalSpend))}
                    </div>
                    <div style={{fontSize:11,color:"#475569",marginTop:4}}>
                      {Math.abs(bankWalmartTotal-walmartSummary.totalSpend)<50?"Close match ✓":"Timing/date differences likely"}
                    </div>
                  </div>
                </div>

                {/* What the bank currently shows vs. what the orders reveal */}
                <div style={{...S.card,marginBottom:14}}>
                  <div style={S.h3}>Orders breakdown → correct Ledger category</div>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {Object.entries(walmartOrdersByLedgerCat).sort((a,b)=>b[1]-a[1]).map(([catId,total])=>{
                      const cat = getCat(catId);
                      const pct = (total/walmartSummary.totalSpend*100).toFixed(1);
                      return (
                        <div key={catId} style={{display:"flex",alignItems:"center",gap:12,padding:"9px 0",borderBottom:"1px solid #0d1525"}}>
                          <div style={{width:8,height:8,borderRadius:"50%",background:cat.color,flexShrink:0}}/>
                          <div style={{flex:1,fontSize:12,fontWeight:600}}>{cat.name}</div>
                          <div style={{fontSize:11,color:"#475569"}}>{pct}% of orders</div>
                          <div style={{fontWeight:700,fontSize:13,color:cat.color,minWidth:70,textAlign:"right"}}>{fmt(total)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Bank Walmart transactions — click to reclassify */}
                <div style={S.card}>
                  <div style={{...S.h3,marginBottom:6}}>Bank Walmart Transactions</div>
                  <div style={{fontSize:11,color:"#475569",marginBottom:12}}>Click any row to reclassify. Tip: Gas-only trips → Transport. Grocery-only → Food. Mixed → keep as Shopping.</div>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                    <thead>
                      <tr style={{borderBottom:"1px solid #1e293b"}}>
                        {["Date","Description","Current Category","Amount",""].map(h=>(
                          <th key={h} style={{textAlign:"left",padding:"7px 10px",color:"#475569",fontWeight:700,fontSize:10,letterSpacing:1,textTransform:"uppercase"}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {walmartBankTxns.map(t=>{
                        const cat = getCat(t.category);
                        return (
                          <tr key={t.id} style={{borderBottom:"1px solid #0d1525",cursor:"pointer"}}
                            onMouseEnter={e=>e.currentTarget.style.background="#0f1929"}
                            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                            <td style={{padding:"8px 10px",color:"#64748b",whiteSpace:"nowrap"}}>{t.date.toLocaleDateString()}</td>
                            <td style={{padding:"8px 10px",color:"#cbd5e1",maxWidth:240,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.description}</td>
                            <td style={{padding:"8px 10px"}}>
                              <span style={{background:cat.color+"22",color:cat.color,border:`1px solid ${cat.color}44`,borderRadius:4,padding:"2px 7px",fontSize:10,fontWeight:700}}>{cat.name}</span>
                            </td>
                            <td style={{padding:"8px 10px",fontWeight:700,color:"#f97316",textAlign:"right"}}>{fmt(t.amount)}</td>
                            <td style={{padding:"8px 10px",textAlign:"right"}}>
                              <button onClick={()=>setEditingTxn(t)} style={{background:"none",border:"1px solid #334155",borderRadius:5,color:"#64748b",padding:"3px 9px",fontSize:10,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:700}}>
                                Reclassify →
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── AMAZON TAB ── */}
      {activeTab==="amazon"&&amazonItems.length>0&&(()=>{
        const amzSummary = summarizeAmazonItems(amazonItems);
        const amzColor = "#f59e0b";
        return (
          <div style={S.section}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:12,marginBottom:16}}>
              <div>
                <h2 style={S.h2}>Amazon Orders</h2>
                <p style={S.sub}>{amazonItems.length} items · {fmt(amzSummary.netSpend)} net spend</p>
              </div>
              <label style={{...S.btn("ghost"),fontSize:11,cursor:"pointer",borderColor:amzColor,color:amzColor}}>
                Replace Orders CSV<input type="file" accept=".csv" style={{display:"none"}} onChange={e=>e.target.files[0]&&handleAmazonFile(e.target.files[0])}/>
              </label>
            </div>

            {/* Stat strip */}
            <div style={{...S.row,marginBottom:14}}>
              {[
                {label:"Total Spend",    value:fmt(amzSummary.totalSpend),  color:amzColor},
                {label:"Refunds",        value:fmt(amzSummary.totalRefunds), color:"#22c55e"},
                {label:"Net Spend",      value:fmt(amzSummary.netSpend),     color:amzColor},
                {label:"Unique Items",   value:amzSummary.activeItems.length, color:"#94a3b8"},
                {label:"Categories",     value:Object.keys(amzSummary.byCategory).length, color:"#94a3b8"},
              ].map(s=>(
                <div key={s.label} style={S.statCard}>
                  <div style={S.label}>{s.label}</div>
                  <div style={{fontFamily:"'DM Serif Display',serif",fontSize:22,color:s.color}}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Sub-tabs */}
            <div style={{display:"flex",gap:2,marginBottom:16,borderBottom:"1px solid #1e293b"}}>
              {["summary","by category","all items","returns","reconcile"].map(t=>(
                <button key={t} style={{...S.navBtn(amazonTab===t),fontSize:11}} onClick={()=>setAmazonTab(t)}>{t.charAt(0).toUpperCase()+t.slice(1)}</button>
              ))}
            </div>

            {/* Summary sub-tab */}
            {amazonTab==="summary"&&(
              <div>
                <div style={{...S.row,marginBottom:14}}>
                  <div style={{...S.card,flex:1,minWidth:280}}>
                    <div style={S.h3}>Spend by Sub-Category</div>
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={Object.values(amzSummary.byCategory).sort((a,b)=>b.total-a.total).slice(0,10)} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false}/>
                        <XAxis type="number" tick={{fill:"#64748b",fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>`$${v}`}/>
                        <YAxis type="category" dataKey="sub" tick={{fill:"#94a3b8",fontSize:10}} axisLine={false} tickLine={false} width={130}/>
                        <Tooltip formatter={v=>fmt(v)} contentStyle={{background:"#0f1929",border:"1px solid #1e293b",borderRadius:8,color:"#e2e8f0"}}/>
                        <Bar dataKey="total" fill={amzColor} radius={[0,4,4,0]}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{...S.card,flex:1,minWidth:240}}>
                    <div style={S.h3}>Maps to Ledger Categories</div>
                    <div style={{display:"flex",flexDirection:"column",gap:5}}>
                      {Object.values(amzSummary.byCategory).sort((a,b)=>b.total-a.total).map(cat=>{
                        const lc = getCat(cat.ledgerCat);
                        return (
                          <div key={cat.sub} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:"1px solid #0d1525"}}>
                            <div style={{width:7,height:7,borderRadius:"50%",background:amzColor,flexShrink:0}}/>
                            <div style={{flex:1,fontSize:11}}>{cat.sub}</div>
                            <span style={{background:lc.color+"22",color:lc.color,borderRadius:4,padding:"2px 6px",fontSize:10,fontWeight:700}}>{cat.ledgerCat}</span>
                            <div style={{fontSize:11,fontWeight:700,color:amzColor,minWidth:55,textAlign:"right"}}>{fmt(cat.total)}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* How to export callout */}
                <div style={{...S.card,background:"#0a1628",borderColor:"#1e3a5f"}}>
                  <div style={{fontWeight:700,color:"#60a5fa",fontSize:12,marginBottom:8}}>📥 How to export your Amazon order history</div>
                  <ol style={{fontSize:11,color:"#475569",lineHeight:2,margin:0,paddingLeft:18}}>
                    <li>Go to <span style={{color:"#94a3b8",fontWeight:600}}>amazon.com → Account &amp; Lists → Order History Reports</span></li>
                    <li>Select report type: <span style={{color:"#94a3b8",fontWeight:600}}>Items</span></li>
                    <li>Choose your date range (up to 1 year)</li>
                    <li>Click <span style={{color:"#94a3b8",fontWeight:600}}>Request Report</span> → wait a minute → <span style={{color:"#94a3b8",fontWeight:600}}>Download</span></li>
                    <li>Upload the CSV here using the button above</li>
                  </ol>
                </div>
              </div>
            )}

            {/* By Category sub-tab */}
            {amazonTab==="by category"&&(
              <div style={{display:"flex",flexDirection:"column",gap:7}}>
                {Object.values(amzSummary.byCategory).sort((a,b)=>b.total-a.total).map(cat=>{
                  const lc = getCat(cat.ledgerCat);
                  const pct = (cat.total/amzSummary.totalSpend)*100;
                  return (
                    <div key={cat.sub} style={{...S.card,padding:"14px 18px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:8}}>
                        <div style={{flex:1,fontWeight:700,fontSize:13}}>{cat.sub}</div>
                        <span style={{background:lc.color+"22",color:lc.color,borderRadius:4,padding:"2px 8px",fontSize:10,fontWeight:700}}>{cat.ledgerCat}</span>
                        <div style={{fontWeight:800,fontSize:16,color:amzColor}}>{fmt(cat.total)}</div>
                        <div style={{fontSize:11,color:"#475569"}}>{pct.toFixed(1)}% · {cat.count} items</div>
                      </div>
                      <div style={{height:4,background:"#1e293b",borderRadius:3}}>
                        <div style={{height:4,width:`${Math.min(100,pct)}%`,background:amzColor,borderRadius:3}}/>
                      </div>
                      <div style={{marginTop:9,display:"flex",flexWrap:"wrap",gap:5}}>
                        {cat.items.slice(0,6).map((item,i)=>(
                          <span key={i} style={{background:"#0a0f1a",border:"1px solid #1e293b",borderRadius:5,padding:"3px 8px",fontSize:10,color:"#64748b"}}>
                            {item.title.slice(0,50)}{item.title.length>50?"…":""} ({fmt(item.total)})
                          </span>
                        ))}
                        {cat.items.length>6&&<span style={{fontSize:10,color:"#334155",padding:"3px 8px"}}>+{cat.items.length-6} more</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* All Items sub-tab */}
            {amazonTab==="all items"&&(
              <div style={{...S.card,overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead>
                    <tr style={{borderBottom:"1px solid #1e293b"}}>
                      {["Date","Title","Amazon Category","Ledger Category","Qty","Total"].map(h=>(
                        <th key={h} style={{textAlign:"left",padding:"8px 10px",color:"#475569",fontWeight:700,fontSize:10,letterSpacing:1,textTransform:"uppercase"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {amzSummary.activeItems.sort((a,b)=>b.total-a.total).map((item,i)=>{
                      const lc = getCat(item.ledgerCat);
                      return (
                        <tr key={i} style={{borderBottom:"1px solid #0d1525"}}
                          onMouseEnter={e=>e.currentTarget.style.background="#0f1929"}
                          onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                          <td style={{padding:"8px 10px",color:"#64748b",whiteSpace:"nowrap",fontSize:11}}>{item.dateStr}</td>
                          <td style={{padding:"8px 10px",color:"#cbd5e1",maxWidth:300,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={item.title}>{item.title}</td>
                          <td style={{padding:"8px 10px",color:"#475569",fontSize:10}}>{item.category||"—"}</td>
                          <td style={{padding:"8px 10px"}}>
                            <span style={{background:lc.color+"22",color:lc.color,borderRadius:4,padding:"2px 6px",fontSize:10,fontWeight:700}}>{item.sub}</span>
                          </td>
                          <td style={{padding:"8px 10px",color:"#64748b",textAlign:"center"}}>{item.qty}</td>
                          <td style={{padding:"8px 10px",fontWeight:700,color:amzColor,textAlign:"right",whiteSpace:"nowrap"}}>{fmt(item.total)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Returns sub-tab */}
            {amazonTab==="returns"&&(
              <div>
                {amzSummary.totalRefunds > 0 ? (
                  <>
                    <div style={{background:"#0a1f0a",border:"1px solid #166534",borderRadius:10,padding:"14px 18px",marginBottom:14,display:"flex",gap:14,alignItems:"center"}}>
                      <span style={{fontSize:24}}>✅</span>
                      <div>
                        <div style={{fontWeight:700,color:"#22c55e",fontSize:13}}>{fmt(amzSummary.totalRefunds)} refunded across {amzSummary.returnItems.length} items</div>
                        <div style={{fontSize:11,color:"#4ade80",marginTop:2}}>{((amzSummary.totalRefunds/amzSummary.totalSpend)*100).toFixed(1)}% of spend refunded</div>
                      </div>
                    </div>
                    {amzSummary.returnItems.map((item,i)=>(
                      <div key={i} style={{...S.card,padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                        <div style={{flex:1,overflow:"hidden"}}>
                          <div style={{fontSize:12,color:"#cbd5e1",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.title}</div>
                          <div style={{fontSize:10,color:"#475569",marginTop:2}}>{item.dateStr} · Order {item.orderId}</div>
                        </div>
                        <div style={{fontWeight:700,color:"#22c55e",fontSize:13,whiteSpace:"nowrap",marginLeft:12}}>{fmt(item.refunded)} refunded</div>
                      </div>
                    ))}
                  </>
                ) : (
                  <div style={{...S.card,textAlign:"center",padding:32,color:"#475569"}}>No refunds found in this order export.</div>
                )}
              </div>
            )}

            {/* Reconcile sub-tab */}
            {amazonTab==="reconcile"&&(()=>{
              const amazonBankTxns = activeTxns.filter(t =>
                t.description.toLowerCase().includes("amazon") ||
                t.description.toLowerCase().includes("amzn")
              ).sort((a,b) => b.date - a.date);
              const bankAmazonTotal = amazonBankTxns.reduce((s,t)=>s+Math.abs(t.amount),0);
              return (
                <div>
                  <div style={{...S.card,marginBottom:14,background:"#0a1a2e",borderColor:"#1e4080"}}>
                    <div style={{fontWeight:700,color:"#60a5fa",fontSize:13,marginBottom:6}}>How Reconciliation Works</div>
                    <div style={{fontSize:12,color:"#475569",lineHeight:1.7}}>
                      Amazon charges appear in your bank statements as "AMAZON MKTPL*XXXXXXX" — one charge per item or shipment. 
                      Your order report shows what you actually bought. Use this tab to spot-check miscategorized Amazon charges and reclassify them.
                    </div>
                  </div>
                  <div style={{...S.row,marginBottom:14}}>
                    <div style={S.statCard}>
                      <div style={S.label}>Bank: Amazon Charges</div>
                      <div style={{fontFamily:"'DM Serif Display',serif",fontSize:26,color:amzColor}}>{fmt(bankAmazonTotal)}</div>
                      <div style={{fontSize:11,color:"#475569",marginTop:4}}>{amazonBankTxns.length} transactions</div>
                    </div>
                    <div style={S.statCard}>
                      <div style={S.label}>Orders: Net Spend</div>
                      <div style={{fontFamily:"'DM Serif Display',serif",fontSize:26,color:amzColor}}>{fmt(amzSummary.netSpend)}</div>
                      <div style={{fontSize:11,color:"#475569",marginTop:4}}>{amzSummary.activeItems.length} items</div>
                    </div>
                    <div style={S.statCard}>
                      <div style={S.label}>Gap</div>
                      <div style={{fontFamily:"'DM Serif Display',serif",fontSize:26,color:Math.abs(bankAmazonTotal-amzSummary.netSpend)<100?"#2dd4a7":"#e8c547"}}>
                        {fmt(Math.abs(bankAmazonTotal-amzSummary.netSpend))}
                      </div>
                      <div style={{fontSize:11,color:"#475569",marginTop:4}}>
                        {Math.abs(bankAmazonTotal-amzSummary.netSpend)<100?"Close match ✓":"Check for missing months"}
                      </div>
                    </div>
                  </div>
                  <div style={S.card}>
                    <div style={{...S.h3,marginBottom:6}}>Bank Amazon Transactions — click to reclassify</div>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                      <thead>
                        <tr style={{borderBottom:"1px solid #1e293b"}}>
                          {["Date","Description","Category","Amount",""].map(h=>(
                            <th key={h} style={{textAlign:"left",padding:"7px 10px",color:"#475569",fontWeight:700,fontSize:10,letterSpacing:1,textTransform:"uppercase"}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {amazonBankTxns.map(t=>{
                          const cat=getCat(t.category);
                          return (
                            <tr key={t.id} style={{borderBottom:"1px solid #0d1525",cursor:"pointer"}}
                              onMouseEnter={e=>e.currentTarget.style.background="#0f1929"}
                              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                              <td style={{padding:"8px 10px",color:"#64748b",whiteSpace:"nowrap"}}>{t.date.toLocaleDateString()}</td>
                              <td style={{padding:"8px 10px",color:"#cbd5e1",maxWidth:280,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.description}</td>
                              <td style={{padding:"8px 10px"}}>
                                <span style={{background:cat.color+"22",color:cat.color,border:`1px solid ${cat.color}44`,borderRadius:4,padding:"2px 7px",fontSize:10,fontWeight:700}}>{cat.name}</span>
                              </td>
                              <td style={{padding:"8px 10px",fontWeight:700,color:amzColor,textAlign:"right"}}>{fmt(t.amount)}</td>
                              <td style={{padding:"8px 10px",textAlign:"right"}}>
                                <button onClick={()=>setEditingTxn(t)} style={{background:"none",border:"1px solid #334155",borderRadius:5,color:"#64748b",padding:"3px 9px",fontSize:10,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:700}}>
                                  Reclassify →
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })()}

      {/* ── MODALS ── */}
      {showCatManager&&<CategoryManager categories={categories} onSave={saveNewCategories} onClose={()=>setShowCatManager(false)}/>}
      {editingTxn&&<TxnEditModal txn={editingTxn} categories={categories} allTransactions={transactions} onSave={(changes)=>saveTxnEdit(editingTxn.id,changes)} onClose={()=>setEditingTxn(null)}/>}

      {toast&&<Toast {...toast}/>}
    </div>
  );
}
