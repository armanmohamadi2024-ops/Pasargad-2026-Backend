const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database(path.join(__dirname, "data", "pasargad2026.db"));

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ---------- Database ----------
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT DEFAULT '',
  price INTEGER NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  image TEXT DEFAULT '',
  colors TEXT NOT NULL DEFAULT '[]',
  sizes TEXT NOT NULL DEFAULT '[]',
  rating REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  email TEXT DEFAULT '',
  password_hash TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_method TEXT NOT NULL DEFAULT 'online',
  shipping_method TEXT NOT NULL DEFAULT 'post',
  shipping_cost INTEGER NOT NULL DEFAULT 0,
  total_amount INTEGER NOT NULL DEFAULT 0,
  address TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  color TEXT DEFAULT '',
  size TEXT DEFAULT '',
  FOREIGN KEY(order_id) REFERENCES orders(id),
  FOREIGN KEY(product_id) REFERENCES products(id)
);
`);

const count = db.prepare("SELECT COUNT(*) AS n FROM products").get().n;
if (count === 0) {
  const insert = db.prepare(`
    INSERT INTO products
    (name, category, description, price, stock, image, colors, sizes, rating)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const seed = db.transaction(() => {
    insert.run(
      "تیشرت Urban 2026", "تیشرت",
      "خنک و با پارچه مرغوب، مخصوص یک تابستانه خیلی گرم.",
      890000, 5, "",
      JSON.stringify(["سفید","مشکی","آبی","قرمز"]),
      JSON.stringify(["XL"]), 4.9
    );
  });
  seed();
}

// ---------- Helpers ----------
function productOut(p) {
  if (!p) return null;
  return {
    ...p,
    active: Boolean(p.active),
    colors: JSON.parse(p.colors || "[]"),
    sizes: JSON.parse(p.sizes || "[]")
  };
}

function validProductBody(body) {
  return {
    name: String(body.name || "").trim(),
    category: String(body.category || "تیشرت").trim(),
    description: String(body.description || "").trim(),
    price: Number(body.price || 0),
    stock: Number(body.stock || 0),
    image: String(body.image || "").trim(),
    colors: Array.isArray(body.colors) ? body.colors : [],
    sizes: Array.isArray(body.sizes) ? body.sizes : [],
    rating: Number(body.rating || 0),
    active: body.active === false ? 0 : 1
  };
}

// ---------- Health ----------
app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "Pasargad 2026 API" });
});

// ---------- Products ----------
app.get("/api/products", (req, res) => {
  const { category, search, active } = req.query;
  let sql = "SELECT * FROM products WHERE 1=1";
  const params = [];

  if (category && category !== "همه") {
    sql += " AND category = ?";
    params.push(category);
  }
  if (search) {
    sql += " AND (name LIKE ? OR category LIKE ? OR description LIKE ?)";
    const q = `%${search}%`;
    params.push(q, q, q);
  }
  if (active !== "all") sql += " AND active = 1";
  sql += " ORDER BY created_at DESC";

  const rows = db.prepare(sql).all(...params).map(productOut);
  res.json({ data: rows });
});

app.get("/api/products/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "محصول پیدا نشد." });
  res.json({ data: productOut(row) });
});

app.post("/api/products", (req, res) => {
  const p = validProductBody(req.body);
  if (!p.name) return res.status(400).json({ error: "نام محصول الزامی است." });
  if (p.price < 0 || p.stock < 0) return res.status(400).json({ error: "قیمت و موجودی نمی‌توانند منفی باشند." });

  const result = db.prepare(`
    INSERT INTO products
    (name, category, description, price, stock, image, colors, sizes, rating, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    p.name, p.category, p.description, p.price, p.stock, p.image,
    JSON.stringify(p.colors), JSON.stringify(p.sizes), p.rating, p.active
  );

  const row = db.prepare("SELECT * FROM products WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json({ data: productOut(row) });
});

app.put("/api/products/:id", (req, res) => {
  const p = validProductBody(req.body);
  if (!p.name) return res.status(400).json({ error: "نام محصول الزامی است." });

  const result = db.prepare(`
    UPDATE products SET
      name=?, category=?, description=?, price=?, stock=?, image=?,
      colors=?, sizes=?, rating=?, active=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(
    p.name, p.category, p.description, p.price, p.stock, p.image,
    JSON.stringify(p.colors), JSON.stringify(p.sizes), p.rating, p.active,
    req.params.id
  );

  if (!result.changes) return res.status(404).json({ error: "محصول پیدا نشد." });
  const row = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);
  res.json({ data: productOut(row) });
});

app.delete("/api/products/:id", (req, res) => {
  const result = db.prepare("DELETE FROM products WHERE id = ?").run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: "محصول پیدا نشد." });
  res.json({ message: "محصول حذف شد." });
});

// ---------- Customers ----------
app.get("/api/customers", (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, phone, email, created_at
    FROM customers ORDER BY created_at DESC
  `).all();
  res.json({ data: rows });
});

app.post("/api/customers", (req, res) => {
  const name = String(req.body.name || "").trim();
  const phone = String(req.body.phone || "").trim();
  const email = String(req.body.email || "").trim();

  if (!name || !phone) {
    return res.status(400).json({ error: "نام و شماره موبایل الزامی است." });
  }

  try {
    const result = db.prepare(
      "INSERT INTO customers (name, phone, email) VALUES (?, ?, ?)"
    ).run(name, phone, email);

    const row = db.prepare(
      "SELECT id, name, phone, email, created_at FROM customers WHERE id=?"
    ).get(result.lastInsertRowid);

    res.status(201).json({ data: row });
  } catch {
    res.status(409).json({ error: "این شماره موبایل قبلاً ثبت شده است." });
  }
});

// ---------- Orders ----------
app.get("/api/orders", (req, res) => {
  const orders = db.prepare("SELECT * FROM orders ORDER BY created_at DESC").all();
  const itemStmt = db.prepare("SELECT * FROM order_items WHERE order_id=?");

  res.json({
    data: orders.map(o => ({
      ...o,
      items: itemStmt.all(o.id)
    }))
  });
});

app.get("/api/orders/:id", (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(req.params.id);
  if (!order) return res.status(404).json({ error: "سفارش پیدا نشد." });

  order.items = db.prepare("SELECT * FROM order_items WHERE order_id=?").all(order.id);
  res.json({ data: order });
});

app.post("/api/orders", (req, res) => {
  const body = req.body;
  const items = Array.isArray(body.items) ? body.items : [];

  if (!items.length) return res.status(400).json({ error: "سبد خرید خالی است." });

  const getProduct = db.prepare("SELECT * FROM products WHERE id=? AND active=1");
  let total = 0;
  const normalized = [];

  for (const item of items) {
    const product = getProduct.get(item.product_id);
    const qty = Number(item.quantity || 0);

    if (!product) return res.status(400).json({ error: "یکی از محصولات پیدا نشد." });
    if (!Number.isInteger(qty) || qty < 1) return res.status(400).json({ error: "تعداد محصول نامعتبر است." });
    if (qty > product.stock) {
      return res.status(400).json({ error: `موجودی ${product.name} کافی نیست.` });
    }

    total += product.price * qty;
    normalized.push({
      product_id: product.id,
      product_name: product.name,
      quantity: qty,
      unit_price: product.price,
      color: String(item.color || ""),
      size: String(item.size || "")
    });
  }

  const shippingCost = Number(body.shipping_cost || 0);
  const finalTotal = total + shippingCost;

  const create = db.transaction(() => {
    const order = db.prepare(`
      INSERT INTO orders
      (customer_id, status, payment_method, shipping_method, shipping_cost, total_amount, address)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      body.customer_id || null,
      "pending",
      String(body.payment_method || "online"),
      String(body.shipping_method || "post"),
      shippingCost,
      finalTotal,
      String(body.address || "")
    );

    const itemInsert = db.prepare(`
      INSERT INTO order_items
      (order_id, product_id, product_name, quantity, unit_price, color, size)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const stockUpdate = db.prepare(
      "UPDATE products SET stock = stock - ?, updated_at=CURRENT_TIMESTAMP WHERE id=?"
    );

    for (const item of normalized) {
      itemInsert.run(
        order.lastInsertRowid, item.product_id, item.product_name,
        item.quantity, item.unit_price, item.color, item.size
      );
      stockUpdate.run(item.quantity, item.product_id);
    }

    return order.lastInsertRowid;
  });

  const orderId = create();
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId);
  order.items = db.prepare("SELECT * FROM order_items WHERE order_id=?").all(orderId);

  res.status(201).json({ data: order });
});

app.patch("/api/orders/:id/status", (req, res) => {
  const allowed = ["pending", "paid", "processing", "shipped", "delivered", "cancelled"];
  const status = String(req.body.status || "");
  if (!allowed.includes(status)) return res.status(400).json({ error: "وضعیت سفارش نامعتبر است." });

  const result = db.prepare("UPDATE orders SET status=? WHERE id=?").run(status, req.params.id);
  if (!result.changes) return res.status(404).json({ error: "سفارش پیدا نشد." });

  res.json({ data: db.prepare("SELECT * FROM orders WHERE id=?").get(req.params.id) });
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`Pasargad 2026 API running at http://localhost:${PORT}`);
});
