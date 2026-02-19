import { useState } from "react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const CATEGORIES = [
  { name: "Fuel/Gas",                  total: 1241.78, count: 26,  pct: 53.1, color: "#f97316", icon: "⛽" },
  { name: "Groceries & Fresh Produce", total: 713.15,  count: 158, pct: 30.5, color: "#22c55e", icon: "🛒" },
  { name: "Kids Clothing",             total: 76.95,   count: 7,   pct: 3.3,  color: "#f472b6", icon: "👗" },
  { name: "Health & Beauty",           total: 69.78,   count: 8,   pct: 3.0,  color: "#a78bfa", icon: "💊" },
  { name: "Clothing & Apparel",        total: 36.46,   count: 4,   pct: 1.6,  color: "#818cf8", icon: "👕" },
  { name: "Kids & Baby",               total: 33.88,   count: 3,   pct: 1.4,  color: "#fb7185", icon: "🧸" },
  { name: "Party & Celebrations",      total: 31.39,   count: 7,   pct: 1.3,  color: "#fbbf24", icon: "🎉" },
  { name: "Furniture & Home Decor",    total: 31.34,   count: 6,   pct: 1.3,  color: "#34d399", icon: "🏠" },
  { name: "Household & Cleaning",      total: 30.73,   count: 7,   pct: 1.3,  color: "#60a5fa", icon: "🧹" },
  { name: "Other / Misc",              total: 33.86,   count: 10,  pct: 1.4,  color: "#94a3b8", icon: "📦" },
  { name: "Kitchen & Appliances",      total: 13.73,   count: 4,   pct: 0.6,  color: "#f59e0b", icon: "🍳" },
  { name: "Pet Supplies",              total: 8.98,    count: 1,   pct: 0.4,  color: "#84cc16", icon: "🐾" },
  { name: "Office & School Supplies",  total: 8.92,    count: 3,   pct: 0.4,  color: "#38bdf8", icon: "✏️" },
  { name: "Toys & Games",              total: 7.27,    count: 2,   pct: 0.3,  color: "#e879f9", icon: "🎮" },
];

const TOP_ITEMS = [
  { name: "Reg Gasoline Unleaded (14 fill-ups)", total: 733.46, cat: "Fuel/Gas", color: "#f97316" },
  { name: "Reg Gasoline Unleaded (12 fill-ups)", total: 508.32, cat: "Fuel/Gas", color: "#f97316" },
  { name: "Ninja DoubleStack XL Air Fryer (6-in-1)", total: 179.00, cat: "Groceries & Fresh Produce", color: "#22c55e" },
  { name: "OLIPOP Prebiotic Soda (3-pack x multiple)", total: 17.73, cat: "Groceries & Fresh Produce", color: "#22c55e" },
  { name: "Trojan Ultra Thin (36 count)", total: 17.57, cat: "Health & Beauty", color: "#a78bfa" },
  { name: "Justice Capsleeve Ballet Leotard", total: 16.00, cat: "Kids Clothing", color: "#f472b6" },
  { name: "Reebok Women's Low Impact Bra", total: 16.00, cat: "Clothing & Apparel", color: "#818cf8" },
  { name: "Justice Cap Sleeve Ballet Leotard (x3)", total: 14.00, cat: "Kids Clothing", color: "#f472b6" },
  { name: "Systane Complete Dry Eye Drops", total: 14.14, cat: "Health & Beauty", color: "#a78bfa" },
];

const RETURNS = [
  { name: "Wicked Pink Fleece Throw Blanket", amount: 13.97 },
  { name: "George Men's Double Pocket Flannel Shirt (x2)", amount: 25.96 },
  { name: "Winnie the Pooh Girls Graphic Tee (x2)", amount: 15.96 },
  { name: "Pen+Gear White Poster Board", amount: 1.00 },
  { name: "Vanity Fair Women's Half Slip", amount: 9.85 },
];

const INSIGHTS = [
  { icon: "⛽", title: "Gas is 53% of your Walmart spend", body: "You filled up 26 times — $1,241 in 3 months. That's about $414/month just at Walmart's pump. Consider using GasBuddy to find cheaper nearby stations or checking if Walmart+ membership is saving you enough to justify it." },
  { icon: "🛒", title: "Groceries look very healthy", body: "$713 on groceries (30.5%) including lots of fresh produce — bananas, oranges, avocados, salad kits. Strong pattern. The $179 Ninja Air Fryer is categorized here — that's a one-time item so your real grocery average is closer to $178/month." },
  { icon: "👗", title: "Kids clothing is consistent", body: "Multiple Justice leotards and kids' apparel — looks like ballet/dance. Recurring need that's budgetable at ~$25/month." },
  { icon: "💰", title: "$53.76 recovered in returns", body: "5 returns processed cleanly. Return rate is healthy — about 2.3% of spend." },
];

const APP_MAPPING = {
  "Fuel/Gas": { ledgerCat: "Transport", sub: "Fuel" },
  "Groceries & Fresh Produce": { ledgerCat: "Food", sub: "Grocery" },
  "Kids Clothing": { ledgerCat: "Shopping", sub: "Kids Clothing" },
  "Health & Beauty": { ledgerCat: "Healthcare", sub: "Health & Beauty" },
  "Clothing & Apparel": { ledgerCat: "Shopping", sub: "Clothing" },
  "Kids & Baby": { ledgerCat: "Shopping", sub: "Kids & Baby" },
  "Party & Celebrations": { ledgerCat: "Entertainment", sub: "Celebrations" },
  "Furniture & Home Decor": { ledgerCat: "Shopping", sub: "Home Decor" },
  "Household & Cleaning": { ledgerCat: "Housing", sub: "Household" },
  "Kitchen & Appliances": { ledgerCat: "Shopping", sub: "Appliances" },
  "Pet Supplies": { ledgerCat: "Shopping", sub: "Pet" },
  "Office & School Supplies": { ledgerCat: "Education", sub: "Supplies" },
  "Toys & Games": { ledgerCat: "Shopping", sub: "Toys" },
  "Other / Misc": { ledgerCat: "Other", sub: "Misc" },
};

const fmt = n => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function WalmartBreakdown() {
  const [activeTab, setActiveTab] = useState("overview");
  const [hoveredCat, setHoveredCat] = useState(null);

  const totalSpend = 2338.22;
  const totalReturns = 53.76;
  const netSpend = totalSpend - totalReturns;

  const pieData = CATEGORIES.filter(c => c.total > 15);

  return (
    <div style={{ minHeight: "100vh", background: "#030712", color: "#f1f5f9", fontFamily: "'Outfit', sans-serif", padding: "0 0 60px" }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)", borderBottom: "1px solid #1e293b", padding: "32px 40px 24px" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 16, marginBottom: 6 }}>
          <span style={{ fontSize: 36 }}>🛍️</span>
          <div>
            <div style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 800, fontSize: 28, color: "#fff", letterSpacing: -0.5 }}>Walmart Order Analysis</div>
            <div style={{ color: "#6366f1", fontSize: 13, fontWeight: 500, marginTop: 2 }}>Last 3 Months · 209 unique items · 246 units purchased</div>
          </div>
        </div>

        {/* Stat strip */}
        <div style={{ display: "flex", gap: 24, marginTop: 24, flexWrap: "wrap" }}>
          {[
            { label: "Total Spend", value: fmt(totalSpend), sub: "before returns", color: "#f97316" },
            { label: "Total Returns", value: fmt(totalReturns), sub: "5 items recovered", color: "#22c55e" },
            { label: "Net Spend", value: fmt(netSpend), sub: "actual out of pocket", color: "#818cf8" },
            { label: "Avg / Month", value: fmt(netSpend / 3), sub: "3-month period", color: "#38bdf8" },
            { label: "Fill-Ups", value: "26×", sub: fmt(1241.78) + " on gas", color: "#f97316" },
          ].map(s => (
            <div key={s.label} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "14px 20px", minWidth: 130 }}>
              <div style={{ fontSize: 11, color: "#475569", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: s.color, fontFamily: "'Space Mono', monospace" }}>{s.value}</div>
              <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>{s.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 2, padding: "0 40px", borderBottom: "1px solid #1e293b", background: "#0a0f1e" }}>
        {["overview", "categories", "top items", "returns", "app mapping"].map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            style={{ padding: "14px 18px", border: "none", background: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, textTransform: "capitalize", fontFamily: "'Outfit', sans-serif", letterSpacing: 0.5,
              color: activeTab === tab ? "#818cf8" : "#475569",
              borderBottom: activeTab === tab ? "2px solid #818cf8" : "2px solid transparent",
              transition: "all 0.15s" }}>
            {tab}
          </button>
        ))}
      </div>

      <div style={{ padding: "28px 40px" }}>

        {/* OVERVIEW TAB */}
        {activeTab === "overview" && (
          <div>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 24 }}>
              {/* Pie */}
              <div style={{ flex: 1, minWidth: 300, background: "#0f172a", border: "1px solid #1e293b", borderRadius: 16, padding: 24 }}>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16, color: "#e2e8f0" }}>Spend Distribution</div>
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" outerRadius={90} innerRadius={45} dataKey="total"
                      label={({ name, pct }) => pct > 3 ? `${pct}%` : ""} labelLine={false} fontSize={11}>
                      {pieData.map((e, i) => <Cell key={i} fill={e.color} stroke="#0f172a" strokeWidth={2} />)}
                    </Pie>
                    <Tooltip formatter={v => fmt(v)} contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, color: "#e2e8f0", fontFamily: "'Outfit', sans-serif" }} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                  {CATEGORIES.slice(0, 6).map(c => (
                    <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#94a3b8" }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: c.color }} />
                      {c.name.split(" ")[0]}
                    </div>
                  ))}
                </div>
              </div>

              {/* Insights */}
              <div style={{ flex: 1.4, minWidth: 320, display: "flex", flexDirection: "column", gap: 12 }}>
                {INSIGHTS.map((ins, i) => (
                  <div key={i} style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: "16px 20px", display: "flex", gap: 14 }}>
                    <div style={{ fontSize: 24, flexShrink: 0, marginTop: 2 }}>{ins.icon}</div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: "#f1f5f9", marginBottom: 4 }}>{ins.title}</div>
                      <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6 }}>{ins.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Bar chart */}
            <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 16, padding: 24 }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 20, color: "#e2e8f0" }}>Spend by Category</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={CATEGORIES.filter(c => c.total > 5)} layout="vertical" margin={{ left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "#475569", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} width={180} />
                  <Tooltip formatter={v => fmt(v)} contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, color: "#e2e8f0" }} />
                  <Bar dataKey="total" radius={[0, 6, 6, 0]}>
                    {CATEGORIES.filter(c => c.total > 5).map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* CATEGORIES TAB */}
        {activeTab === "categories" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {CATEGORIES.sort((a, b) => b.total - a.total).map(cat => (
              <div key={cat.name}
                onMouseEnter={() => setHoveredCat(cat.name)}
                onMouseLeave={() => setHoveredCat(null)}
                style={{ background: hoveredCat === cat.name ? "#0f172a" : "#080d1a", border: `1px solid ${hoveredCat === cat.name ? cat.color + "44" : "#1e293b"}`, borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", gap: 16, transition: "all 0.15s", cursor: "default" }}>
                <div style={{ fontSize: 24, width: 36, textAlign: "center" }}>{cat.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#f1f5f9", marginBottom: 4 }}>{cat.name}</div>
                  <div style={{ height: 6, background: "#1e293b", borderRadius: 3, width: "100%" }}>
                    <div style={{ height: 6, width: `${cat.pct}%`, background: cat.color, borderRadius: 3, transition: "width 0.6s ease" }} />
                  </div>
                </div>
                <div style={{ textAlign: "right", minWidth: 100 }}>
                  <div style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: 16, color: cat.color }}>{fmt(cat.total)}</div>
                  <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>{cat.pct}% · {cat.count} items</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TOP ITEMS TAB */}
        {activeTab === "top items" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 12, color: "#475569", marginBottom: 8 }}>Sorted by total amount spent</div>
            {TOP_ITEMS.map((item, i) => (
              <div key={i} style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: "14px 20px", display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 13, color: "#334155", width: 24, textAlign: "right" }}>#{i + 1}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", marginBottom: 4 }}>{item.name}</div>
                  <span style={{ background: item.color + "22", color: item.color, borderRadius: 4, padding: "2px 8px", fontSize: 10, fontWeight: 700 }}>{item.cat}</span>
                </div>
                <div style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: 18, color: item.color }}>{fmt(item.total)}</div>
              </div>
            ))}
          </div>
        )}

        {/* RETURNS TAB */}
        {activeTab === "returns" && (
          <div>
            <div style={{ background: "#0a1f0a", border: "1px solid #166534", borderRadius: 12, padding: "16px 20px", marginBottom: 20, display: "flex", gap: 16, alignItems: "center" }}>
              <div style={{ fontSize: 28 }}>✅</div>
              <div>
                <div style={{ fontWeight: 700, color: "#22c55e", fontSize: 14 }}>$53.76 recovered in returns</div>
                <div style={{ color: "#4ade80", fontSize: 12, marginTop: 2 }}>5 items · 2.3% return rate · all returns processed successfully</div>
              </div>
            </div>
            {RETURNS.map((r, i) => (
              <div key={i} style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 13, color: "#94a3b8" }}>{r.name}</div>
                <div style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, color: "#22c55e", fontSize: 14 }}>{fmt(r.amount)}</div>
              </div>
            ))}
          </div>
        )}

        {/* APP MAPPING TAB */}
        {activeTab === "app mapping" && (
          <div>
            <div style={{ background: "#0d1b2e", border: "1px solid #1e4080", borderRadius: 12, padding: "16px 20px", marginBottom: 20 }}>
              <div style={{ fontWeight: 700, color: "#60a5fa", fontSize: 14, marginBottom: 6 }}>How Walmart charges map to Ledger categories</div>
              <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.7 }}>
                In Ledger, all Walmart charges show up as a single line like "WAL-MART #1832". With the Walmart order upload feature, we can split that single charge into sub-categories so your budget actually reflects what you bought — groceries vs. gas vs. kids clothing vs. home goods.
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {Object.entries(APP_MAPPING).map(([walmartCat, mapping]) => {
                const catData = CATEGORIES.find(c => c.name === walmartCat);
                return (
                  <div key={walmartCat} style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: "12px 18px", display: "flex", alignItems: "center", gap: 16 }}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: catData?.color || "#94a3b8", flexShrink: 0 }} />
                    <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{walmartCat}</div>
                    <div style={{ fontSize: 18, color: "#334155" }}>→</div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 12, color: "#60a5fa", fontWeight: 700 }}>{mapping.ledgerCat}</div>
                      <div style={{ fontSize: 10, color: "#334155" }}>sub: {mapping.sub}</div>
                    </div>
                    {catData && <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, color: catData.color, minWidth: 70, textAlign: "right" }}>{fmt(catData.total)}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
