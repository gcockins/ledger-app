/**
 * amazonParser.js
 * Parses an Amazon Order History CSV report and maps each item
 * to a Ledger budget category + subcategory.
 *
 * How to export from Amazon:
 *   amazon.com → Account & Lists → Order History Reports
 *   Select "Items" report type, choose date range → Request Report → Download CSV
 *
 * Supported CSV formats:
 *   New:  "Order Date","Order ID","Title","Category","ASIN/ISBN","Quantity","Purchase Price Per Unit","Shipping Charge","Subtotal","Shipping Charge Refund","Subtotal Refund","Total Charged","Total Refunded"
 *   Old:  "Order ID","Order Date","Title","Category","Seller","Quantity","Purchase Price Per Unit","Shipping Charge","Total Charged","Tracking Number"
 */

// ─── AMAZON CATEGORY → LEDGER MAPPING ────────────────────────────────────────
// Amazon uses ALL_CAPS_UNDERSCORE category strings in their exports.
// Map those first (fast, reliable), then fall back to keyword matching on title.

const AMAZON_CAT_MAP = {
  // Books & Media
  "ABIS_BOOK":        { ledgerCat: "Entertainment", sub: "Books" },
  "ABIS_MUSIC":       { ledgerCat: "Entertainment", sub: "Music" },
  "ABIS_VIDEO":       { ledgerCat: "Entertainment", sub: "Video/Movies" },
  "ABIS_VIDEO_GAMES": { ledgerCat: "Entertainment", sub: "Video Games" },
  "VIDEO_GAMES":      { ledgerCat: "Entertainment", sub: "Video Games" },
  "SOFTWARE":         { ledgerCat: "Entertainment", sub: "Software" },
  "Audible":          { ledgerCat: "Entertainment", sub: "Audiobooks" },

  // Electronics & Computers
  "ELECTRONICS":      { ledgerCat: "Shopping",      sub: "Electronics" },
  "COMPUTERS":        { ledgerCat: "Shopping",      sub: "Electronics" },

  // Clothing & Accessories
  "CLOTHING":         { ledgerCat: "Shopping",      sub: "Clothing" },
  "SHOES":            { ledgerCat: "Shopping",      sub: "Clothing" },
  "LUGGAGE":          { ledgerCat: "Shopping",      sub: "Clothing" },
  "WATCHES":          { ledgerCat: "Shopping",      sub: "Clothing" },

  // Home
  "HOME":             { ledgerCat: "Shopping",      sub: "Home & Decor" },
  "HOME_IMPROVEMENT": { ledgerCat: "Housing",       sub: "Home Improvement" },
  "KITCHEN":          { ledgerCat: "Shopping",      sub: "Kitchen" },
  "TOOLS":            { ledgerCat: "Housing",       sub: "Home Improvement" },

  // Health & Beauty
  "BEAUTY":           { ledgerCat: "Healthcare",    sub: "Health & Beauty" },
  "HEALTH_PERSONAL_CARE": { ledgerCat: "Healthcare", sub: "Health & Beauty" },

  // Food
  "GROCERY":          { ledgerCat: "Food",          sub: "Grocery" },

  // Kids
  "BABY":             { ledgerCat: "Shopping",      sub: "Kids & Baby" },
  "TOYS_AND_GAMES":   { ledgerCat: "Shopping",      sub: "Toys & Games" },

  // Other
  "AUTOMOTIVE":       { ledgerCat: "Transport",     sub: "Auto Parts" },
  "SPORTS":           { ledgerCat: "Healthcare",    sub: "Sports & Fitness" },
  "OFFICE_PRODUCTS":  { ledgerCat: "Education",     sub: "Office Supplies" },
  "PET_SUPPLIES":     { ledgerCat: "Shopping",      sub: "Pet Supplies" },
};

// ─── TITLE KEYWORD RULES (fallback when category is missing/generic) ──────────
const TITLE_RULES = [
  { ledgerCat: "Entertainment", sub: "Books",          kw: ["book","novel","guide","handbook","textbook","workbook","journal ","diary","coloring book","activity book","puzzle book"] },
  { ledgerCat: "Entertainment", sub: "Video Games",    kw: ["video game","nintendo","playstation","xbox","gaming","steam"] },
  { ledgerCat: "Entertainment", sub: "Streaming/Sub",  kw: ["subscription","prime","audible","kindle","echo","alexa","fire tv","fire tablet"] },
  { ledgerCat: "Shopping",      sub: "Electronics",    kw: ["cable","charger","usb","hdmi","battery","batteries","bluetooth","speaker","headphone","earphone","earbud","keyboard","mouse","monitor","laptop","tablet","phone case","smart plug","power bank","ring light","webcam","printer","ink cartridge","router","wifi","surge protector","extension cord","remote","led strip","security camera"] },
  { ledgerCat: "Food",          sub: "Grocery",        kw: ["food","snack","coffee","tea","supplement","protein","vitamin","grocery","candy","chocolate","chips","crackers","drink","juice","water bottle","protein bar","energy bar","gummy","multivitamin"] },
  { ledgerCat: "Healthcare",    sub: "Health & Beauty",kw: ["shampoo","conditioner","lotion","moisturizer","sunscreen","vitamin","supplement","bandage","first aid","razor","skincare","toothpaste","toothbrush","deodorant","face wash","serum","hair care","nail","mascara","eyeliner","foundation","perfume","cologne","eye drop","ibuprofen","tylenol","advil"] },
  { ledgerCat: "Shopping",      sub: "Clothing",       kw: ["shirt","pants","dress","shorts","jacket","hoodie","shoes","sneakers","boots","sandals","socks","underwear","bra","leggings","jeans","coat","sweater","hat ","beanie","gloves","scarf"] },
  { ledgerCat: "Shopping",      sub: "Kids & Baby",    kw: ["baby","infant","toddler","kids ","children","diaper","wipe","formula","stroller","car seat","baby monitor"] },
  { ledgerCat: "Shopping",      sub: "Toys & Games",   kw: ["lego","toy ","toys ","action figure","doll","board game","card game","puzzle","playset","stuffed","plush"] },
  { ledgerCat: "Shopping",      sub: "Kitchen",        kw: ["cookware","pan","pot ","knife","cutting board","spatula","whisk","bowl","plate","cup ","mug","storage container","food container","coffee maker","air fryer","instant pot","blender","toaster","kitchen"] },
  { ledgerCat: "Shopping",      sub: "Home & Decor",   kw: ["pillow","blanket","throw","curtain","rug","lamp","candle","picture frame","wall art","mirror","shower curtain","bath mat","towel","bedding","sheet set","duvet","comforter","mattress","furniture","shelf","organizer","storage bin","drawer"] },
  { ledgerCat: "Housing",       sub: "Home Improvement",kw: ["drill","hammer","screwdriver","tool set","paint","caulk","tape measure","level ","power tool","ladder","plumbing","electrical","light bulb","outlet","switch","insulation","weather strip"] },
  { ledgerCat: "Shopping",      sub: "Pet Supplies",   kw: ["dog food","cat food","pet food","dog treat","cat treat","dog toy","cat toy","leash","collar","cat litter","pet bed","aquarium","bird food","fish food"] },
  { ledgerCat: "Education",     sub: "Office Supplies",kw: ["pen ","pencil","marker","notebook","folder","binder","stapler","tape ","scissors","printer paper","sticky note","planner","calendar","whiteboard","desk"] },
  { ledgerCat: "Transport",     sub: "Auto Parts",     kw: ["car ","auto ","tire","motor oil","wiper","windshield","floor mat","car seat","car charger","dash cam","jumper cable"] },
  { ledgerCat: "Shopping",      sub: "Sports & Fitness",kw: ["yoga","dumbbell","resistance band","workout","exercise","gym","running","bicycle","camping","hiking","fishing","hunting","golf","tennis","basketball","football","soccer"] },
];

function parseMoney(s) {
  if (!s) return 0;
  const clean = String(s).replace(/[$,\s"]/g, "");
  return parseFloat(clean) || 0;
}

function categorizeItem(title, amazonCategory) {
  // 1. Try the Amazon category map first
  if (amazonCategory && AMAZON_CAT_MAP[amazonCategory.trim()]) {
    return AMAZON_CAT_MAP[amazonCategory.trim()];
  }
  // 2. Fall back to title keyword matching
  const t = (title || "").toLowerCase();
  for (const rule of TITLE_RULES) {
    if (rule.kw.some(kw => t.includes(kw))) {
      return { ledgerCat: rule.ledgerCat, sub: rule.sub };
    }
  }
  return { ledgerCat: "Shopping", sub: "Other Amazon" };
}

// ─── MAIN PARSE ──────────────────────────────────────────────────────────────
export function parseAmazonCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = splitCSVLine(lines[0]).map(h => h.replace(/"/g,"").toLowerCase().trim());

  // Flexible column finding — handles both old and new Amazon export formats
  const titleIdx   = headers.findIndex(h => h === "title" || h.includes("product name") || h.includes("item name"));
  const categoryIdx= headers.findIndex(h => h === "category" || h.includes("category"));
  const qtyIdx     = headers.findIndex(h => h === "quantity" || h.includes("qty"));
  const priceIdx   = headers.findIndex(h => h === "purchase price per unit" || h.includes("unit price") || h.includes("price per unit"));
  const totalIdx   = headers.findIndex(h => h === "total charged" || h === "subtotal" || h.includes("total charged"));
  const refundIdx  = headers.findIndex(h => h.includes("total refunded") || h.includes("refund"));
  const dateIdx    = headers.findIndex(h => h === "order date" || h.includes("order date"));
  const orderIdIdx = headers.findIndex(h => h === "order id" || h.includes("order id"));

  if (titleIdx < 0) return [];

  const items = [];
  const seen = new Set();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = splitCSVLine(line);
    if (cols.length < 2) continue;

    const title     = (cols[titleIdx] || "").trim();
    const category  = categoryIdx >= 0 ? (cols[categoryIdx] || "").trim() : "";
    const qty       = qtyIdx >= 0 ? (parseInt(cols[qtyIdx]) || 1) : 1;
    const unitPrice = priceIdx >= 0 ? parseMoney(cols[priceIdx]) : 0;
    const totalRaw  = totalIdx >= 0 ? parseMoney(cols[totalIdx]) : unitPrice * qty;
    const refunded  = refundIdx >= 0 ? parseMoney(cols[refundIdx]) : 0;
    const dateStr   = dateIdx >= 0 ? (cols[dateIdx] || "").trim() : "";
    const orderId   = orderIdIdx >= 0 ? (cols[orderIdIdx] || "").trim() : "";

    if (!title || title.toLowerCase() === "title") continue; // skip header rows if repeated

    const total = totalRaw > 0 ? totalRaw : unitPrice * qty;
    if (total <= 0 && unitPrice <= 0) continue;

    // Deduplicate by title+price+orderId
    const key = `${orderId}|${title.slice(0,50)}|${total.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const isReturn = refunded > 0;
    const netTotal = total - refunded;
    const { ledgerCat, sub } = categorizeItem(title, category);

    items.push({
      title,
      category,
      qty,
      unitPrice,
      total,
      refunded,
      netTotal,
      dateStr,
      orderId,
      ledgerCat,
      sub,
      isReturn,
      isActive: netTotal > 0 || total > 0,
    });
  }

  return items;
}

export function summarizeAmazonItems(items) {
  const active  = items.filter(i => !i.isReturn || i.netTotal > 0);
  const returns = items.filter(i => i.isReturn);

  const byCategory = {};
  for (const item of active) {
    const key = item.sub;
    if (!byCategory[key]) {
      byCategory[key] = { ledgerCat: item.ledgerCat, sub: item.sub, total: 0, count: 0, items: [] };
    }
    byCategory[key].total += item.netTotal > 0 ? item.netTotal : item.total;
    byCategory[key].count += item.qty;
    byCategory[key].items.push(item);
  }

  const totalSpend   = active.reduce((s, i) => s + i.total, 0);
  const totalRefunds = items.reduce((s, i) => s + i.refunded, 0);
  const netSpend     = totalSpend - totalRefunds;

  return { byCategory, totalSpend, totalRefunds, netSpend, activeItems: active, returnItems: returns };
}

// ─── CSV splitter ─────────────────────────────────────────────────────────────
function splitCSVLine(line) {
  const result = [];
  let current = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else current += ch;
  }
  result.push(current.trim());
  return result;
}
