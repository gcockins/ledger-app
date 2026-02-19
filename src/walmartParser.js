/**
 * walmartParser.js
 * Parses a Walmart order history CSV and maps each item
 * to a Ledger budget category + subcategory.
 *
 * CSV format: Product Name, Quantity, Price, Delivery Status, Product Link
 */

// ─── CATEGORY RULES ──────────────────────────────────────────────────────────
// Each rule: { ledgerCat, sub, keywords }
// First match wins, so order matters — specific before general
const RULES = [
  // Transport / Fuel
  { ledgerCat: "Transport", sub: "Fuel",         kw: ["gasoline","unleaded","fuel pump"] },

  // Kitchen appliances (before food, since "ninja" etc could false-match)
  { ledgerCat: "Shopping",  sub: "Appliances",   kw: ["ninja","air fryer","instant pot","coffee maker","toaster","microwave","blender","mixer","slow cooker","rice cooker","waffle maker","juicer","stand mixer","keurig","nespresso","air purifier","humidifier","dehumidifier","space heater","fan "] },

  // Food & Grocery
  { ledgerCat: "Food",      sub: "Grocery",      kw: ["food","snack","chip","cracker","juice","water","coffee","tea","soda","candy","chocolate","granola","cereal","soup","sauce","condiment","spice","seasoning","pasta","rice","bread","butter","cheese","milk","egg","cookie","muffin","croissant","bagel","chicken breast","beef","pork fish","shrimp","meat","produce","vegetable","fruit","frozen meal","flour","sugar","salt","pepper","oil","vinegar","dressing","mayo","mustard","ketchup","honey","jam","jelly","peanut butter","pretzel","popcorn","tortilla","salsa","hummus","yogurt","cream","protein bar","energy bar","gatorade","vitamin water","kombucha","olipop","broth","stock","canned","bean","oat","banana","blueberr","avocado","orange","lime","onion","mushroom","broccoli","salad kit","marketside","prima della","marshmallow","aquaphor lip","fresh hass","fresh navel","fresh whole","fresh organic","fresh banana","fresh yellow","applegate","chicken tenders"] },

  // Health & Medical
  { ledgerCat: "Healthcare", sub: "Health & Beauty", kw: ["vitamin","supplement","medicine","pain relief","tylenol","advil","ibuprofen","allergy","cold","flu","bandage","first aid","shampoo","conditioner","body wash","lotion","moisturizer","sunscreen","deodorant","toothbrush","toothpaste","floss","mouthwash","razor","shave","makeup","mascara","lipstick","foundation","skincare","face wash","toner","serum","nail polish","perfume","cologne","feminine","tampon","pad","pregnancy","eye drop","systane","dry eye","tiger balm","pain relieving patch","lip repair","lip balm","lip stick","wound","ointment","antiseptic"] },

  // Condoms / family planning — health
  { ledgerCat: "Healthcare", sub: "Health & Beauty", kw: ["condom","trojan","durex","lubricated"] },

  // Kids clothing — separate from general clothing
  { ledgerCat: "Shopping",  sub: "Kids Clothing", kw: ["girls ","boys ","justice ","leotard","ballet","winnie the pooh girls","winnie the pooh boys","kids shirt","children's shirt","toddler shirt","youth shirt","kids pants","girls pants","boys pants","girls dress","little girls","little boys"] },

  // Kids & Baby gear (non-clothing)
  { ledgerCat: "Shopping",  sub: "Kids & Baby",  kw: ["baby doll","rocking crib","baby toy","toddler toy","infant toy","nursery","diaper","baby wipe","formula","sippy","pacifier","stroller","baby monitor","baby gate","playpen","bassinet","highchair","bouncer","swing","baby carrier"] },

  // Toys & Games
  { ledgerCat: "Shopping",  sub: "Toys & Games", kw: ["toy ","lego ","action figure","board game","card game","stuffed animal","plush","fidget","slime","craft kit","coloring book","disney stitch","bubble machine","musical toy","play set"] },

  // Party & Celebrations
  { ledgerCat: "Entertainment", sub: "Celebrations", kw: ["party","birthday","balloon","party banner","confetti","streamer","gift wrap","tissue paper","gift bag","party bow","party ribbon","party cup","party plate","tablecloth","pinata","halloween","christmas","holiday decor","seasonal decor","easter","valentine","capybara gift","snow roll decoration","gift card holder"] },

  // Pets
  { ledgerCat: "Shopping",  sub: "Pet Supplies", kw: ["dog food","cat food","pet food","dog treat","cat treat","puppy","kitten","bird food","fish food","hamster","pet bed","dog bed","cat bed","leash","collar","pet toy","cat litter","pet cage","pet bowl","pet grooming","flea","heartworm","aquarium"] },

  // Garden & Outdoors
  { ledgerCat: "Shopping",  sub: "Garden",       kw: ["garden","plant seed","soil","garden pot","planter","fertilizer","garden hose","garden tool","lawn","grass seed","outdoor furniture","patio","grill","bbq","camping","garden glove"] },

  // Office & School Supplies
  { ledgerCat: "Education", sub: "Supplies",     kw: ["pen ","pencil","marker","highlighter","notebook","loose leaf","paper ream","binder","folder","stapler","tape dispenser","scissors","glue stick","eraser","ruler","backpack","poster board","pen+gear","monofilament cord","jewelry making","stamp pad","ink pad","index card","flash card"] },

  // Electronics & Tech
  { ledgerCat: "Shopping",  sub: "Electronics",  kw: ["phone case","phone charger","charging cable","usb cable","hdmi","aa battery","aaa battery","d battery","bluetooth","headphone","earphone","earbud","speaker","webcam","keyboard","mouse pad","tablet case","remote control","smart plug","power bank","surge protector","extension cord","led strip","ring light"] },

  // Household cleaning & supplies
  { ledgerCat: "Housing",   sub: "Household",    kw: ["cleaning spray","all-purpose cleaner","disinfectant","bleach","toilet bowl","bathroom cleaner","glass cleaner","floor cleaner","mop","broom","dustpan","vacuum bag","trash bag","garbage bag","ziploc","storage bag","sandwich bag","plastic wrap","aluminum foil","paper towel","toilet paper","tissue box","facial tissue","napkin","sponge","scrub pad","laundry detergent","fabric softener","dryer sheet","dish soap","hand soap","hand sanitizer","air freshener","febreze","scented candle","storage container","food container","tupperware"] },

  // Furniture & Home Decor
  { ledgerCat: "Shopping",  sub: "Home Decor",   kw: ["throw blanket","fleece throw","pillow cover","decorative pillow","curtain","window curtain","rug","area rug","wall art","picture frame","mirror","lamp","night light","wax melt","scented wax","vase","plant pot","shelf","floating shelf","hooks","towel bar","shower curtain","bath mat","scallop flange","home decor collection","floral arrangement","artificial flower"] },

  // Clothing — general adult
  { ledgerCat: "Shopping",  sub: "Clothing",     kw: ["shirt","pants","shorts","dress","skirt","jacket","coat","hoodie","sweater","sock","underwear","bra ","shoe","sandal","boot","hat ","beanie","scarf","glove","belt","legging","jeans","denim","flannel shirt","half slip","reebok","women's shirt","men's shirt","apparel","george men","vanity fair","activewear","athletic wear","sports bra","compression","swimsuit","pajama","sleepwear","robe"] },

  // Generic Walmart grocery catchall (produce often just says "Fresh X")
  { ledgerCat: "Food",      sub: "Grocery",      kw: ["fresh ","organic ","cage-free","free-range","wild-caught","grass-fed"] },
];

function parseMoney(s) {
  if (!s) return 0;
  const clean = String(s).replace(/[$,\s"]/g, "");
  return parseFloat(clean) || 0;
}

function categorizeItem(name) {
  const n = name.toLowerCase();
  for (const rule of RULES) {
    if (rule.kw.some(kw => n.includes(kw))) {
      return { ledgerCat: rule.ledgerCat, sub: rule.sub };
    }
  }
  return { ledgerCat: "Other", sub: "Misc" };
}

// ─── ACTIVE STATUSES (not returned, not canceled, not blank) ─────────────────
const SKIP_STATUSES = new Set(["canceled", ""]);
function isActive(status) {
  const s = (status || "").trim().toLowerCase();
  return !SKIP_STATUSES.has(s) && !s.includes("return");
}

// ─── MAIN PARSE ──────────────────────────────────────────────────────────────
/**
 * parseWalmartCSV(text)
 * Returns array of { name, qty, price, total, status, ledgerCat, sub, color }
 */
export function parseWalmartCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  // Find headers
  const headerLine = lines[0];
  const headers = splitCSVLine(headerLine).map(h => h.toLowerCase().trim());

  const nameIdx   = headers.findIndex(h => h.includes("product name") || h.includes("name"));
  const qtyIdx    = headers.findIndex(h => h.includes("quantity") || h === "qty");
  const priceIdx  = headers.findIndex(h => h.includes("price"));
  const statusIdx = headers.findIndex(h => h.includes("status") || h.includes("delivery"));

  if (nameIdx < 0 || priceIdx < 0) return [];

  const items = [];
  const seen = new Set();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = splitCSVLine(line);
    if (cols.length < 3) continue;

    const name   = (cols[nameIdx] || "").trim();
    const qty    = qtyIdx >= 0 ? (parseInt(cols[qtyIdx]) || 1) : 1;
    const price  = parseMoney(cols[priceIdx]);
    const status = statusIdx >= 0 ? (cols[statusIdx] || "").trim() : "Shopped";

    if (!name || price <= 0) continue;

    // Deduplicate
    const key = `${name}|${price}|${status}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const total = qty * price;
    const { ledgerCat, sub } = categorizeItem(name);
    const isReturn = (status || "").toLowerCase().includes("return");

    items.push({ name, qty, price, total, status, ledgerCat, sub, isActive: isActive(status), isReturn });
  }

  return items;
}

/**
 * summarizeWalmartItems(items)
 * Returns { byCategory, totalSpend, totalReturns, netSpend }
 */
export function summarizeWalmartItems(items) {
  const active  = items.filter(i => i.isActive);
  const returns = items.filter(i => i.isReturn);

  const byCategory = {};
  for (const item of active) {
    const key = item.sub;
    if (!byCategory[key]) byCategory[key] = { ledgerCat: item.ledgerCat, sub: item.sub, total: 0, count: 0, items: [] };
    byCategory[key].total += item.total;
    byCategory[key].count += item.qty;
    byCategory[key].items.push(item);
  }

  return {
    byCategory,
    totalSpend:  active.reduce((s, i) => s + i.total, 0),
    totalReturns: returns.reduce((s, i) => s + i.total, 0),
    netSpend:    active.reduce((s, i) => s + i.total, 0) - returns.reduce((s, i) => s + i.total, 0),
    activeItems: active,
    returnItems: returns,
  };
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
