const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

app.use(cors());
app.use(express.json({ limit: "10mb" }));

async function query(text, params = []) {
  return pool.query(text, params);
}

async function initDatabase() {
  await query(`
    CREATE TABLE IF NOT EXISTS products (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price BIGINT NOT NULL DEFAULT 0 CHECK (price >= 0),
      stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
      image TEXT NOT NULL DEFAULT '',
      colors JSONB NOT NULL DEFAULT '[]'::jsonb,
      sizes JSONB NOT NULL DEFAULT '[]'::jsonb,
      rating NUMERIC(3,2) NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS customers (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      payment_method TEXT NOT NULL DEFAULT 'online',
      shipping_method TEXT NOT NULL DEFAULT 'post',
      shipping_cost BIGINT NOT NULL DEFAULT 0 CHECK (shipping_cost >= 0),
      total_amount BIGINT NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
      address TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id BIGINT NOT NULL REFERENCES products(id),
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_price BIGINT NOT NULL CHECK (unit_price >= 0),
      color TEXT NOT NULL DEFAULT '',
      size TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
    CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);
    CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
    CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
  `);

  const result = await query("SELECT COUNT(*)::int AS n FROM products");
  if (result.rows[0].n === 0) {
    await query(`
      INSERT INTO products
        (name, category, description, price, stock, image, colors, sizes, rating)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)
    `, [
      "تیشرت Urban 2026",
      "تیشرت",
      "خنک و با پارچه مرغوب، مخصوص یک تابستانه خیلی گرم.",
      890000,
      5,
      "",
      JSON.stringify(["سفید","مشکی","آبی","قرمز"]),
      JSON.stringify(["XL"]),
      4.9
    ]);
  }
}

function productOut(p) {
  if (!p) return null;
  return {
    ...p,
    colors: Array.isArray(p.colors) ? p.colors : [],
    sizes: Array.isArray(p.sizes) ? p.sizes : [],
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
    active: body.active === false ? false : true
  };
}

app.get("/api/health", async (req, res) => {
  try {
    const result = await query("SELECT NOW() AS db_time");
    res.json({ ok: true, service: "Pasargad 2026 API", database: "connected", db_time: result.rows[0].db_time });
  } catch (err) {
    console.error(err);
    res.status(503).json({ ok: false, service: "Pasargad 2026 API", database: "disconnected" });
  }
});

app.get("/api/products", async (req, res) => {
  try {
    const { category, search, active } = req.query;
    let sql = "SELECT * FROM products WHERE 1=1";
    const params = [];

    if (category && category !== "همه") {
      params.push(category);
      sql += ` AND category = $${params.length}`;
    }
    if (search) {
      const q = `%${search}%`;
      params.push(q, q, q);
      sql += ` AND (name ILIKE $${params.length - 2} OR category ILIKE $${params.length - 1} OR description ILIKE $${params.length})`;
    }
    if (active !== "all") sql += " AND active = TRUE";
    sql += " ORDER BY created_at DESC";

    const rows = (await query(sql, params)).rows.map(productOut);
    res.json({ data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "خطا در دریافت محصولات." });
  }
});

app.get("/api/products/:id", async (req, res) => {
  try {
    const result = await query("SELECT * FROM products WHERE id=$1", [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: "محصول پیدا نشد." });
    res.json({ data: productOut(result.rows[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "خطا در دریافت محصول." });
  }
});

app.post("/api/products", async (req, res) => {
  try {
    const p = validProductBody(req.body);
    if (!p.name) return res.status(400).json({ error: "نام محصول الزامی است." });
    if (!Number.isFinite(p.price) || p.price < 0 || !Number.isInteger(p.stock) || p.stock < 0) {
      return res.status(400).json({ error: "قیمت یا موجودی نامعتبر است." });
    }

    const result = await query(`
      INSERT INTO products
      (name, category, description, price, stock, image, colors, sizes, rating, active)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10)
      RETURNING *
    `, [p.name,p.category,p.description,p.price,p.stock,p.image,JSON.stringify(p.colors),JSON.stringify(p.sizes),p.rating,p.active]);

    res.status(201).json({ data: productOut(result.rows[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "خطا در افزودن محصول." });
  }
});

app.put("/api/products/:id", async (req, res) => {
  try {
    const p = validProductBody(req.body);
    if (!p.name) return res.status(400).json({ error: "نام محصول الزامی است." });
    if (!Number.isFinite(p.price) || p.price < 0 || !Number.isInteger(p.stock) || p.stock < 0) {
      return res.status(400).json({ error: "قیمت یا موجودی نامعتبر است." });
    }

    const result = await query(`
      UPDATE products SET
        name=$1, category=$2, description=$3, price=$4, stock=$5, image=$6,
        colors=$7::jsonb, sizes=$8::jsonb, rating=$9, active=$10, updated_at=NOW()
      WHERE id=$11
      RETURNING *
    `, [p.name,p.category,p.description,p.price,p.stock,p.image,JSON.stringify(p.colors),JSON.stringify(p.sizes),p.rating,p.active,req.params.id]);

    if (!result.rows[0]) return res.status(404).json({ error: "محصول پیدا نشد." });
    res.json({ data: productOut(result.rows[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "خطا در ویرایش محصول." });
  }
});

app.delete("/api/products/:id", async (req, res) => {
  try {
    const result = await query("DELETE FROM products WHERE id=$1 RETURNING id", [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: "محصول پیدا نشد." });
    res.json({ message: "محصول حذف شد." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "محصول قابل حذف نیست؛ ممکن است در سفارش ثبت شده باشد." });
  }
});

app.get("/api/customers", async (req, res) => {
  try {
    const rows = (await query("SELECT id,name,phone,email,created_at FROM customers ORDER BY created_at DESC")).rows;
    res.json({ data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "خطا در دریافت مشتریان." });
  }
});

app.post("/api/customers", async (req, res) => {
  const name = String(req.body.name || "").trim();
  const phone = String(req.body.phone || "").trim();
  const email = String(req.body.email || "").trim();
  if (!name || !phone) return res.status(400).json({ error: "نام و شماره موبایل الزامی است." });

  try {
    const result = await query(
      "INSERT INTO customers(name,phone,email) VALUES($1,$2,$3) RETURNING id,name,phone,email,created_at",
      [name,phone,email]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "این شماره موبایل قبلاً ثبت شده است." });
    console.error(err);
    res.status(500).json({ error: "خطا در ثبت مشتری." });
  }
});

app.get("/api/orders", async (req, res) => {
  try {
    const orders = (await query("SELECT * FROM orders ORDER BY created_at DESC")).rows;
    const result = await query("SELECT * FROM order_items ORDER BY id");
    const byOrder = new Map();
    for (const item of result.rows) {
      if (!byOrder.has(item.order_id)) byOrder.set(item.order_id, []);
      byOrder.get(item.order_id).push(item);
    }
    res.json({ data: orders.map(o => ({ ...o, items: byOrder.get(o.id) || [] })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "خطا در دریافت سفارش‌ها." });
  }
});

app.get("/api/orders/:id", async (req, res) => {
  try {
    const order = (await query("SELECT * FROM orders WHERE id=$1", [req.params.id])).rows[0];
    if (!order) return res.status(404).json({ error: "سفارش پیدا نشد." });
    order.items = (await query("SELECT * FROM order_items WHERE order_id=$1 ORDER BY id", [order.id])).rows;
    res.json({ data: order });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "خطا در دریافت سفارش." });
  }
});

app.post("/api/orders", async (req, res) => {
  const body = req.body;
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return res.status(400).json({ error: "سبد خرید خالی است." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let total = 0;
    const normalized = [];

    for (const item of items) {
      const productResult = await client.query("SELECT * FROM products WHERE id=$1 AND active=TRUE FOR UPDATE", [item.product_id]);
      const product = productResult.rows[0];
      const qty = Number(item.quantity || 0);

      if (!product) throw Object.assign(new Error("یکی از محصولات پیدا نشد."), { status: 400 });
      if (!Number.isInteger(qty) || qty < 1) throw Object.assign(new Error("تعداد محصول نامعتبر است."), { status: 400 });
      if (qty > product.stock) throw Object.assign(new Error(`موجودی ${product.name} کافی نیست.`), { status: 400 });

      total += Number(product.price) * qty;
      normalized.push({
        product_id: product.id,
        product_name: product.name,
        quantity: qty,
        unit_price: Number(product.price),
        color: String(item.color || ""),
        size: String(item.size || "")
      });
    }

    const shippingCost = Number(body.shipping_cost || 0);
    if (!Number.isFinite(shippingCost) || shippingCost < 0) throw Object.assign(new Error("هزینه ارسال نامعتبر است."), { status: 400 });

    const finalTotal = total + shippingCost;

    const orderResult = await client.query(`
      INSERT INTO orders(customer_id,status,payment_method,shipping_method,shipping_cost,total_amount,address)
      VALUES($1,'pending',$2,$3,$4,$5,$6)
      RETURNING *
    `, [
      body.customer_id || null,
      String(body.payment_method || "online"),
      String(body.shipping_method || "post"),
      shippingCost,
      finalTotal,
      String(body.address || "")
    ]);

    const order = orderResult.rows[0];

    for (const item of normalized) {
      await client.query(`
        INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price,color,size)
        VALUES($1,$2,$3,$4,$5,$6,$7)
      `, [order.id,item.product_id,item.product_name,item.quantity,item.unit_price,item.color,item.size]);

      await client.query(
        "UPDATE products SET stock=stock-$1,updated_at=NOW() WHERE id=$2",
        [item.quantity,item.product_id]
      );
    }

    await client.query("COMMIT");
    order.items = (await client.query("SELECT * FROM order_items WHERE order_id=$1 ORDER BY id", [order.id])).rows;
    res.status(201).json({ data: order });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || "خطا در ثبت سفارش." });
  } finally {
    client.release();
  }
});

app.patch("/api/orders/:id/status", async (req, res) => {
  const allowed = ["pending","paid","processing","shipped","delivered","cancelled"];
  const status = String(req.body.status || "");
  if (!allowed.includes(status)) return res.status(400).json({ error: "وضعیت سفارش نامعتبر است." });

  try {
    const result = await query("UPDATE orders SET status=$1 WHERE id=$2 RETURNING *", [status,req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: "سفارش پیدا نشد." });
    res.json({ data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "خطا در تغییر وضعیت سفارش." });
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "خطای داخلی سرور." });
});

initDatabase()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Pasargad 2026 API running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Database initialization failed:", err);
    process.exit(1);
  });

process.on("SIGTERM", async () => {
  await pool.end();
  process.exit(0);
});
