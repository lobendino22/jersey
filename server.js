const express = require('express');
const cors    = require('cors');
const mysql   = require('mysql2/promise');
const path    = require('path');
const https   = require('https');
const http    = require('http');
const fs      = require('fs');
const crypto  = require('crypto');

const app  = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── IMAGE CACHE ─────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'public', 'img-cache');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// ── DB POOL ────────────────────────────────
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'nbajersey_db',
  waitForConnections: true,
  connectionLimit: 10,
});
// ============================================================
// PRODUCTS API (WITHOUT /api PREFIX - FOR FRONTEND)
// ============================================================

// GET all products
app.get('/products', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM products ORDER BY id DESC');
    
    const formatted = rows.map(p => ({
      id: p.id.toString(),
      name: p.name,
      description: p.description || '',
      price: parseFloat(p.price),
      category: p.category || 'NBA Jersey',
      image: p.image || '',
      stock: p.stock || 0,
      isAvailable: p.is_available === 1
    }));
    
    console.log(`📦 GET /products - returning ${formatted.length} products`);
    res.json(formatted);
  } catch (err) {
    console.error('GET products error:', err);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// GET single product
app.get('/products/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    const p = rows[0];
    res.json({
      id: p.id.toString(),
      name: p.name,
      description: p.description,
      price: parseFloat(p.price),
      category: p.category,
      image: p.image,
      stock: p.stock,
      isAvailable: p.is_available === 1
    });
  } catch (err) {
    console.error('GET product error:', err);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

// CREATE product
app.post('/products', async (req, res) => {
  try {
    const { name, description, price, category, image, stock, isAvailable } = req.body;
    
    console.log('📦 POST /products - creating:', { name, price, category });
    
    if (!name || !price) {
      return res.status(400).json({ error: 'Name and price are required' });
    }
    
    const [result] = await pool.execute(
      `INSERT INTO products (name, description, price, category, image, stock, is_available) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, description || '', price, category || 'NBA Jersey', image || '', stock || 10, isAvailable !== false ? 1 : 0]
    );
    
    const [newProduct] = await pool.execute('SELECT * FROM products WHERE id = ?', [result.insertId]);
    const p = newProduct[0];
    
    console.log('✅ Product created:', result.insertId);
    
    res.status(201).json({
      id: p.id.toString(),
      name: p.name,
      description: p.description,
      price: parseFloat(p.price),
      category: p.category,
      image: p.image,
      stock: p.stock,
      isAvailable: p.is_available === 1
    });
    
  } catch (err) {
    console.error('POST product error:', err);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// UPDATE product
app.patch('/products/:id', async (req, res) => {
  try {
    const { name, description, price, category, image, stock, isAvailable } = req.body;
    const id = req.params.id;
    
    console.log('📦 PATCH /products - updating:', id);
    
    const updates = [];
    const values = [];
    
    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }
    if (price !== undefined) { updates.push('price = ?'); values.push(price); }
    if (category !== undefined) { updates.push('category = ?'); values.push(category); }
    if (image !== undefined) { updates.push('image = ?'); values.push(image); }
    if (stock !== undefined) { updates.push('stock = ?'); values.push(stock); }
    if (isAvailable !== undefined) { updates.push('is_available = ?'); values.push(isAvailable ? 1 : 0); }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    values.push(id);
    await pool.execute(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`, values);
    
    const [updated] = await pool.execute('SELECT * FROM products WHERE id = ?', [id]);
    const p = updated[0];
    
    res.json({
      id: p.id.toString(),
      name: p.name,
      description: p.description,
      price: parseFloat(p.price),
      category: p.category,
      image: p.image,
      stock: p.stock,
      isAvailable: p.is_available === 1
    });
    
  } catch (err) {
    console.error('PATCH product error:', err);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// DELETE product
app.delete('/products/:id', async (req, res) => {
  try {
    const id = req.params.id;
    
    console.log('📦 DELETE /products - deleting:', id);
    
    const [result] = await pool.execute('DELETE FROM products WHERE id = ?', [id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    res.json({ success: true, message: 'Product deleted' });
    
  } catch (err) {
    console.error('DELETE product error:', err);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});
// ============================================================
// CART API
// ============================================================

// GET cart
app.get('/api/cart', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM cart');

    let total = 0;
    rows.forEach(i => total += Number(i.price) * i.quantity);

    res.json({
      items: rows,
      count: rows.length,
      total
    });

  } catch (err) {
    res.status(500).json({ error: 'DB error cart' });
  }
});

// ADD to cart
app.post('/api/cart', async (req, res) => {
  try {
    const { productId, name, price, quantity, image, category } = req.body;

    await pool.execute(
      `INSERT INTO cart (product_id, name, price, quantity, image, category)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [productId, name, price, quantity, image, category]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Insert failed' });
  }
});

// CLEAR cart
app.delete('/api/cart', async (req, res) => {
  try {
    await pool.execute('DELETE FROM cart');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ============================================================
// DELIVERY SERVICES API
// ============================================================

// ============================================================
// DELIVERY SERVICES API - COMPLETE
// ============================================================

// GET all delivery services
app.get('/delivery-services', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM delivery_services WHERE is_available = 1 ORDER BY name ASC');
    
    console.log(`🚚 Returning ${rows.length} delivery services`);
    res.json(rows);
  } catch (err) {
    console.error('GET delivery-services error:', err);
    res.status(500).json({ error: 'Failed to fetch delivery services' });
  }
});

// GET delivery service by ID
app.get('/delivery-services/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM delivery_services WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Delivery service not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('GET delivery-service error:', err);
    res.status(500).json({ error: 'Failed to fetch delivery service' });
  }
});

// CREATE delivery service
app.post('/delivery-services', async (req, res) => {
  try {
    const { name, area, fee, estimatedTime, rider, isAvailable } = req.body;
    
    console.log('🚚 Creating delivery service:', { name, area, fee, rider });
    
    if (!name || !area) {
      return res.status(400).json({ error: 'Name and area are required' });
    }
    
    const [result] = await pool.execute(
      `INSERT INTO delivery_services (name, area, fee, estimated_time, rider, is_available) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, area, fee || 49, estimatedTime || '30-45 mins', rider || 'Unassigned', isAvailable !== false ? 1 : 0]
    );
    
    const [newService] = await pool.execute('SELECT * FROM delivery_services WHERE id = ?', [result.insertId]);
    
    console.log('✅ Delivery service created:', result.insertId);
    res.status(201).json(newService[0]);
    
  } catch (err) {
    console.error('POST delivery-services error:', err);
    res.status(500).json({ error: 'Failed to create delivery service' });
  }
});

// UPDATE delivery service
app.patch('/delivery-services/:id', async (req, res) => {
  try {
    const { name, area, fee, estimatedTime, rider, isAvailable } = req.body;
    const id = req.params.id;
    
    const updates = [];
    const values = [];
    
    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (area !== undefined) { updates.push('area = ?'); values.push(area); }
    if (fee !== undefined) { updates.push('fee = ?'); values.push(fee); }
    if (estimatedTime !== undefined) { updates.push('estimated_time = ?'); values.push(estimatedTime); }
    if (rider !== undefined) { updates.push('rider = ?'); values.push(rider); }
    if (isAvailable !== undefined) { updates.push('is_available = ?'); values.push(isAvailable ? 1 : 0); }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    values.push(id);
    await pool.execute(`UPDATE delivery_services SET ${updates.join(', ')} WHERE id = ?`, values);
    
    const [updated] = await pool.execute('SELECT * FROM delivery_services WHERE id = ?', [id]);
    
    console.log('✅ Delivery service updated:', id);
    res.json(updated[0]);
    
  } catch (err) {
    console.error('PATCH delivery-services error:', err);
    res.status(500).json({ error: 'Failed to update delivery service' });
  }
});

// DELETE delivery service
app.delete('/delivery-services/:id', async (req, res) => {
  try {
    const id = req.params.id;
    
    const [result] = await pool.execute('DELETE FROM delivery_services WHERE id = ?', [id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Delivery service not found' });
    }
    
    console.log('✅ Delivery service deleted:', id);
    res.json({ success: true, message: 'Delivery service deleted' });
    
  } catch (err) {
    console.error('DELETE delivery-services error:', err);
    res.status(500).json({ error: 'Failed to delete delivery service' });
  }
});
// ============================================================
// PAYMENT METHODS API
// ============================================================

// GET payment methods
app.get('/api/payment-methods', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM payment_methods WHERE id = 1');
    if (rows.length === 0) {
      // Return default if not exists
      return res.json({ gcash: true, cod: true });
    }
    res.json({ gcash: rows[0].gcash === 1, cod: rows[0].cod === 1 });
  } catch (err) {
    console.error('GET payment-methods error:', err);
    res.json({ gcash: true, cod: true });
  }
});

// UPDATE payment methods
app.patch('/api/payment-methods', async (req, res) => {
  try {
    const { gcash, cod } = req.body;
    
    console.log('💳 Updating payment methods:', { gcash, cod });
    
    const [existing] = await pool.execute('SELECT id FROM payment_methods WHERE id = 1');
    
    if (existing.length === 0) {
      await pool.execute(
        'INSERT INTO payment_methods (id, gcash, cod) VALUES (1, ?, ?)',
        [gcash ? 1 : 0, cod ? 1 : 0]
      );
    } else {
      await pool.execute(
        'UPDATE payment_methods SET gcash = ?, cod = ? WHERE id = 1',
        [gcash ? 1 : 0, cod ? 1 : 0]
      );
    }
    
    console.log('✅ Payment methods updated');
    res.json({ success: true, gcash, cod });
    
  } catch (err) {
    console.error('PATCH payment-methods error:', err);
    res.status(500).json({ error: 'Failed to update payment methods' });
  }
});

// ============================================================
// AUTH & USERS API
// ============================================================

// REGISTER
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    console.log('📝 Registration attempt:', { name, email });
    
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'All fields are required' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }
    
    const [existing] = await pool.execute('SELECT id FROM users WHERE email = ?', [email]);
    
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Email already registered' });
    }
    
    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
    
    const [result] = await pool.execute(
      'INSERT INTO users (name, email, password, role, created_at) VALUES (?, ?, ?, ?, NOW())',
      [name, email, hashedPassword, 'user']
    );
    
    console.log('✅ User registered:', { id: result.insertId, name, email });
    
    res.status(201).json({ 
      success: true, 
      message: 'Registration successful',
      user: { id: result.insertId, name, email, role: 'user' }
    });
    
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ message: 'Server error during registration' });
  }
});

// LOGIN
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    console.log('🔐 Login attempt:', { email });
    
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' });
    }
    
    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
    
    const [users] = await pool.execute(
      'SELECT id, name, email, role FROM users WHERE email = ? AND password = ?',
      [email, hashedPassword]
    );
    
    if (users.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    
    const user = users[0];
    let role = user.role || 'user';
    
    // Hardcoded admin check
    if (email === 'admin@hardpanel.com') {
      role = 'admin';
      await pool.execute('UPDATE users SET role = ? WHERE id = ?', ['admin', user.id]);
    }
    
    console.log('✅ User logged in:', { id: user.id, name: user.name, email: user.email, role });
    
    res.json({ 
      success: true, 
      message: 'Login successful',
      user: { id: user.id, name: user.name, email: user.email, role: role }
    });
    
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// GET all users
app.get('/api/users', async (req, res) => {
  try {
    const [users] = await pool.execute('SELECT id, name, email, role, created_at FROM users');
    res.json(users);
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ error: 'DB error' });
  }
});

// GET single user
app.get('/api/users/:id', async (req, res) => {
  try {
    const [users] = await pool.execute('SELECT id, name, email, role, created_at FROM users WHERE id = ?', [req.params.id]);
    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ user: users[0] });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'DB error' });
  }
});

// UPDATE user
app.put('/api/users/:id', async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    const userId = req.params.id;
    
    const [existing] = await pool.execute('SELECT id FROM users WHERE id = ?', [userId]);
    if (existing.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const [emailTaken] = await pool.execute('SELECT id FROM users WHERE email = ? AND id != ?', [email, userId]);
    if (emailTaken.length > 0) {
      return res.status(409).json({ message: 'Email already taken' });
    }
    
    await pool.execute('UPDATE users SET name = ?, email = ? WHERE id = ?', [name, email, userId]);
    
    const [users] = await pool.execute('SELECT id, name, email, created_at FROM users WHERE id = ?', [userId]);
    res.json({ user: users[0] });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Update failed' });
  }
});

// DELETE user
app.delete('/api/users/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    const [result] = await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// CHANGE PASSWORD
app.post('/api/change-password', async (req, res) => {
  try {
    const { userId, currentPassword, newPassword } = req.body;
    
    if (!userId || !currentPassword || !newPassword) {
      return res.status(400).json({ message: 'All fields are required' });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }
    
    const hashedCurrent = crypto.createHash('sha256').update(currentPassword).digest('hex');
    
    const [users] = await pool.execute('SELECT id FROM users WHERE id = ? AND password = ?', [userId, hashedCurrent]);
    if (users.length === 0) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }
    
    const hashedNew = crypto.createHash('sha256').update(newPassword).digest('hex');
    await pool.execute('UPDATE users SET password = ? WHERE id = ?', [hashedNew, userId]);
    
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Password change failed' });
  }
});

// ============================================================
// HEALTH & ROOT
// ============================================================

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'API running' });
});

app.get('/', (req, res) => {
  res.send('🔥 NBA Jersey API Running');
});

// ============================================================
// INIT DATABASE
// ============================================================

async function initDB() {
  let conn;

  try {
    console.log("🔄 Initializing DB...");
    conn = await pool.getConnection();

    // Create products table
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        description TEXT,
        price DECIMAL(10,2) NOT NULL,
        category VARCHAR(100) DEFAULT 'NBA Jersey',
        image VARCHAR(1000),
        stock INT DEFAULT 10,
        is_available TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Create cart table
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS cart (
        id INT AUTO_INCREMENT PRIMARY KEY,
        product_id INT,
        name VARCHAR(200),
        price DECIMAL(10,2),
        quantity INT,
        image VARCHAR(1000),
        category VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create users table
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'user',
        phone VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create delivery_services table
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS delivery_services (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        area VARCHAR(200) NOT NULL,
        fee DECIMAL(10,2) DEFAULT 49,
        estimated_time VARCHAR(50) DEFAULT '30-45 mins',
        rider VARCHAR(100) DEFAULT 'Unassigned',
        is_available TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Create payment_methods table
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS payment_methods (
        id INT PRIMARY KEY DEFAULT 1,
        gcash TINYINT(1) DEFAULT 1,
        cod TINYINT(1) DEFAULT 1
      )
    `);

    // Seed products if empty
    const [productCount] = await conn.execute('SELECT COUNT(*) AS cnt FROM products');
    if (productCount[0].cnt === 0) {
      const jerseys = [
        { name: 'Lakers LeBron James Jersey', price: 2499, category: 'Lakers', image: 'https://images.unsplash.com/photo-1600180758890-6b94519a8ba8?w=400' },
        { name: 'Warriors Stephen Curry Jersey', price: 2499, category: 'Warriors', image: 'https://images.unsplash.com/photo-1599058917765-a780eda07a3e?w=400' },
        { name: 'Bulls Michael Jordan Jersey', price: 2799, category: 'Bulls', image: 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=400' },
        { name: 'Celtics Jayson Tatum Jersey', price: 2399, category: 'Celtics', image: 'https://images.unsplash.com/photo-1546519638-68e109498ffc?w=400' },
        { name: 'Nets Kevin Durant Jersey', price: 2599, category: 'Nets', image: 'https://images.unsplash.com/photo-1600180758891-6b94519a8ba8?w=400' },
        { name: 'Bucks Giannis Jersey', price: 2599, category: 'Bucks', image: 'https://images.unsplash.com/photo-1599058917765-a780eda07a3e?w=400' }
      ];

      for (const p of jerseys) {
        await conn.execute(
          `INSERT INTO products (name, description, price, category, image, stock, is_available) 
           VALUES (?, 'Official NBA jersey', ?, ?, ?, 10, 1)`,
          [p.name, p.price, p.category, p.image]
        );
      }
      console.log("🏀 Seeded sample products");
    }

    // Seed delivery services if empty
    const [deliveryCount] = await conn.execute('SELECT COUNT(*) AS cnt FROM delivery_services');
    if (deliveryCount[0].cnt === 0) {
      await conn.execute(`
        INSERT INTO delivery_services (name, area, fee, estimated_time, rider, is_available) VALUES
        ('NBA Express', 'Metro Manila', 99, '30-45 mins', 'James Rodriguez', 1),
        ('Jersey Courier', 'Quezon City', 79, '45-60 mins', 'Marcus Chen', 1),
        ('Hoops Delivery', 'Makati City', 89, '25-40 mins', 'Andre Santos', 1)
      `);
      console.log('🏍️ Seeded delivery services');
    }

    // Seed payment methods if empty
    const [paymentCount] = await conn.execute('SELECT COUNT(*) AS cnt FROM payment_methods');
    if (paymentCount[0].cnt === 0) {
      await conn.execute(`INSERT INTO payment_methods (id, gcash, cod) VALUES (1, 1, 1)`);
      console.log('💳 Seeded payment methods');
    }

    console.log("✅ Database ready");

  } catch (err) {
    console.error('Database initialization error:', err);
  } finally {
    if (conn) conn.release();
  }
}

// ── START SERVER ────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀 API running at http://localhost:${PORT}`);
    console.log(`📦 Products: GET /api/products | POST /api/products | PATCH /api/products/:id | DELETE /api/products/:id`);
    console.log(`🛒 Cart: GET /api/cart | POST /api/cart | DELETE /api/cart`);
    console.log(`🚚 Delivery: GET /api/delivery-services | POST /api/delivery-services | PATCH /api/delivery-services/:id | DELETE /api/delivery-services/:id`);
    console.log(`💳 Payment: GET /api/payment-methods | PATCH /api/payment-methods`);
    console.log(`👤 Auth: POST /api/register | POST /api/login`);
    console.log(`👥 Users: GET /api/users | GET /api/users/:id | PUT /api/users/:id | DELETE /api/users/:id`);
    console.log(`🔐 Password: POST /api/change-password`);
    console.log(`❤️ Health: GET /health\n`);
  });
});