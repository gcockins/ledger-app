// storage.js — persists all financial data locally in the browser

const KEYS = {
  TRANSACTIONS:   "ledger_transactions",
  BUDGET:         "ledger_budget",
  PROFILE:        "ledger_profile",
  ACCOUNTS:       "ledger_accounts",
  CATEGORIES:     "ledger_categories",
  MERCHANT_RULES: "ledger_merchant_rules",
};

// Map old timestamp-based category IDs → new clean permanent IDs
const CATEGORY_ID_MIGRATION = {
  "Coffee-/-Tea-1771459649923": "Coffee / Tea",
  "Landscape-1771459661164":    "Landscape",
  "Utilities-1771459840619":    "Utilities",
  "Vacation-1771462459054":     "Vacation",
};

const INCOME_CATEGORY_IDS = new Set([
  "W2 Payroll", "Side Income", "Transfer Received", "Interest/Dividends", "Income"
]);

export function saveTransactions(transactions) {
  try {
    const s = transactions.map(t => ({ ...t, date: t.date instanceof Date ? t.date.toISOString() : t.date }));
    localStorage.setItem(KEYS.TRANSACTIONS, JSON.stringify(s));
    return true;
  } catch (e) { return false; }
}
export function loadTransactions() {
  try {
    const r = localStorage.getItem(KEYS.TRANSACTIONS);
    if (!r) return [];
    return JSON.parse(r).map(t => ({
      ...t,
      date: new Date(t.date),
      // Migrate old timestamp-based category IDs to permanent clean IDs
      category: CATEGORY_ID_MIGRATION[t.category] || t.category,
      // Force-correct isIncome flag
      isIncome: INCOME_CATEGORY_IDS.has(CATEGORY_ID_MIGRATION[t.category] || t.category) ? true : (t.isIncome || false),
    }));
  } catch (e) { return []; }
}

export function saveBudget(b) {
  try { localStorage.setItem(KEYS.BUDGET, JSON.stringify(b)); return true; } catch (e) { return false; }
}
export function loadBudget() {
  try { const r = localStorage.getItem(KEYS.BUDGET); return r ? JSON.parse(r) : null; } catch (e) { return null; }
}

export function saveProfile(p) {
  try { localStorage.setItem(KEYS.PROFILE, JSON.stringify(p)); return true; } catch (e) { return false; }
}
export function loadProfile() {
  try { const r = localStorage.getItem(KEYS.PROFILE); return r ? JSON.parse(r) : { familySize: 2, zipCode: "" }; } catch (e) { return { familySize: 2, zipCode: "" }; }
}

export function saveAccounts(a) {
  try { localStorage.setItem(KEYS.ACCOUNTS, JSON.stringify(a)); } catch (e) {}
}
export function loadAccounts() {
  try { const r = localStorage.getItem(KEYS.ACCOUNTS); return r ? JSON.parse(r) : []; } catch (e) { return []; }
}

export const DEFAULT_CATEGORIES = [
  // ── Income (isIncome: true — excluded from budget, shown in income tab) ──
  { id: "W2 Payroll",          name: "W2 Payroll",          color: "#2dd4a7", excludeFromBudget: true,  isIncome: true,  builtIn: true },
  { id: "Side Income",         name: "Side Income",          color: "#10b981", excludeFromBudget: true,  isIncome: true,  builtIn: true },
  { id: "Transfer Received",   name: "Transfer Received",    color: "#6ee7b7", excludeFromBudget: true,  isIncome: true,  builtIn: true },
  { id: "Interest/Dividends",  name: "Interest/Dividends",   color: "#a7f3d0", excludeFromBudget: true,  isIncome: true,  builtIn: true },
  // "Income" kept as legacy alias so old saved transactions still resolve correctly
  { id: "Income",              name: "Income",               color: "#2dd4a7", excludeFromBudget: true,  isIncome: true,  builtIn: true },
  // ── Expenses ──────────────────────────────────────────────────────────────
  { id: "Housing",             name: "Housing",              color: "#e8c547", excludeFromBudget: false, isIncome: false, builtIn: true },
  { id: "Food",                name: "Food",                 color: "#f4845f", excludeFromBudget: false, isIncome: false, builtIn: true },
  { id: "Transport",           name: "Transport",            color: "#5f9cf4", excludeFromBudget: false, isIncome: false, builtIn: true },
  { id: "Healthcare",          name: "Healthcare",           color: "#7ed9a8", excludeFromBudget: false, isIncome: false, builtIn: true },
  { id: "Shopping",            name: "Shopping",             color: "#c47ef4", excludeFromBudget: false, isIncome: false, builtIn: true },
  { id: "Entertainment",       name: "Entertainment",        color: "#f47eb4", excludeFromBudget: false, isIncome: false, builtIn: true },
  { id: "Phone/Internet",      name: "Phone/Internet",       color: "#60a5fa", excludeFromBudget: false, isIncome: false, builtIn: true },
  { id: "Insurance",           name: "Insurance",            color: "#fb923c", excludeFromBudget: false, isIncome: false, builtIn: true },
  { id: "Education",           name: "Education",            color: "#a78bfa", excludeFromBudget: false, isIncome: false, builtIn: true },
  { id: "Giving",              name: "Giving",               color: "#f472b6", excludeFromBudget: false, isIncome: false, builtIn: true },
  // ── Custom categories (hard-coded from user's actual spending) ───────────────
  { id: "Coffee / Tea",    name: "Coffee / Tea",  color: "#a78bfa", excludeFromBudget: false, isIncome: false, builtIn: true },
  { id: "Landscape",       name: "Landscape",     color: "#10b981", excludeFromBudget: false, isIncome: false, builtIn: true },
  { id: "Utilities",       name: "Utilities",     color: "#e8c547", excludeFromBudget: false, isIncome: false, builtIn: true },
  { id: "Vacation",        name: "Vacation",      color: "#f59e0b", excludeFromBudget: false, isIncome: false, builtIn: true },
  // ── Pass-through (excluded from budget totals) ────────────────────────────
  { id: "Investments",         name: "Investments",          color: "#34d399", excludeFromBudget: true,  isIncome: false, builtIn: true },
  { id: "Savings Transfer",    name: "Savings Transfer",     color: "#4ecdc4", excludeFromBudget: true,  isIncome: false, builtIn: true },
  { id: "CC Payment",          name: "CC Payment",           color: "#64748b", excludeFromBudget: true,  isIncome: false, builtIn: true },
  { id: "Other",               name: "Other",                color: "#94a3b8", excludeFromBudget: false, isIncome: false, builtIn: true },
];

// Legacy ID aliases — old transactions saved with timestamp-based IDs
// still need to resolve to the correct category name and flags.
// These are NOT shown in the UI (hidden via legacy:true) but getCat() finds them.
export const LEGACY_CATEGORY_ALIASES = [
  { id: "Coffee-/-Tea-1771459649923", name: "Coffee / Tea",  color: "#a78bfa", excludeFromBudget: false, isIncome: false, builtIn: false, legacy: true },
  { id: "Landscape-1771459661164",    name: "Landscape",     color: "#10b981", excludeFromBudget: false, isIncome: false, builtIn: false, legacy: true },
  { id: "Utilities-1771459840619",    name: "Utilities",     color: "#e8c547", excludeFromBudget: false, isIncome: false, builtIn: false, legacy: true },
  { id: "Vacation-1771462459054",     name: "Vacation",      color: "#f59e0b", excludeFromBudget: false, isIncome: false, builtIn: false, legacy: true },
];
// This corrects stale data from older app versions that saved wrong flags.
const FORCED_INCOME_IDS = new Set([
  "W2 Payroll", "Side Income", "Transfer Received", "Interest/Dividends", "Income"
]);
const FORCED_EXCLUDED_IDS = new Set([
  "W2 Payroll", "Side Income", "Transfer Received", "Interest/Dividends", "Income",
  "Investments", "Savings Transfer", "CC Payment"
]);

export function saveCategories(cats) {
  try { localStorage.setItem(KEYS.CATEGORIES, JSON.stringify(cats)); return true; } catch (e) { return false; }
}
export function loadCategories() {
  try {
    const r = localStorage.getItem(KEYS.CATEGORIES);
    const base = r ? JSON.parse(r) : [];
    const savedIds = new Set(base.map(c => c.id));
    // Add any missing built-ins (including the new hard-coded custom categories)
    const missing = [...DEFAULT_CATEGORIES, ...LEGACY_CATEGORY_ALIASES].filter(c => !savedIds.has(c.id));
    const merged = [...base, ...missing];
    // Force-correct isIncome and excludeFromBudget on known income/excluded IDs
    return merged.map(c => ({
      ...c,
      isIncome: FORCED_INCOME_IDS.has(c.id) ? true : c.isIncome,
      excludeFromBudget: FORCED_EXCLUDED_IDS.has(c.id) ? true : c.excludeFromBudget,
    }));
  } catch (e) { return DEFAULT_CATEGORIES; }
}

// ── Merchant Rules ────────────────────────────────────────────────────────────
// Maps a merchant key (lowercased first ~3 words of description) → category id
export function saveMerchantRules(rules) {
  try { localStorage.setItem(KEYS.MERCHANT_RULES, JSON.stringify(rules)); return true; } catch(e) { return false; }
}
export function loadMerchantRules() {
  try { const r = localStorage.getItem(KEYS.MERCHANT_RULES); return r ? JSON.parse(r) : {}; } catch(e) { return {}; }
}

export function clearAllData() {
  Object.values(KEYS).forEach(k => localStorage.removeItem(k));
  localStorage.removeItem("ledger_walmart");
}

export function exportDataBackup(transactions, budget, profile, categories, merchantRules) {
  const data = {
    exportDate: new Date().toISOString(), version: "2.1",
    profile, budget, categories, merchantRules,
    transactions: transactions.map(t => ({ ...t, date: t.date instanceof Date ? t.date.toISOString() : t.date })),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ledger-backup-${new Date().toISOString().split("T")[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importDataBackup(file, onSuccess, onError) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      const transactions = (data.transactions || []).map(t => ({ ...t, date: new Date(t.date) }));
      onSuccess({ transactions, budget: data.budget, profile: data.profile, categories: data.categories, merchantRules: data.merchantRules || {} });
    } catch (err) { onError("Invalid backup file"); }
  };
  reader.readAsText(file);
}
